import { PreviewRenderCoordinator } from '../../shared/preview-render-coordinator';
import { clampAnchor, type BandLine, type ViewportAnchor } from '../../shared/viewport-anchor';
import type { DocumentTab } from '../tabs/tab-state';
import { view } from '../view-state.svelte';
import type { ReaderController } from './reader-controller';

type Options = {
  tabs: DocumentTab[];
  active: () => DocumentTab | null;
  activeId: () => string | null;
  text: () => string | null;
  lineCount: () => number;
  reader: ReaderController;
};

export class PreviewSession {
  private coordinator = this.createCoordinator();
  private epoch = 0;
  private timer: number | null = null;
  private idleTimer: number | null = null;
  private error: { revision: number; message: string } | null = null;
  private positionRequest = 0;
  private readonly listeners = new Set<(payload: {
    tabId: string; message: Record<string, unknown>;
  }) => void>();

  constructor(private readonly options: Options) {}

  get generation() { return this.epoch; }
  get readyRevision() { return this.coordinator.readyRevision; }
  set readyRevision(value: number | null) { this.coordinator.readyRevision = value; }

  private createCoordinator() {
    return new PreviewRenderCoordinator((revision) => this.render(revision));
  }

  cancelSchedule() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.timer = this.idleTimer = null;
  }

  reset() {
    this.epoch += 1;
    this.cancelSchedule();
    this.coordinator.reset();
    this.error = null;
    this.updateUi();
  }

  newSession() {
    this.reset();
    this.coordinator = this.createCoordinator();
  }

  schedule(targetRevision: number) {
    const checkpoint = () => {
      const tab = this.options.active();
      if (tab?.surface === 'editor' && tab.revision >= targetRevision) void this.ensure(tab.revision);
    };
    this.timer ??= window.setTimeout(() => {
      this.timer = null;
      checkpoint();
    }, 500);
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      checkpoint();
    }, 150);
  }

  updateUi() {
    const tab = this.options.active();
    const refreshing = this.options.reader.awaiting
      || (tab?.surface === 'viewer'
        && this.coordinator.isRendering
        && this.readyRevision !== tab.revision);
    view.rendering = !!refreshing;
    view.renderVariant = this.options.reader.awaiting || this.readyRevision === null
      ? 'blocking' : 'refresh';
    const relevantError = tab?.surface === 'viewer' && this.error?.revision === tab.revision;
    view.renderError = relevantError && this.error ? this.error.message : '';
    view.renderErrorVariant = this.readyRevision === null ? 'blocking' : 'refresh';
    this.options.reader.syncView();
  }

  private async render(targetRevision: number) {
    const tab = this.options.active();
    const tabId = this.options.activeId();
    if (!tab || !tabId || targetRevision !== tab.revision) return false;
    const epoch = this.epoch;
    const theme = this.options.reader.themeId;
    const documentPath = tab.document.path;
    const text = this.options.text();
    if (text === null) return false;
    if (this.error?.revision === targetRevision) this.error = null;
    try {
      const result = await window.marktex.preparePreview(
        tabId, text, targetRevision, documentPath, theme,
      );
      if (!this.isCurrent(epoch, tabId, documentPath)
        || result.revision !== targetRevision || result.themeId !== theme) return false;

      const rendered = this.options.tabs.find((candidate) => candidate.id === tabId);
      if (rendered?.document.path === documentPath && rendered.revision >= targetRevision) {
        if (result.url) rendered.previewUrl = result.url;
        rendered.previewRevision = targetRevision;
        rendered.previewTheme = theme;
      }
      if (rendered && this.options.reader.themeId !== theme) {
        const assets = await window.marktex.getPreviewThemeAssets(this.options.reader.themeId);
        if (this.options.reader.themeId === assets.themeId) {
          this.options.reader.applyAssets(rendered, assets);
        }
      }
      this.options.reader.send(tabId, { command: 'marktex:collect-headings' });
      if (rendered?.find.open && rendered.find.query) {
        this.options.reader.send(tabId, {
          command: 'marktex:find',
          query: rendered.find.query,
          direction: 'forward',
          findNext: false,
        });
      }
      if (!this.isCurrent(epoch, tabId, documentPath)) return false;
      this.error = null;
      return true;
    } catch (error) {
      if (epoch !== this.epoch) return false;
      this.error = {
        revision: targetRevision,
        message: error instanceof Error ? error.message : String(error),
      };
      return false;
    }
  }

  private isCurrent(epoch: number, tabId: string, documentPath: string) {
    const active = this.options.active();
    return epoch === this.epoch
      && this.options.activeId() === tabId
      && active?.document.path === documentPath;
  }

  async ensure(revision: number) {
    const pending = this.coordinator.ensure(revision);
    this.updateUi();
    const ready = await pending;
    this.updateUi();
    return ready;
  }

  position(
    target: ViewportAnchor,
    revision: number,
    tabId = this.options.activeId() ?? '',
    lineCount = this.options.lineCount(),
    settle = true,
    band: BandLine[] = [],
  ): Promise<boolean> {
    const revealed = clampAnchor(target, lineCount);
    const requestId = ++this.positionRequest;
    return new Promise((resolve) => {
      const cleanup = () => {
        this.listeners.delete(handle);
        window.clearTimeout(timeout);
      };
      const handle = (payload: { tabId: string; message: Record<string, unknown> }) => {
        const message = payload.message;
        if (payload.tabId !== tabId || message.source !== 'crossnote'
          || message.type !== 'marktex:preview-positioned'
          || message.revision !== revision || message.requestId !== requestId) return;
        cleanup();
        resolve(true);
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        resolve(false);
      }, 1000);
      this.listeners.add(handle);
      this.options.reader.send(tabId, {
        command: 'marktex:position-preview',
        sourceLine: revealed.sourceLine,
        topRatio: revealed.yRatio,
        band,
        requestId,
        settle,
      });
    });
  }

  receive(payload: { tabId: string; message: Record<string, unknown> }) {
    for (const listener of this.listeners) listener(payload);
  }
}
