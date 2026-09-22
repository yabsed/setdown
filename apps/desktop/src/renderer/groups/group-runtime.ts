import type { WorkspaceState } from '../../core/workspace/workspace-state';
import type { MonacoEditor } from '../adapters/monaco-editor';
import type { DesktopPort } from '../ports/desktop-port';
import type { ReaderController } from '../reader/reader-controller';
import { project } from '../project/project-state.svelte';

/** Keeps native readers and Monaco instances in their group's live geometry. */
export function createGroupRuntime(options: {
  workspace: WorkspaceState; desktop: DesktopPort; editor: MonacoEditor;
  reader: ReaderController; activate(id: string): void;
}) {
  type BackgroundEntry = { tabId: string; bounds: { x: number; y: number; width: number; height: number } };
  let dragging = false, overlayDepth = 0, overlayToken = 0;
  let backgroundEntries: BackgroundEntry[] = [];
  let frozenBackgrounds = new Set<string>();
  const preparing = new Set<string>();
  const failedPreparations = new Map<string, string>();
  const { workspace, desktop, editor, reader } = options;
  const area = document.querySelector<HTMLElement>('.editor-area')!;
  function backgrounds() {
    const available = workspace.groups.groups.flatMap(group => {
      if (group.id === workspace.groups.focusedId) return [];
      const tab = group.activeId ? workspace.find(group.activeId) : null;
      const host = area.querySelector<HTMLElement>(`.group-body[data-group-id="${group.id}"]`);
      if (!tab || tab.surface !== 'viewer' || !host) return [];
      const rect = host.getBoundingClientRect();
      const preparationKey = JSON.stringify([tab.document.path, tab.revision, reader.themeId]);
      if ((!tab.previewUrl || tab.previewRevision !== tab.revision) && !preparing.has(tab.id)
        && failedPreparations.get(tab.id) !== preparationKey) {
        const revision = tab.revision, theme = reader.themeId, path = tab.document.path;
        preparing.add(tab.id);
        reader.send(tab.id, { command: 'marktex:prime-document', bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
        void desktop.preparePreview(tab.id, tab.text, revision, path, theme).then(result => {
          if (!workspace.find(tab.id) || tab.revision !== revision || tab.document.path !== path
            || result.revision !== revision || result.themeId !== reader.themeId) return;
          if (result.url) tab.previewUrl = result.url;
          tab.previewRevision = revision; tab.previewTheme = result.themeId;
          reader.send(tab.id, { command: 'marktex:position-preview', sourceLine: tab.anchor.sourceLine,
            topRatio: tab.anchor.yRatio, settle: false });
        }).catch(error => {
          failedPreparations.set(tab.id, preparationKey);
          console.error('Could not prepare editor group', error);
        }).finally(() => {
          preparing.delete(tab.id); reader.syncView();
        });
      }
      if (!tab.previewUrl || tab.previewTheme !== reader.themeId) return [];
      return [{ tabId: tab.id, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }];
    });
    backgroundEntries = available;
    const entries = available.filter(entry => !frozenBackgrounds.has(entry.tabId));
    return entries;
  }
  function sync() {
    editor.syncGroups(workspace.groups.groups, workspace.groups.focusedId);
    if (!dragging) reader.syncView();
  }
  function focusSurface(event: Event) {
    const element = event.target as HTMLElement;
    const media = element.closest<HTMLElement>('[data-media-tab]');
    const groupId = element.closest<HTMLElement>('[data-group-id]')?.dataset.groupId;
    const group = workspace.groups.groups.find(g => g.id === groupId);
    const tabId = media?.dataset.mediaTab ?? group?.activeId;
    // Tab clicks perform their own activation; do not activate the old selected
    // tab first, which would race an asynchronous document activation.
    if (!element.closest('.tab-strip') && tabId && (tabId !== workspace.activeId || project.gitDiffActive)) options.activate(tabId);
  }
  area.addEventListener('pointerdown', focusSurface, true);
  area.addEventListener('focusin', focusSurface);
  const observer = new ResizeObserver(sync);
  observer.observe(area);
  async function freezeBackgroundPreviews() {
    overlayDepth += 1;
    if (overlayDepth > 1) return;
    const token = ++overlayToken;
    const captures = await Promise.all(backgroundEntries.map(async entry => {
      const body = area.querySelector<HTMLElement>(`.group-body[data-group-id="${workspace.groups.owner(entry.tabId)?.id ?? ''}"]`);
      const image = await desktop.capturePreview(entry.tabId).catch(() => null);
      return image && body ? { tabId: entry.tabId, body, image } : null;
    }));
    if (token !== overlayToken || overlayDepth === 0) return;
    const captured = captures.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    for (const { body, image } of captured) {
      body.style.backgroundImage = `url("${image}")`;
      body.dataset.nativePreviewFrozen = 'true';
    }
    if (captured.length) await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (token !== overlayToken || overlayDepth === 0) return;
    frozenBackgrounds = new Set(captured.map(entry => entry.tabId));
    reader.syncView();
  }
  function unfreezeBackgroundPreviews() {
    if (overlayDepth === 0 || --overlayDepth > 0) return;
    overlayToken += 1;
    frozenBackgrounds = new Set();
    // Restore native views before removing the painted replacement.
    reader.syncView();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (overlayDepth > 0) return;
      for (const body of area.querySelectorAll<HTMLElement>('.group-body[data-native-preview-frozen="true"]')) {
        body.style.backgroundImage = '';
        delete body.dataset.nativePreviewFrozen;
      }
    }));
  }
  window.addEventListener('setdown:native-overlay-visibility', ((event: CustomEvent<boolean>) => {
    if (event.detail) void freezeBackgroundPreviews(); else unfreezeBackgroundPreviews();
  }) as EventListener);
  function manipulationChanged(previous: boolean) {
    const hidden = dragging;
    reader.layoutHidden = hidden;
    // Reuse the readers' balanced snapshot/freeze lifecycle, including Git review.
    // A canceled drag must restore whichever surface owned the native foreground.
    if (hidden !== previous) window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: hidden }));
    if (!hidden) sync();
  }
  return { sync, backgrounds, drag(active: boolean) {
    const previous = dragging;
    dragging = active;
    manipulationChanged(previous);
  } };
}
