import type { PreviewHeading, ThemeSnapshot } from '../../shared/contracts';
import {
  normalizePreviewTheme,
  type PreviewThemeAssets,
  type PreviewThemeId,
} from '../../shared/preview-preferences';
import type { DocumentTab } from '../tabs/tab-state';
import { view } from '../view-state.svelte';
import {
  GOLDEN_TOP_RATIO,
  clamp,
  clampAnchor,
  type ViewportAnchor,
} from '../../shared/viewport-anchor';

type Options = {
  shell: HTMLElement;
  frames: HTMLElement;
  tabs: DocumentTab[];
  active: () => DocumentTab | null;
  activeId: () => string | null;
  initialTheme: ThemeSnapshot;
  applyProductTheme: (theme: PreviewThemeId) => void;
  edit: (anchor: ViewportAnchor) => void;
  anchorChanged: () => void;
};

export class ReaderController {
  themeId: PreviewThemeId;
  awaiting = false;
  private appliedThemeRevision: number;
  private transitionTabId: string | null = null;
  private freezeDepth = 0;
  private freezeToken = 0;

  constructor(private readonly options: Options) {
    this.themeId = options.initialTheme.id;
    this.appliedThemeRevision = options.initialTheme.revision;
    window.addEventListener('setdown:menu-visibility', ((event: CustomEvent<boolean>) => {
      if (event.detail) void this.freeze();
      else this.unfreeze();
    }) as EventListener);
  }

  send(tabId: string, message: Record<string, unknown>) {
    window.marktex.sendPreviewCommand(tabId, message);
  }

  create(tabId: string) {
    window.marktex.createPreview(tabId);
  }

  destroy(tabId: string) {
    window.marktex.destroyPreview(tabId);
  }

  syncUi = () => {
    const tab = this.options.active();
    const visible = tab?.surface === 'viewer';
    view.tocOpen = !!tab?.tocOpen;
    view.headings = tab?.headings ?? [];
    view.activeHeadingId = tab?.activeHeadingId ?? null;
    view.findOpen = !!tab?.find.open;
    view.findQuery = tab?.find.query ?? '';
    view.findActive = tab?.find.activeMatch ?? 0;
    view.findMatches = tab?.find.matches ?? 0;
    this.options.shell.dataset.tocOpen = view.tocOpen && visible ? 'true' : 'false';
    this.options.shell.dataset.findOpen = tab?.find.open && visible ? 'true' : 'false';
  };

  find(query: string, direction: 'forward' | 'backward' = 'forward', findNext = false) {
    const tab = this.options.active();
    if (!tab) return;
    Object.assign(tab.find, { query, activeMatch: 0, matches: 0 });
    view.findActive = 0;
    view.findMatches = 0;
    this.send(tab.id, query
      ? { command: 'marktex:find', query, direction, findNext }
      : { command: 'marktex:stop-find' });
  }

  openFind() {
    const tab = this.options.active();
    if (!tab || tab.surface !== 'viewer') return;
    tab.find.open = true;
    this.syncUi();
    this.syncView();
    if (tab.find.query) this.find(tab.find.query);
  }

  closeFind(clearQuery = false) {
    const tab = this.options.active();
    if (!tab) return;
    this.send(tab.id, { command: 'marktex:stop-find' });
    Object.assign(tab.find, { open: false, activeMatch: 0, matches: 0 });
    if (clearQuery) tab.find.query = '';
    this.syncUi();
    this.syncView();
  }

  applyAssets(tab: DocumentTab, assets: PreviewThemeAssets) {
    if (tab.previewUrl) this.send(tab.id, { command: 'marktex:apply-theme', ...assets });
  }

  async applyTheme(snapshot: ThemeSnapshot, forceAssets = false) {
    const next = normalizePreviewTheme(snapshot.id);
    if (snapshot.revision < this.appliedThemeRevision) return;
    if (!forceAssets && snapshot.revision === this.appliedThemeRevision && this.themeId === next) return;
    this.appliedThemeRevision = snapshot.revision;
    this.transitionTabId = this.options.activeId();
    this.themeId = next;
    this.options.applyProductTheme(next);
    this.syncUi();
    const assets = await window.marktex.getPreviewThemeAssets(next);
    if (this.appliedThemeRevision !== snapshot.revision || this.themeId !== assets.themeId) return;
    for (const tab of this.options.tabs) this.applyAssets(tab, assets);
    this.syncView();
  }

  acceptAppliedTheme(tabId: string, value: unknown) {
    const tab = this.options.tabs.find((candidate) => candidate.id === tabId);
    const themeId = normalizePreviewTheme(value);
    if (!tab || themeId !== this.themeId) return;
    tab.previewTheme = themeId;
    if (this.transitionTabId === tab.id) this.transitionTabId = null;
    this.syncView();
  }

  handleMessage(payload: { tabId: string; message: Record<string, unknown> }) {
    const message = payload.message;
    if (message.source !== 'crossnote') return;
    if (message.type === 'marktex:open-find') {
      if (payload.tabId === this.options.activeId()) this.openFind();
      return;
    }
    if (message.type === 'marktex:theme-applied') {
      this.acceptAppliedTheme(payload.tabId, message.themeId);
      return;
    }
    const tab = this.options.active();
    if (!tab || payload.tabId !== tab.id) return;
    if (message.type === 'marktex:headings') {
      if (message.revision !== tab.revision || !Array.isArray(message.headings)) return;
      tab.headings = message.headings.slice(0, 500).flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const heading = candidate as Record<string, unknown>;
        const level = Number(heading.level);
        if (typeof heading.id !== 'string' || typeof heading.text !== 'string'
          || !Number.isInteger(level) || level < 1 || level > 6) return [];
        return [{
          id: heading.id.slice(0, 512),
          text: heading.text.slice(0, 500),
          level: level as PreviewHeading['level'],
          sourceLine: Number.isFinite(Number(heading.sourceLine))
            ? Number(heading.sourceLine) : undefined,
        }];
      });
      this.syncUi();
      return;
    }
    if (message.type === 'marktex:active-heading') {
      if (message.revision !== tab.revision) return;
      tab.activeHeadingId = typeof message.id === 'string' ? message.id : null;
      this.syncUi();
      return;
    }
    if (message.type === 'marktex:find-result') {
      if (message.revision !== tab.revision) return;
      tab.find.activeMatch = Math.max(0, Number(message.activeMatch) || 0);
      tab.find.matches = Math.max(0, Number(message.matches) || 0);
      this.syncUi();
      return;
    }
    if (message.type === 'marktex:viewport-state') {
      if (message.revision !== tab.revision) return;
      tab.anchor = clampAnchor(this.messageAnchor(message.anchor),
        tab.model?.getLineCount() ?? Math.max(1, tab.text.split(/\r\n|\r|\n/).length));
      tab.viewerScrollRatio = Number.isFinite(Number(message.scrollRatio))
        ? clamp(Number(message.scrollRatio), 0, 1) : null;
      this.options.anchorChanged();
      return;
    }
    if (message.type === 'edit-at-anchor') {
      this.options.edit(this.messageAnchor(message.anchor));
      return;
    }
    if (message.command === 'clickTagA') {
      const href = (message.args as Array<{ href?: string }> | undefined)?.[0]?.href;
      if (href) void window.marktex.openLink(href);
    }
  }

  private messageAnchor(value: unknown): ViewportAnchor {
    const anchor = value as Partial<ViewportAnchor> | undefined;
    return {
      sourceLine: Number(anchor?.sourceLine) || 1,
      sourceColumn: Number(anchor?.sourceColumn) || undefined,
      sourceEndLine: Number(anchor?.sourceEndLine) || undefined,
      yRatio: Number.isFinite(Number(anchor?.yRatio))
        ? clamp(Number(anchor?.yRatio), 0, 1) : GOLDEN_TOP_RATIO,
      reason: anchor?.reason ?? 'scroll-ratio',
      confidence: anchor?.confidence ?? 'fallback',
    };
  }

  syncView = () => {
    const tab = this.options.active();
    const visible = !!tab
      && tab.surface === 'viewer'
      && !!tab.previewUrl
      && (tab.previewTheme === this.themeId || tab.id === this.transitionTabId)
      && this.freezeDepth === 0
      && !this.awaiting;
    if (!visible || !tab) {
      window.marktex.showPreview(null, null);
      return;
    }
    const rect = this.options.frames.getBoundingClientRect();
    const reserved = tab.find.open ? 60 : 0;
    window.marktex.showPreview(tab.id, {
      x: rect.left,
      y: rect.top + reserved,
      width: rect.width,
      height: Math.max(0, rect.height - reserved),
    });
  };

  private async freeze() {
    this.freezeDepth += 1;
    if (this.freezeDepth > 1) return;
    const token = ++this.freezeToken;
    const tab = this.options.active();
    if (!tab || tab.surface !== 'viewer' || !tab.previewUrl) return;
    const image = await window.marktex.capturePreview(tab.id).catch(() => null);
    if (token !== this.freezeToken || this.freezeDepth === 0) return;
    if (image) {
      this.options.frames.style.backgroundImage = `url("${image}")`;
      this.options.frames.dataset.frozen = 'true';
    }
    this.syncView();
  }

  private unfreeze() {
    if (this.freezeDepth === 0 || --this.freezeDepth > 0) return;
    this.freezeToken += 1;
    this.syncView();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (this.freezeDepth > 0) return;
      this.options.frames.style.backgroundImage = '';
      delete this.options.frames.dataset.frozen;
    }));
  }
}
