import { utilityProcess } from 'electron';
import path from 'node:path';
import type { GitDiff, GitDiffPreviewResult, RenderResult } from '../../protocol/desktop-api';
import { applyTextRevision } from '../../core/document/document-state';
import type { PreviewBlockPatch } from '../../core/preview/preview-blocks';
import { normalizePreviewTheme, previewThemeBackground, type PreviewThemeId } from '../../core/preview/preview-preferences';
import type { WindowState } from '../windows/window-state';
import type { PreviewManager } from './preview-manager';
import { ReviewRenderClient } from './review-render-client';
import { ReviewBaselineCache } from './review-baseline-cache';

type WorkerResult = {
  totalLineCount: number;
  baseHref: string;
  themeId: PreviewThemeId;
  template?: string;
  html?: string;
  patch?: PreviewBlockPatch | null;
};
type Options = {
  previews: PreviewManager;
  roots: () => string[];
  theme: () => PreviewThemeId;
  workerPath: string;
};

export class PreviewRenderer {
  private worker: Electron.UtilityProcess | null = null;
  private requestId = 0;
  private reviewRevision = 0;
  private readonly reviews: ReviewRenderClient;
  private readonly reviewPages = new WeakMap<Electron.WebContents, string>();
  private readonly baselines = new ReviewBaselineCache<string>();
  private baselineEpoch = 0;
  private readonly waiters = new Map<number, {
    resolve: (value: WorkerResult) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly options: Options) {
    this.reviews = new ReviewRenderClient(path.join(path.dirname(options.workerPath), 'review-render-worker.cjs'));
  }

  warmup() { this.ensureWorker(); }

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = utilityProcess.fork(this.options.workerPath);
    this.worker = worker;
    worker.on('message', (reply: {
      kind?: string; id?: number; ok?: boolean; message?: string;
    } & Partial<WorkerResult>) => {
      if (reply?.kind !== 'render' || typeof reply.id !== 'number') return;
      const waiter = this.waiters.get(reply.id);
      if (!waiter) return;
      this.waiters.delete(reply.id);
      if (!reply.ok) {
        waiter.reject(new Error(String(reply.message ?? 'The preview renderer failed.')));
        return;
      }
      waiter.resolve({
        totalLineCount: Math.max(1, Number(reply.totalLineCount) || 1),
        baseHref: String(reply.baseHref ?? ''), themeId: normalizePreviewTheme(reply.themeId),
        template: reply.template, html: reply.html, patch: reply.patch,
      });
    });
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null;
      for (const waiter of this.waiters.values()) waiter.reject(new Error('The preview renderer stopped.'));
      this.waiters.clear();
      this.baselines.clear();
      this.baselineEpoch += 1;
    });
    return worker;
  }

  private render(tabId: string, text: string, revision: number, documentPath: string,
    themeId: PreviewThemeId, hasPage: boolean, deferOffscreenHtml = true) {
    const worker = this.ensureWorker();
    const id = ++this.requestId;
    return new Promise<WorkerResult>((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      worker.postMessage({ kind: 'render', id, tabId, text, revision, documentPath, themeId,
        roots: this.options.roots(), hasPage, deferOffscreenHtml });
    });
  }

  forgetNotebooks() {
    this.baselineEpoch += 1;
    this.baselines.clear();
    this.worker?.postMessage({ kind: 'forget-notebooks' });
  }

  forgetTab(tabId: string) {
    this.worker?.postMessage({ kind: 'forget-tab', tabId });
    if (/^git-diff:.*:[ab]$/.test(tabId)) this.baselines.delete(tabId.replace(/:[ab]$/, ''));
  }

  async renderExport(state: WindowState, text: string, revision: number, documentPath: string) {
    const tabId = `export:${Date.now()}-${Math.random().toString(36).slice(2)}`;
    state.activeRoot = path.dirname(documentPath);
    const rendered = await this.render(tabId, text, revision, documentPath, this.options.theme(), false, false);
    this.forgetTab(tabId);
    if (typeof rendered.template !== 'string') throw new Error('The preview renderer did not return a page.');
    return this.options.previews.storeDocument(rendered.template);
  }

  async prepareDiff(state: WindowState, tabId: string, diff: GitDiff,
    requestedTheme: PreviewThemeId, senderId: number): Promise<GitDiffPreviewResult> {
    const previews = this.options.previews;
    const preview = previews.views.get(tabId);
    const themeId = normalizePreviewTheme(requestedTheme);
    const revision = ++this.reviewRevision;
    const unsupported = (): GitDiffPreviewResult => ({ revision, url: null, themeId, supported: false });
    if (!preview || preview.ownerWebContentsId !== senderId
      || diff.originalText === null || diff.modifiedText === null
      || !/\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(diff.filePath)) return unsupported();
    if (preview.view.getVisible()) throw new Error('Cannot prepare a visible Git preview.');
    const contents = preview.view.webContents;
    const owned = () => previews.views.get(tabId) === preview
      && preview.ownerWebContentsId === senderId && !contents.isDestroyed();
    const check = () => { if (!owned()) throw new Error('The Git preview was closed or transferred.'); };
    state.activeRoot = path.dirname(diff.filePath);
    const originalId = `${tabId}:original`;
    const modifiedId = `${tabId}:modified`;
    const cacheId = tabId.replace(/:[ab]$/, '');
    const context = JSON.stringify([diff.filePath, themeId, this.options.roots(), this.baselineEpoch]);
    const epoch = this.baselineEpoch;
    try {
      const cached = this.baselines.get(cacheId, diff.originalText, context);
      const [original, modified] = await Promise.all([
        cached === undefined
          ? this.render(originalId, diff.originalText, revision, diff.filePath, themeId, false, false)
          : Promise.resolve({ html: cached }),
        this.render(modifiedId, diff.modifiedText, revision, diff.filePath, themeId, false, false),
      ]);
      check();
      if (typeof original.html !== 'string' || typeof modified.html !== 'string'
        || typeof modified.template !== 'string') return unsupported();
      if (cached === undefined && epoch === this.baselineEpoch) {
        this.baselines.set(cacheId, diff.originalText, context, original.html,
          2 * (original.html.length + diff.originalText.length + context.length));
      }
      const currentUrl = contents.getURL();
      const reusable = this.reviewPages.get(contents) === currentUrl;
      const assembled = await this.reviews.assemble({
        originalHtml: original.html, modifiedHtml: modified.html,
        template: modified.template, needsTemplate: !reusable,
      });
      check();
      if (!assembled.supported || typeof assembled.html !== 'string') return unsupported();
      preview.view.setBackgroundColor(previewThemeBackground(themeId));
      let url: string;
      if (reusable) {
        if (contents.getURL() !== currentUrl || preview.view.getVisible()) {
          throw new Error('The Git preview changed during preparation.');
        }
        previews.syncTheme(preview.view, themeId);
        // Register before sending. Timeout must fail, never silently promote.
        const installed = previews.waitForUpdate(tabId, revision, true);
        try {
          contents.send('preview:command', {
            command: 'marktex:update-html', html: assembled.html, markdown: diff.modifiedText,
            revision, totalLineCount: modified.totalLineCount, baseHref: modified.baseHref,
          });
          await installed;
        } catch (error) {
          // A synchronous send failure must not leave an unhandled timeout promise.
          void installed.catch(() => {});
          throw error;
        }
        url = currentUrl;
      } else {
        if (typeof assembled.template !== 'string') return unsupported();
        url = previews.storeDocument(assembled.template, themeId);
        await previews.loadURL(preview.view, url, senderId);
        check();
        this.reviewPages.set(contents, url);
        previews.markTheme(contents, themeId);
        setImmediate(() => previews.ensureSpare(senderId));
      }
      check();
      await previews.prepareReviewViewport(senderId, tabId, revision);
      check();
      return { revision, url, themeId, supported: true };
    } finally {
      this.forgetTab(originalId);
      this.forgetTab(modifiedId);
    }
  }

  async prepare(state: WindowState, tabId: string, text: string, revision: number,
    documentPath: string, requestedTheme: PreviewThemeId, senderId: number): Promise<RenderResult> {
    const preview = this.options.previews.views.get(tabId);
    if (!preview || preview.ownerWebContentsId !== senderId) throw new Error('The preview is not owned by this window.');
    if (!state.currentDocument) throw new Error('No Markdown document is open.');
    if (state.currentDocument.path !== documentPath) {
      throw new Error('The preview request belongs to a document that is no longer open.');
    }
    state.currentDocument = applyTextRevision(state.currentDocument, text, revision);
    const renderPath = state.currentDocument.path;
    const themeId = normalizePreviewTheme(requestedTheme);
    state.activeRoot = path.dirname(renderPath);
    const hasPage = preview.view.webContents.getURL().startsWith('marktex-preview://document/');
    const rendered = await this.render(tabId, text, revision, renderPath, themeId, hasPage);
    if (state.currentDocument?.path !== renderPath) throw new Error('The document changed while its preview was being prepared.');
    preview.view.setBackgroundColor(previewThemeBackground(themeId));
    if (hasPage) this.options.previews.syncTheme(preview.view, themeId);
    if (typeof rendered.template === 'string') {
      const url = this.options.previews.storeDocument(rendered.template, themeId);
      await this.options.previews.loadURL(preview.view, url, senderId);
      this.options.previews.markTheme(preview.view.webContents, themeId);
      setImmediate(() => this.options.previews.ensureSpare(senderId));
      return { revision, url, themeId };
    }
    const shared = { totalLineCount: rendered.totalLineCount, revision, baseHref: rendered.baseHref };
    if (typeof rendered.html === 'string') {
      const updated = this.options.previews.waitForUpdate(tabId, revision);
      preview.view.webContents.send('preview:command', {
        command: 'marktex:update-html', html: rendered.html, markdown: text, ...shared,
      });
      await updated;
      setImmediate(() => this.options.previews.ensureSpare(senderId));
      return { revision, url: preview.view.webContents.getURL(), themeId };
    }
    if (!rendered.patch) {
      preview.view.webContents.send('preview:command', { command: 'marktex:sync-config', ...shared });
      return { revision, url: preview.view.webContents.getURL(), themeId };
    }
    const updated = this.options.previews.waitForUpdate(tabId, revision);
    preview.view.webContents.send('preview:command', {
      command: 'marktex:patch-blocks', ...rendered.patch, markdown: text, ...shared,
    });
    await updated;
    return { revision, url: preview.view.webContents.getURL(), themeId };
  }
}
