import { utilityProcess } from 'electron';
import path from 'node:path';
import type { RenderResult } from '../../shared/contracts';
import { applyTextRevision } from '../../shared/document-state';
import type { PreviewBlockPatch } from '../../shared/preview-blocks';
import { normalizePreviewTheme, previewThemeBackground, type PreviewThemeId } from '../../shared/preview-preferences';
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
