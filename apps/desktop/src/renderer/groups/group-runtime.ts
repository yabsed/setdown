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
  let dragging = false, resizing = false, overlayDepth = 0, hadBackgrounds = false;
  let signature = '';
  const preparing = new Set<string>();
  const failedPreparations = new Map<string, string>();
  const { workspace, desktop, editor, reader } = options;
  const area = document.querySelector<HTMLElement>('.editor-area')!;
  function backgrounds(frozen = false) {
    const entries = dragging || resizing || overlayDepth > 0 || frozen ? [] : workspace.groups.groups.flatMap(group => {
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
          preparing.delete(tab.id); backgrounds();
        });
      }
      if (!tab.previewUrl || tab.previewTheme !== reader.themeId) return [];
      return [{ tabId: tab.id, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }];
    });
    const next = JSON.stringify(entries);
    if ((!hadBackgrounds && !entries.length) || signature === next) return;
    hadBackgrounds = entries.length > 0;
    signature = next;
    desktop.setBackgroundPreviews(entries);
  }
  function sync() {
    editor.syncGroups(workspace.groups.groups, workspace.groups.focusedId);
    backgrounds();
    if (!dragging && !resizing) reader.syncView();
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
  window.addEventListener('setdown:native-overlay-visibility', ((event: CustomEvent<boolean>) => {
    overlayDepth = Math.max(0, overlayDepth + (event.detail ? 1 : -1)); backgrounds();
  }) as EventListener);
  function manipulationChanged(previous: boolean) {
    const hidden = dragging || resizing;
    reader.layoutHidden = hidden;
    // Reuse the readers' balanced snapshot/freeze lifecycle, including Git review.
    // A canceled drag must restore whichever surface owned the native foreground.
    if (hidden !== previous) window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: hidden }));
    backgrounds();
    if (hidden) desktop.showPreview(null, null); else sync();
  }
  window.addEventListener('setdown:group-resize', ((event: CustomEvent<boolean>) => {
    const previous = dragging || resizing;
    resizing = event.detail;
    manipulationChanged(previous);
  }) as EventListener);
  return { sync, backgrounds, drag(active: boolean) {
    const previous = dragging || resizing;
    dragging = active;
    manipulationChanged(previous);
  } };
}
