import { utilityProcess } from 'electron';
import path from 'node:path';
import type { GitDiff, GitDiffPreviewResult, RenderResult } from '../../protocol/desktop-api';
import { applyTextRevision } from '../../core/document/document-state';
import type { PreviewBlockPatch } from '../../core/preview/preview-blocks';
import { responsiveRenderedDiff, RENDERED_DIFF_STYLES } from '../../core/preview/rendered-diff';
import { replaceInitialPreviewHtml } from '../../core/preview/preview-install';
import { normalizePreviewTheme, previewThemeBackground, type PreviewThemeId } from '../../core/preview/preview-preferences';
import type { WindowState } from '../windows/window-state';
import type { PreviewManager } from './preview-manager';

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
  private readonly waiters = new Map<number, {
    resolve: (value: WorkerResult) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly options: Options) {}

  warmup() {
    this.ensureWorker();
  }

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
        baseHref: String(reply.baseHref ?? ''),
        themeId: normalizePreviewTheme(reply.themeId),
        template: reply.template,
        html: reply.html,
        patch: reply.patch,
      });
    });
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null;
      for (const waiter of this.waiters.values()) {
        waiter.reject(new Error('The preview renderer stopped.'));
      }
      this.waiters.clear();
    });
    return worker;
  }

  private render(
    tabId: string,
    text: string,
    revision: number,
    documentPath: string,
    themeId: PreviewThemeId,
    hasPage: boolean,
    deferOffscreenHtml = true,
  ) {
    const worker = this.ensureWorker();
    const id = ++this.requestId;
    return new Promise<WorkerResult>((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      worker.postMessage({
        kind: 'render', id, tabId, text, revision, documentPath, themeId,
        roots: this.options.roots(), hasPage, deferOffscreenHtml,
      });
    });
  }

  forgetNotebooks() {
    this.worker?.postMessage({ kind: 'forget-notebooks' });
  }

  forgetTab(tabId: string) {
    this.worker?.postMessage({ kind: 'forget-tab', tabId });
  }

  async renderExport(state: WindowState, text: string, revision: number, documentPath: string) {
    const tabId = `export:${Date.now()}-${Math.random().toString(36).slice(2)}`;
    state.activeRoot = path.dirname(documentPath);
    const rendered = await this.render(
      tabId, text, revision, documentPath, this.options.theme(), false, false,
    );
    this.forgetTab(tabId);
    if (typeof rendered.template !== 'string') {
      throw new Error('The preview renderer did not return a page.');
    }
    return this.options.previews.storeDocument(rendered.template);
  }

  async prepareDiff(
    state: WindowState,
    tabId: string,
    diff: GitDiff,
    requestedTheme: PreviewThemeId,
    senderId: number,
  ): Promise<GitDiffPreviewResult> {
    const preview = this.options.previews.views.get(tabId);
    const themeId = normalizePreviewTheme(requestedTheme);
    const unsupported = (): GitDiffPreviewResult => ({
      revision: 0, url: null, themeId, supported: false,
    });
    if (!preview || preview.ownerWebContentsId !== senderId
      || diff.originalText === null || diff.modifiedText === null) return unsupported();
    if (!/\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(diff.filePath)) {
      return unsupported();
    }

    state.activeRoot = path.dirname(diff.filePath);
    const originalId = `${tabId}:original`;
    const modifiedId = `${tabId}:modified`;
    try {
      const [original, modified] = await Promise.all([
        this.render(originalId, diff.originalText, 0, diff.filePath, themeId, false, false),
        this.render(modifiedId, diff.modifiedText, 0, diff.filePath, themeId, false, false),
      ]);
      if (typeof original.html !== 'string' || typeof modified.html !== 'string'
        || typeof modified.template !== 'string') return unsupported();
      const merged = responsiveRenderedDiff(original.html, modified.html, diff.hunks);
      const installed = replaceInitialPreviewHtml(modified.template, merged);
      if (!installed) return unsupported();
      const page = installed.replace('</head>', `${RENDERED_DIFF_STYLES}</head>`);
      const url = this.options.previews.storeDocument(page, themeId);
      preview.view.setBackgroundColor(previewThemeBackground(themeId));
      await preview.view.webContents.loadURL(url);
      this.options.previews.markTheme(preview.view.webContents, themeId);
      setImmediate(() => this.options.previews.ensureSpare(senderId));
      return { revision: 0, url, themeId, supported: true };
    } finally {
      this.forgetTab(originalId);
      this.forgetTab(modifiedId);
    }
  }

  async prepare(
    state: WindowState,
    tabId: string,
    text: string,
    revision: number,
    documentPath: string,
    requestedTheme: PreviewThemeId,
    senderId: number,
  ): Promise<RenderResult> {
    const preview = this.options.previews.views.get(tabId);
    if (!preview || preview.ownerWebContentsId !== senderId) {
      throw new Error('The preview is not owned by this window.');
    }
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
    if (state.currentDocument?.path !== renderPath) {
      throw new Error('The document changed while its preview was being prepared.');
    }
    preview.view.setBackgroundColor(previewThemeBackground(themeId));
    if (hasPage) this.options.previews.syncTheme(preview.view, themeId);

    if (typeof rendered.template === 'string') {
      const url = this.options.previews.storeDocument(rendered.template, themeId);
      await preview.view.webContents.loadURL(url);
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
