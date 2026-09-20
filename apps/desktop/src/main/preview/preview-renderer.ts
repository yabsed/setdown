import { utilityProcess } from 'electron';
import path from 'node:path';
import type { GitDiff, GitDiffPreviewResult, RenderResult } from '../../protocol/desktop-api';
import { applyTextRevision } from '../../core/document/document-state';
import type { PreviewBlockPatch } from '../../core/preview/preview-blocks';
import { normalizePreviewTheme, previewThemeBackground, type PreviewThemeId } from '../../core/preview/preview-preferences';
import type { WindowState } from '../windows/window-state';
import type { PreviewManager } from './preview-manager';
import { ReviewRenderClient, type ReviewAssemblyResult } from './review-render-client';
import { ReviewBaselineCache } from './review-baseline-cache';

type WorkerResult = {
  totalLineCount: number;
  baseHref: string;
  themeId: PreviewThemeId;
  template?: string;
  html?: string;
  patch?: PreviewBlockPatch | null;
  runtime?: 'lean' | 'crossnote';
  requiresFullRuntime?: boolean;
};
type ReviewPage = { url: string; revision: number; pageKey: string; runtime: 'lean' | 'crossnote' };
type Options = {
  previews: PreviewManager & { beforeReviewRender?(owner: number, tabId: string): Promise<void> };
  roots: () => string[];
  theme: () => PreviewThemeId;
  workerPath: string;
};

export class PreviewRenderer {
  private worker: Electron.UtilityProcess | null = null;
  private requestId = 0;
  private reviewRevision = 0;
  private readonly reviews: ReviewRenderClient;
  private readonly reviewPages = new WeakMap<Electron.WebContents, ReviewPage>();
  private readonly reviewSeeds = new WeakMap<Electron.WebContents, Promise<void>>();
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
        runtime: reply.runtime, requiresFullRuntime: reply.requiresFullRuntime,
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
    themeId: PreviewThemeId, hasPage: boolean, deferOffscreenHtml = true, fragmentOnly = false) {
    const worker = this.ensureWorker();
    const id = ++this.requestId;
    return new Promise<WorkerResult>((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      worker.postMessage({ kind: 'render', id, tabId, text, revision, documentPath, themeId,
        roots: this.options.roots(), hasPage, deferOffscreenHtml, fragmentOnly });
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
    let revision = ++this.reviewRevision;
    const unsupported = (): GitDiffPreviewResult => ({ revision, url: null, themeId, supported: false });
    if (!preview || preview.ownerWebContentsId !== senderId
      || diff.originalText === null || diff.modifiedText === null
      || !/\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(diff.filePath)) return unsupported();
    await previews.beforeReviewRender?.(senderId, tabId);
    if (previews.views.get(tabId) !== preview || preview.view.webContents.isDestroyed()) return unsupported();
    if (preview.view.getVisible()) throw new Error('Cannot prepare a visible Git preview.');
    const contents = preview.view.webContents;
    const owned = () => previews.views.get(tabId) === preview
      && preview.ownerWebContentsId === senderId && !contents.isDestroyed();
    const check = () => { if (!owned()) throw new Error('The Git preview was closed or transferred.'); };
    // Join an optional initial standby load rather than racing it with an edit.
    const seed = this.reviewSeeds.get(contents);
    if (seed) { await seed; check(); }
    state.activeRoot = path.dirname(diff.filePath);
    const originalId = `${tabId}:original`;
    const modifiedId = `${tabId}:modified`;
    const cacheId = tabId.replace(/:[ab]$/, '');
    const context = JSON.stringify([diff.filePath, themeId, this.options.roots(), this.baselineEpoch]);
    const epoch = this.baselineEpoch;
    const currentUrl = contents.getURL();
    const page = this.reviewPages.get(contents);
    let reusable = !!page && page.url === currentUrl;
    try {
      const cached = this.baselines.get(cacheId, diff.originalText, context);
      const [original, initialModified] = await Promise.all([
        cached === undefined
          ? this.render(originalId, diff.originalText, revision, diff.filePath, themeId, false, false, true)
          : Promise.resolve({ html: cached }),
        this.render(modifiedId, diff.modifiedText, revision, diff.filePath, themeId, false, false, reusable),
      ]);
      let modified = initialModified;
      check();
      // A lean page that acquires a client-rendered diagram still needs the
      // full runtime. Build it only for this capability transition.
      if (reusable && modified.requiresFullRuntime && page?.runtime !== 'crossnote') {
        modified = await this.render(modifiedId, diff.modifiedText, revision, diff.filePath, themeId, false, false);
        check();
        reusable = false;
      }
      if (typeof original.html !== 'string' || typeof modified.html !== 'string'
        || (!reusable && typeof modified.template !== 'string')) return unsupported();
      if (cached === undefined && epoch === this.baselineEpoch) {
        this.baselines.set(cacheId, diff.originalText, context, original.html,
          2 * (original.html.length + diff.originalText.length + context.length));
      }
      const pageKey = page?.pageKey ?? `${senderId}:${contents.id}:${tabId}`;
      const input = {
        originalHtml: original.html, modifiedHtml: modified.html,
        template: reusable ? undefined : modified.template, needsTemplate: !reusable,
        pageKey, baseRevision: reusable ? page!.revision : null, revision,
      };
      const assembled = await this.reviews.assemble(input);
      check();
      if (!assembled.supported || (!assembled.patch && typeof assembled.html !== 'string')) return unsupported();
      preview.view.setBackgroundColor(previewThemeBackground(themeId));
      let url: string;
      if (reusable) {
        const install = async (update: ReviewAssemblyResult) => {
          check();
          if (contents.getURL() !== currentUrl || preview.view.getVisible()) {
            throw new Error('The Git preview changed during preparation.');
          }
          if (update.patch && (update.patch.baseRevision !== page!.revision || update.patch.revision !== revision)) {
            throw new Error('The comparison worker returned a mismatched row patch.');
          }
          if (!update.supported || (!update.patch && typeof update.html !== 'string')) {
            throw new Error('The comparison worker did not return an installable review.');
          }
          const installed = previews.waitForUpdate(tabId, revision, true);
          try {
            const common = { revision, totalLineCount: modified.totalLineCount, baseHref: modified.baseHref };
            contents.send('preview:command', update.patch
              ? { command: 'marktex:patch-review-rows', patch: update.patch, ...common }
              : { command: 'marktex:update-html', html: update.html, markdown: diff.modifiedText, ...common });
            await installed;
          } catch (error) {
            void installed.catch(() => {});
            throw error;
          }
        };
        previews.syncTheme(preview.view, themeId);
        try {
          await install(assembled);
        } catch (error) {
          if (!assembled.patch) throw error;
          check();
          if (contents.getURL() !== currentUrl || preview.view.getVisible()) throw error;
          // Cache loss or an unexpected DOM base gets a same-page reset. Use a
          // NEW revision so a late ACK of a timed-out patch cannot complete it.
          revision = ++this.reviewRevision;
          const reset = await this.reviews.assemble({ ...input, baseRevision: null, revision });
          await install(reset);
        }
        url = currentUrl;
      } else {
        if (typeof assembled.template !== 'string') return unsupported();
        url = previews.storeDocument(assembled.template, themeId);
        await previews.loadURL(preview.view, url, senderId);
        check();
        previews.markTheme(contents, themeId);
        setImmediate(() => previews.ensureSpare(senderId));
      }
      check();
      if (!this.reviewPages.has(contents)) contents.once('destroyed', () => this.reviews.forget(pageKey));
      const runtime = reusable ? page!.runtime : modified.runtime ?? 'crossnote';
      this.reviewPages.set(contents, { url, revision, pageKey, runtime });
      await previews.prepareReviewViewport(senderId, tabId, revision);
      check();
      if (!reusable && !diff.staged) {
        try { this.seedReviewStandby(tabId, senderId, { url, revision, pageKey, runtime }, themeId); }
        catch { /* Optional warmup must never invalidate a ready front. */ }
      }
      return { revision, url, themeId, supported: true };
    } finally {
      this.forgetTab(originalId);
      this.forgetTab(modifiedId);
    }
  }

  /** Move the second page's one-time DOM construction before the first edit. */
  private seedReviewStandby(tabId: string, ownerId: number,
    source: ReviewPage, themeId: PreviewThemeId): void {
    if (!/^git-diff:.*:[ab]$/.test(tabId)) return;
    const standbyId = tabId.replace(/:[ab]$/, tabId.endsWith(':a') ? ':b' : ':a');
    const previews = this.options.previews;
    if (previews.views.has(standbyId)) return;
    previews.create(ownerId, standbyId);
    const standby = previews.views.get(standbyId);
    if (!standby || standby.ownerWebContentsId !== ownerId || standby.view.getVisible()) return;
    const contents = standby.view.webContents;
    const pageKey = `${ownerId}:${contents.id}:${standbyId}`;
    const bounds = previews.views.get(tabId)?.appliedBounds;
    if (bounds) previews.applyBounds(standby, { ...bounds });
    const task = (async () => {
      // Already sanitized HTML and revision; no extra Markdown/KaTeX/alignment.
      // Existing isolated initial navigation preserves the IME focus boundary.
      await previews.loadURL(standby.view, source.url, ownerId);
      if (previews.views.get(standbyId) !== standby || standby.ownerWebContentsId !== ownerId
        || contents.isDestroyed() || contents.getURL() !== source.url) return;
      this.reviews.seed(source.pageKey, pageKey, source.revision);
      contents.once('destroyed', () => this.reviews.forget(pageKey));
      this.reviewPages.set(contents, { url: source.url, revision: source.revision, pageKey, runtime: source.runtime });
      previews.markTheme(contents, themeId);
    })().catch(() => { /* A failed standby falls back on its next real request. */ });
    this.reviewSeeds.set(contents, task);
    void task.then(() => { if (this.reviewSeeds.get(contents) === task) this.reviewSeeds.delete(contents); });
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
