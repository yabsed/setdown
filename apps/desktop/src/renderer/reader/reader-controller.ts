import type { PrimeDocumentCommand } from '../../protocol/preview-preparation';
import type { PreviewHeading, ThemeSnapshot } from '../../protocol/desktop-api';
import {
  normalizePreviewTheme,
  type PreviewThemeAssets,
  type PreviewThemeId,
} from '../../core/preview/preview-preferences';
import type { WorkspaceTab } from '../../core/workspace/workspace-state';
import { hasMarkdownPreview } from '../../core/document/document-capabilities';
import type { DesktopPort } from '../ports/desktop-port';
import { view } from '../view-state.svelte';
import {
  GOLDEN_TOP_RATIO,
  clamp,
  clampAnchor,
  type ViewportAnchor,
} from '../../core/preview/viewport-anchor';

type Options = {
  desktop: DesktopPort;
  shell: HTMLElement;
  frames: HTMLElement;
  tabs: WorkspaceTab[];
  active: () => WorkspaceTab | null;
  activeId: () => string | null;
  initialTheme: ThemeSnapshot;
  applyProductTheme: (theme: PreviewThemeId) => void;
  edit: (anchor: ViewportAnchor) => void;
  anchorChanged: () => void;
};

type SearchTarget = { line: number; lineOccurrence: number; ordinal: number };

export class ReaderController {
  themeId: PreviewThemeId;
  awaiting = false;
  private appliedThemeRevision: number;
  private transitionTabId: string | null = null;
  private projectQuery = '';
  private searchSource: 'find' | 'project' = 'project';
  private freezeDepth = 0;
  private frozen = false;
  private freezeToken = 0;
  private suspended = false;

  constructor(private readonly options: Options) {
    this.themeId = options.initialTheme.id;
    this.appliedThemeRevision = options.initialTheme.revision;
    window.addEventListener('setdown:native-overlay-visibility', ((event: CustomEvent<boolean>) => {
      if (event.detail) void this.freeze();
      else this.unfreeze();
    }) as EventListener);
  }

  send(tabId: string, message: Record<string, unknown>) {
    this.options.desktop.sendPreviewCommand(tabId, message);
  }

  create(tabId: string) {
    this.options.desktop.createPreview(tabId);
  }

  destroy(tabId: string) {
    this.options.desktop.destroyPreview(tabId);
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
    this.searchSource = 'find';
    const queryChanged = query !== tab.find.query;
    tab.find.query = query;
    if (!findNext || queryChanged) {
      Object.assign(tab.find, { activeMatch: 0, matches: 0 });
      view.findActive = 0;
      view.findMatches = 0;
    }
    this.send(tab.id, query
      ? { command: 'marktex:find', query, direction, findNext }
      : { command: 'marktex:stop-find' });
  }

  openFind() {
    const tab = this.options.active();
    if (!tab || tab.surface !== 'viewer') return;
    tab.find.open = true;
    this.searchSource = 'find';
    this.syncUi();
    this.syncView();
    this.restoreSearch(tab);
  }

  closeFind(clearQuery = false) {
    const tab = this.options.active();
    if (!tab) return;
    Object.assign(tab.find, { open: false, activeMatch: 0, matches: 0 });
    if (clearQuery) tab.find.query = '';
    this.searchSource = 'project';
    this.syncUi();
    this.syncView();
    this.restoreSearch(tab);
  }

  projectSearch(query: string, target?: SearchTarget) {
    const tab = this.options.active();
    this.projectQuery = query.slice(0, 512);
    this.searchSource = this.projectQuery ? 'project' : tab?.find.open ? 'find' : 'project';
    if (this.projectQuery && tab?.find.open) {
      tab.find.open = false;
      this.syncUi();
      this.syncView();
    }
    this.restoreSearch(tab, target);
  }

  restoreSearch(
    tab: WorkspaceTab | null | undefined = this.options.active(),
    target?: SearchTarget,
  ) {
    if (!tab?.previewUrl) return;
    const local = this.searchSource === 'find' && tab.find.open;
    const query = local ? tab.find.query : this.projectQuery;
    this.send(tab.id, query ? {
      command: 'marktex:find',
      query,
      direction: 'forward',
      findNext: false,
      sourceLine: target?.line,
      sourceOccurrence: target?.lineOccurrence,
      searchOrdinal: target?.ordinal,
    } : { command: 'marktex:stop-find' });
  }

  applyAssets(tab: WorkspaceTab, assets: PreviewThemeAssets) {
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
    const assets = await this.options.desktop.getPreviewThemeAssets(next);
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
      if (message.revision !== tab.revision || tab.surface !== 'viewer') return;
      tab.anchor = clampAnchor(
        this.messageAnchor(message.anchor),
        Math.max(1, tab.text.split(/\r\n|\r|\n/).length),
      );
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
      if (href) void this.options.desktop.openLink(href);
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
    // Git review owns the shared native preview layer while it is active.
    // Document resize/overlay callbacks must not hide that view afterward.
    if (this.suspended) return;
    const tab = this.options.active();
    const visible = !!tab
      && tab.surface === 'viewer'
      && !!tab.previewUrl
      && (tab.previewTheme === this.themeId || tab.id === this.transitionTabId)
      && !this.suspended
      && !this.frozen
      && !this.awaiting;
    if (!visible || !tab) {
      this.options.desktop.showPreview(null, null);
      if (tab?.surface === 'editor' && hasMarkdownPreview(tab.document)) {
        // The reader keeps its layout while the source editor covers it. Prepare
        // at that size without showing/focusing the native preview.
        const rect = this.options.frames.getBoundingClientRect();
        this.send(tab.id, { command: 'marktex:prime-document', bounds: {
          x: rect.left, y: rect.top, width: rect.width, height: rect.height,
        } } satisfies PrimeDocumentCommand);
      }
      return;
    }
    const rect = this.options.frames.getBoundingClientRect();
    const reserved = tab.find.open ? 60 : 0;
    this.options.desktop.showPreview(tab.id, {
      x: rect.left,
      y: rect.top + reserved,
      width: rect.width,
      height: Math.max(0, rect.height - reserved),
    });
  };

  setSuspended(value: boolean) {
    this.suspended = value;
    this.syncView();
  }

  private async freeze() {
    this.freezeDepth += 1;
    if (this.freezeDepth > 1) return;
    const token = ++this.freezeToken;
    if (this.suspended) return;
    const tab = this.options.active();
    if (!tab || tab.surface !== 'viewer' || !tab.previewUrl) return;
    const image = await this.options.desktop.capturePreview(tab.id).catch(() => null);
    if (token !== this.freezeToken || this.freezeDepth === 0) return;
    if (image) {
      this.options.frames.style.backgroundImage = `url("${image}")`;
      this.options.frames.dataset.frozen = 'true';
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      }));
      if (token !== this.freezeToken || this.freezeDepth === 0) return;
    }
    this.frozen = true;
    this.syncView();
  }

  private unfreeze() {
    if (this.freezeDepth === 0 || --this.freezeDepth > 0) return;
    this.freezeToken += 1;
    this.frozen = false;
    this.syncView();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (this.freezeDepth > 0) return;
      this.options.frames.style.backgroundImage = '';
      delete this.options.frames.dataset.frozen;
    }));
  }
}
