import { imageSessions } from '../../image/image-edit-sessions';
import { draggedPaths, PROJECT_FILES } from '../../project/explorer/explorer-selection';
import type { ClaimedTabTransfer, TransferableTab } from '../../../protocol/desktop-api';
import { splitDirection, type EditorGroupPlacement, type EditorGroups } from '../../../core/workspace/editor-groups';
import { view } from '../workspace-view.svelte';
import type { WorkspaceTab } from '../../../core/workspace/workspace-state';
import type { DesktopPort } from '../../ports/desktop-port';

type Options = {
  desktop: DesktopPort; shell: HTMLElement; tabs: WorkspaceTab[]; groups: EditorGroups;
  activeId(): string | null; activate(id: string): void;
  serialize(tab: WorkspaceTab): TransferableTab; render(): void;
  install(transfer: ClaimedTabTransfer, placement: EditorGroupPlacement): Promise<void>;
  openFile(path: string, placement: EditorGroupPlacement): Promise<void>;
  dragging(active: boolean): void;
  copy?(id: string, target: EditorGroupPlacement): void;
  move?(id: string, target: EditorGroupPlacement): void;
};
type Target = EditorGroupPlacement;
const MIME = 'application/x-setdown-tab';
const FILE = 'application/x-setdown-project-file';

export function createTabDrag(options: Options) {
  let tabId: string | null = null, transferId: string | null = null;
  let canceled = false, leftWindow = false, sourceDrag = false;
  let dragging = false;
  let preparingPress = false;
  let sharedDragId: string | null = null;
  let localOnly = false;
  const copying = (event: DragEvent) => /Mac/.test(navigator.platform) ? event.altKey : event.ctrlKey;
  const setDragging = (active: boolean) => {
    if (dragging === active) return;
    dragging = active;
    options.dragging(active);
  };
  const overlay = document.createElement('div');
  overlay.className = 'group-drop-overlay'; overlay.hidden = true;
  const indicator = document.createElement('div');
  indicator.className = 'tab-drop-indicator'; indicator.hidden = true;
  options.shell.append(overlay, indicator);
  let activeStrip: HTMLElement | null = null;
  // The painted guide and the committed placement must describe the same move.
  let guidedTarget: Target | null = null;
  let detachTarget: { x: number; y: number } | null = null;
  let scrollFrame = 0;
  let scrollList: HTMLElement | null = null;
  let scrollPointer = 0;
  const clearTarget = () => {
    guidedTarget = null;
    detachTarget = null;
    overlay.hidden = indicator.hidden = true;
    activeStrip?.classList.remove('is-drop-target'); activeStrip = null;
    cancelAnimationFrame(scrollFrame); scrollFrame = 0; scrollList = null;
  };
  function stripTarget(strip: HTMLElement, x: number): Target {
    detachTarget = null;
    if (activeStrip !== strip) activeStrip?.classList.remove('is-drop-target');
    activeStrip = strip; strip.classList.add('is-drop-target');
    const list = strip.querySelector<HTMLElement>('.tab-list')!;
    const tabs = Array.from(list.querySelectorAll<HTMLElement>('[data-tab-id]'));
    const index = tabs.findIndex(tab => { const rect = tab.getBoundingClientRect(); return x < rect.left + rect.width / 2; });
    const at = index < 0 ? tabs.length : index;
    const bounds = list.getBoundingClientRect(), stripBounds = strip.getBoundingClientRect();
    const edge = tabs[at]?.getBoundingClientRect().left ?? tabs.at(-1)?.getBoundingClientRect().right ?? bounds.left;
    Object.assign(indicator.style, { left: `${Math.max(bounds.left, Math.min(edge, bounds.right)) - 1}px`,
      top: `${stripBounds.top + 5}px`, height: `${stripBounds.height - 7}px` });
    indicator.hidden = false; overlay.hidden = true;
    return guidedTarget = { groupId: strip.dataset.groupId!, direction: null, index: at };
  }
  function scrollStrip() {
    if (!scrollList || !activeStrip) { scrollFrame = 0; return; }
    const bounds = scrollList.getBoundingClientRect();
    const speed = scrollPointer < bounds.left + 24 ? -12 : scrollPointer > bounds.right - 24 ? 12 : 0;
    const previous = scrollList.scrollLeft;
    scrollList.scrollLeft += speed;
    if (scrollList.scrollLeft !== previous) stripTarget(activeStrip, scrollPointer);
    scrollFrame = requestAnimationFrame(scrollStrip);
  }
  const reset = () => {
    preparingPress = false;
    tabId = transferId = null; canceled = false; leftWindow = sourceDrag = false; view.draggedTabId = null;
    clearTarget(); options.shell.classList.remove('is-tab-dragging');
    setDragging(false);
  };
  const installIncoming = (id: string, destination: Target) => {
    void options.desktop.claimTabTransfer(id).then(async transfer => {
      if (transfer) await options.install(transfer, destination);
    }).catch(error => console.error('Could not move dropped tab', error));
  };
  const stopSharedDrag = options.desktop.onTabDragState(({ transferId: id, active, commitGuide }) => {
    if (active) {
      if (sharedDragId !== id && transferId !== id) clearTarget();
      sharedDragId = id;
      setDragging(true); options.shell.classList.add('is-tab-dragging');
    } else if (sharedDragId === id) {
      sharedDragId = null;
      const destination = commitGuide && !sourceDrag ? guidedTarget : null;
      reset();
      if (destination) installIncoming(id, destination);
    }
  });
  window.addEventListener('beforeunload', stopSharedDrag, { once: true });
  const supported = (event: DragEvent) => !!transferId || Array.from(event.dataTransfer?.types ?? []).some(type => type === MIME || type === FILE || type === PROJECT_FILES);
  const pointerOutside = (event: DragEvent) => {
    const clientOutside = event.clientX < 0 || event.clientY < 0
      || event.clientX >= innerWidth || event.clientY >= innerHeight;
    const screenPositionKnown = event.screenX !== 0 || event.screenY !== 0;
    return clientOutside || (screenPositionKnown
      && (event.screenX < window.screenX || event.screenY < window.screenY
        || event.screenX >= window.screenX + window.outerWidth
        || event.screenY >= window.screenY + window.outerHeight));
  };
  function target(event: DragEvent): Target | null {
    const area = document.querySelector('.editor-area')!;
    const point = { x: event.clientX, y: event.clientY };
    for (const element of area.querySelectorAll<HTMLElement>('.editor-group')) {
      const box = element.getBoundingClientRect();
      if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) continue;
      const groupId = element.dataset.groupId!;
      const strip = element.querySelector<HTMLElement>('.tab-strip')!;
      if (point.y < strip.getBoundingClientRect().bottom) return stripTarget(strip, point.x);
      clearTarget();
      const body = element.querySelector('.group-body')!.getBoundingClientRect();
      if (point.y < body.top || point.y >= body.bottom) return null;
      const direction = splitDirection(point.x - body.left, point.y - body.top, body.width, body.height);
      const source = tabId ? options.groups.owner(tabId) : null;
      const split = source?.id === groupId && source.tabs.length === 1 && !copying(event) ? null : direction;
      // Returning to the source group's body is not a useful merge. Reserve
      // its center for tear-off, including when a maximized window fills the
      // screen. Other groups still accept center drops with a blue merge guide.
      if (source?.id === groupId && !split) {
        detachTarget = { x: event.screenX, y: event.screenY };
        return null;
      }
      const left = body.left + (split === 'right' ? body.width / 2 : 0);
      const top = body.top + (split === 'down' ? body.height / 2 : 0);
      Object.assign(overlay.style, { left: `${left}px`, top: `${top}px`,
        width: `${body.width / (split === 'left' || split === 'right' ? 2 : 1)}px`,
        height: `${body.height / (split === 'up' || split === 'down' ? 2 : 1)}px` });
      overlay.hidden = false;
      return guidedTarget = { groupId, direction: split };
    }
    clearTarget();
    return null;
  }
  function move(id: string, destination: Target, copy = false) {
    if (copy && options.copy) { options.copy(id, destination); return; }
    if (options.move) { options.move(id, destination); return; }
    const tab = options.tabs.find(tab => tab.id === id);
    if (tab) options.serialize(tab); // Capture the visible source group before reparenting its editor.
    options.groups.move(id, destination.groupId, destination.direction, destination.index);
    options.render(); options.activate(id);
  }
  // Capturing native children takes a paint round trip. Start on the tab press,
  // before Chromium enters its OS drag loop: hiding a native child while that
  // loop crosses it can cancel an otherwise accepted cross-window drop.
  options.shell.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !(event.target instanceof Element)
      || !event.target.closest('.document-tab') || event.target.closest('.tab-close, .tab-audio')) return;
    preparingPress = true; setDragging(true);
  }, true);
  const releasePress = () => {
    if (!preparingPress) return;
    preparingPress = false;
    if (!sourceDrag && !sharedDragId) setDragging(false);
  };
  window.addEventListener('pointerup', releasePress, true);
  window.addEventListener('pointercancel', releasePress, true);
  window.addEventListener('blur', releasePress);
  window.addEventListener('dragstart', event => {
    if (supported(event)) { sourceDrag = true; setDragging(true); options.shell.classList.add('is-tab-dragging'); }
  });
  const acceptTarget = (event: DragEvent) => {
    if (!supported(event)) return;
    leftWindow = false;
    const destination = target(event);
    if (sharedDragId && !sourceDrag) options.desktop.updateTabDragTarget(sharedDragId, !!destination);
    const internalTab = !!transferId || Array.from(event.dataTransfer?.types ?? []).includes(MIME);
    if (!destination && !detachTarget && !internalTab) return;
    // Keep the native tab transport alive while crossing non-drop chrome.
    // X11 can retain a rejected dragover result even after the next valid
    // dragenter, reporting "none" on a quick release. Placement still comes
    // only from the guide; dropping on chrome cancels without moving a tab.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = copying(event) && options.copy ? 'copy' : 'move';
    if (!destination && !detachTarget) return;
    // A native Markdown view otherwise intercepts the next dragover/drop.
    setDragging(true);
    options.shell.classList.add('is-tab-dragging');
    if (activeStrip) {
      scrollList = activeStrip.querySelector<HTMLElement>('.tab-list'); scrollPointer = event.clientX;
      if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollStrip);
    }
  };
  // A fast release after crossing a tab/group boundary can follow dragenter
  // without another dragover. Publish the new guide on entry as well, so the
  // previously hovered source strip cannot retain ownership of that release.
  window.addEventListener('dragenter', acceptTarget, true);
  window.addEventListener('dragover', acceptTarget, true);
  window.addEventListener('drop', event => {
    if (!supported(event)) return;
    const destination = guidedTarget ?? (detachTarget ? null : target(event));
    if (!destination) {
      const detach = !localOnly && !canceled && detachTarget ? transferId : null;
      const point = detachTarget;
      if (detach) { event.preventDefault(); event.stopPropagation(); }
      const pending = transferId;
      reset();
      if (detach && point) options.desktop.detachTabToWindow(detach, point.x, point.y, true);
      else if (pending) options.desktop.cancelTabTransfer(pending);
      return;
    }
    event.preventDefault(); event.stopPropagation();
    const localId = tabId;
    const incoming = event.dataTransfer?.getData(MIME);
    const paths = draggedPaths(event.dataTransfer, PROJECT_FILES, FILE);
    reset();
    if (localId) {
      if (incoming) options.desktop.cancelTabTransfer(incoming);
      move(localId, destination, copying(event));
    } else if (incoming) {
      installIncoming(incoming, destination);
    } else if (paths.length) {
      void (async () => {
        let placement = destination;
        for (const path of paths) {
          await options.openFile(path, placement);
          // Only the first file creates a split. Subsequent files follow it in
          // selection order and remain pinned in that same destination group.
          const group = options.groups.focused;
          const index = group.activeId ? group.tabs.indexOf(group.activeId) + 1 : group.tabs.length;
          placement = { groupId: group.id, direction: null, index };
        }
      })().catch(error => console.error('Could not open dropped files', error));
    }
  }, true);
  window.addEventListener('dragleave', event => {
    if (!event.relatedTarget) {
      // Crossing a native child surface can emit a null-relatedTarget leave
      // inside this window. Keep its guide/placement until another dragover,
      // a real boundary crossing, cancellation, or completion replaces it.
      if ((guidedTarget || detachTarget) && !pointerOutside(event)) return;
      if (sharedDragId && !sourceDrag) options.desktop.updateTabDragTarget(sharedDragId, false);
      leftWindow = true; clearTarget();
      // Native child surfaces can emit this while the pointer is still inside
      // the window. A source drag owns its capture until drop/end/cancel;
      // restoring native views here makes them consume the split drop.
      if (!sourceDrag && !sharedDragId) { setDragging(false); options.shell.classList.remove('is-tab-dragging'); }
    }
  });
  window.addEventListener('dragend', () => { sourceDrag = false; clearTarget(); setDragging(false); options.shell.classList.remove('is-tab-dragging'); });
  return {
    start(id: string, event: DragEvent) {
      const tab = options.tabs.find(tab => tab.id === id);
      if (!tab) return;
      const image = imageSessions.get(id);
      if (image && (image.history.dirty || image.busy)) {
        releasePress();
        event.preventDefault(); window.alert('Save your image changes before moving this tab to another group or window.'); return;
      }
      if (options.groups.pin(id)) options.render();
      // Do not change selection until the drop succeeds.
      localOnly = tab.kind === 'diff';
      tabId = id; transferId = crypto.randomUUID(); canceled = false; leftWindow = false; sourceDrag = true;
      view.draggedTabId = id;
      options.shell.classList.add('is-tab-dragging'); setDragging(true);
      event.dataTransfer?.setData(MIME, transferId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = options.copy ? 'copyMove' : 'move';
      if (!localOnly) options.desktop.registerTabTransfer(transferId, options.serialize(tab));
    },
    end(event: DragEvent) {
      const id = transferId;
      const localId = tabId, destination = guidedTarget;
      // A native boundary leave can report (0, 0), retaining the last guide
      // even after a real window exit. The release point supersedes that guide.
      const outside = leftWindow || pointerOutside(event);
      if (id && localId && destination && !outside) {
        // A native surface can consume drop. The still-visible guide is the
        // accepted local destination, not an invitation to detach a new window.
        // Chromium cancels an OS drag with Escape before dispatching keydown;
        // its dropEffect is then "none", even though our guide is still visible.
        const commit = !canceled && ['move', 'copy'].includes(event.dataTransfer?.dropEffect ?? 'none');
        reset();
        options.desktop.cancelTabTransfer(id);
        if (commit) move(localId, destination, copying(event));
        return;
      }
      // Main arbitrates a remote accepted guide, an actual DOM drop, and an
      // outside detach. Renderer IPC ordering must not decide the destination.
      const detach = id && !localOnly && !canceled && (outside || (detachTarget && event.dataTransfer?.dropEffect === 'move'));
      const point = !outside && detachTarget;
      reset();
      if (detach) options.desktop.detachTabToWindow(id, point ? point.x : event.screenX, point ? point.y : event.screenY, !!point, event.dataTransfer?.dropEffect);
      else if (id) options.desktop.cancelTabTransfer(id);
    },
    cancel() { canceled = true; clearTarget(); setDragging(false); options.shell.classList.remove('is-tab-dragging'); }, reset,
  };
}
