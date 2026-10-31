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
  let retainedTarget: Target | null = null;
  let detachTarget: { x: number; y: number } | null = null;
  let scrollFrame = 0;
  let scrollList: HTMLElement | null = null;
  let scrollPointer = 0;
  const clearStrip = () => {
    indicator.hidden = true;
    activeStrip?.classList.remove('is-drop-target'); activeStrip = null;
    cancelAnimationFrame(scrollFrame); scrollFrame = 0; scrollList = null;
  };
  const clearTarget = () => {
    options.desktop.setNativeTabDragGuide(null);
    guidedTarget = retainedTarget = null;
    detachTarget = null;
    overlay.hidden = true;
    clearStrip();
  };
  function leaveTarget(terminal: boolean) {
    const retained = terminal ? guidedTarget ?? retainedTarget : null;
    leftWindow = true; clearTarget(); retainedTarget = retained;
    const id = sharedDragId ?? transferId;
    if (id) options.desktop.updateTabDragTarget(id, false, false, terminal && !!retained);
  }
  function leave(event: { clientX: number; clientY: number; screenX: number; screenY: number }) {
    const terminal = event.clientX === 0 && event.clientY === 0 && event.screenX === 0 && event.screenY === 0;
    // A native child boundary can report a null relatedTarget while still
    // inside this window. Keep the painted placement until an actual receiver
    // replaces it, or completion proves an outside release.
    if (!terminal && event.clientX >= 0 && event.clientY >= 0
      && event.clientX < innerWidth && event.clientY < innerHeight) return;
    leaveTarget(terminal);
  }
  function stripTarget(strip: HTMLElement, x: number): Target {
    detachTarget = null; retainedTarget = null;
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
    options.desktop.setNativeTabDragGuide(null);
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
    if (transferId) options.desktop.setNativeTabDrag(null);
    tabId = transferId = null; canceled = false; leftWindow = sourceDrag = false; view.draggedTabId = null;
    clearTarget(); options.shell.classList.remove('is-tab-dragging');
    setDragging(false);
  };
  const installIncoming = (id: string, destination: Target) => {
    void options.desktop.claimTabTransfer(id).then(async transfer => {
      if (transfer) await options.install(transfer, destination);
    }).catch(error => console.error('Could not move dropped tab', error));
  };
  const stopSharedDrag = options.desktop.onTabDragState(({ transferId: id, active, commitGuide, copy, commitPoint }) => {
    if (active) {
      if (sharedDragId !== id && transferId !== id) clearTarget();
      sharedDragId = id;
      setDragging(true); options.shell.classList.add('is-tab-dragging');
    } else if (sharedDragId === id) {
      sharedDragId = null;
      // A new local gesture may start before the previous drag cancellation
      // completes in main. Its late end must not clear the new token/receiver.
      if (transferId && transferId !== id) return;
      const destination = commitGuide ? commitPoint ? target(new DragEvent('drop', {
        clientX: commitPoint.x, clientY: commitPoint.y,
        ctrlKey: copy === true, altKey: copy === true,
      })) : guidedTarget ?? retainedTarget : null;
      const local = sourceDrag ? tabId : null;
      reset();
      if (destination && local) { options.desktop.cancelTabTransfer(id); move(local, destination, copy === true); }
      else if (destination) installIncoming(id, destination);
    }
  });
  window.addEventListener('beforeunload', stopSharedDrag, { once: true });
  const stopNativeDrag = options.desktop.onNativeTabDrag(input => {
    if (input.transferId !== transferId && input.transferId !== sharedDragId) return;
    if (input.type === 'dragleave') {
      leave(input);
      return;
    }
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(MIME, input.transferId);
    dataTransfer.dropEffect = input.ctrlKey || input.altKey ? 'copy' : 'move';
    const event = new DragEvent(input.type, { ...input, dataTransfer, cancelable: true });
    if (input.type === 'dragend') controller.end(event);
    else window.dispatchEvent(event);
  });
  window.addEventListener('beforeunload', stopNativeDrag, { once: true });
  const supported = (event: DragEvent) => !!transferId || Array.from(event.dataTransfer?.types ?? []).some(type => type === MIME || type === FILE || type === PROJECT_FILES);
  function target(event: DragEvent): Target | null {
    const area = document.querySelector('.editor-area')!;
    const point = { x: event.clientX, y: event.clientY };
    for (const element of area.querySelectorAll<HTMLElement>('.editor-group')) {
      const box = element.getBoundingClientRect();
      if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) continue;
      const groupId = element.dataset.groupId!;
      const strip = element.querySelector<HTMLElement>('.tab-strip')!;
      if (point.y < strip.getBoundingClientRect().bottom) return stripTarget(strip, point.x);
      const body = element.querySelector('.group-body')!.getBoundingClientRect();
      if (point.y < body.top || point.y >= body.bottom) { clearTarget(); return null; }
      const direction = splitDirection(point.x - body.left, point.y - body.top, body.width, body.height);
      const source = tabId ? options.groups.owner(tabId) : null;
      const split = source?.id === groupId && source.tabs.length === 1 && !copying(event) ? null : direction;
      // A sole tab cannot split its own group. Keep its existing tear-off in
      // normal windows; main cancels it when maximized/fullscreen. Every other
      // body point splits by the grid; merging/reordering belongs to the strip.
      if (source?.id === groupId && !split) {
        clearTarget();
        detachTarget = { x: event.screenX, y: event.screenY };
        return null;
      }
      // Replace an accepted guide directly. Sending null first makes the native
      // receiver paint an empty frame between the two asynchronous IPC updates.
      clearStrip(); detachTarget = null; retainedTarget = null;
      const left = body.left + (split === 'right' ? body.width / 2 : 0);
      const top = body.top + (split === 'down' ? body.height / 2 : 0);
      Object.assign(overlay.style, { left: `${left}px`, top: `${top}px`,
        width: `${body.width / (split === 'left' || split === 'right' ? 2 : 1)}px`,
        height: `${body.height / (split === 'up' || split === 'down' ? 2 : 1)}px` });
      overlay.hidden = false;
      options.desktop.setNativeTabDragGuide({ bounds: { x: left, y: top, width: parseFloat(overlay.style.width), height: parseFloat(overlay.style.height) }, color: '' });
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
  window.addEventListener('dragstart', event => {
    if (supported(event)) { sourceDrag = true; setDragging(true); options.shell.classList.add('is-tab-dragging'); }
  });
  const acceptTarget = (event: DragEvent) => {
    if (!supported(event)) return;
    leftWindow = false;
    const destination = target(event);
    if (sharedDragId ?? transferId) options.desktop.updateTabDragTarget((sharedDragId ?? transferId)!, !!destination, true);
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
    // A fast native release can arrive before its final dragover. Real drop
    // coordinates supersede a previous center hover; coordinate-less Chromium
    // completions still use the placement that was actually painted.
    const destination = event.clientX !== 0 || event.clientY !== 0
      ? target(event) : guidedTarget ?? (detachTarget ? null : target(event));
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
      // A native surface entry has its own dragenter/dragover. Clear the old
      // receiver now; screen coordinates cannot disambiguate this on Wayland.
      leave(event);
      // Native child surfaces can emit this while the pointer is still inside
      // the window. A source drag owns its capture until drop/end/cancel;
      // restoring native views here makes them consume the split drop.
      if (!sourceDrag && !sharedDragId) { setDragging(false); options.shell.classList.remove('is-tab-dragging'); }
    }
  });

  const controller = {
    start(id: string, event: DragEvent) {
      const tab = options.tabs.find(tab => tab.id === id);
      if (!tab) return;
      const image = imageSessions.get(id);
      if (image && (image.history.dirty || image.busy)) {
        event.preventDefault(); window.alert('Save your image changes before moving this tab to another group or window.'); return;
      }
      if (options.groups.pin(id)) options.render();
      // Do not change selection until the drop succeeds.
      localOnly = tab.kind === 'diff';
      tabId = id; transferId = crypto.randomUUID(); canceled = false; leftWindow = false; sourceDrag = true;
      view.draggedTabId = id;
      options.shell.classList.add('is-tab-dragging'); setDragging(true);
      event.dataTransfer?.setData(MIME, transferId);
      options.desktop.setNativeTabDrag(transferId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = options.copy ? 'copyMove' : 'move';
      if (!localOnly) options.desktop.registerTabTransfer(transferId, options.serialize(tab));
    },
    end(event: DragEvent) {
      const id = transferId;
      if (!id) return;
      if (localOnly) {
        const local = tabId, destination = guidedTarget ?? retainedTarget;
        const accepted = !canceled && ['move', 'copy'].includes(event.dataTransfer?.dropEffect ?? 'none');
        reset();
        if (local && destination && accepted) move(local, destination, copying(event));
        return;
      }
      // Keep the painted guide until main arbitrates the actual OS receiver.
      // Global window coordinates cannot identify a destination on Wayland.
      // A forwarded native drop may arrive after source dragend; commit once.
      if (canceled) { reset(); options.desktop.cancelTabTransfer(id); return; }
      const insideSource = !!detachTarget && !leftWindow;
      const position = insideSource ? detachTarget! : { x: event.screenX, y: event.screenY };
      options.desktop.detachTabToWindow(id, position.x, position.y,
        insideSource, event.dataTransfer?.dropEffect, { x: event.clientX, y: event.clientY });
    },
    cancel() { canceled = true; clearTarget(); setDragging(false); options.shell.classList.remove('is-tab-dragging'); }, reset,
  };
  return controller;
}
