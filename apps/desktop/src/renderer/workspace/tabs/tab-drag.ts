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
};
type Target = EditorGroupPlacement;
const MIME = 'application/x-setdown-tab';
const FILE = 'application/x-setdown-project-file';

export function createTabDrag(options: Options) {
  let tabId: string | null = null, transferId: string | null = null;
  let canceled = false, leftWindow = false, sourceDrag = false;
  let dragging = false;
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
  let scrollFrame = 0;
  let scrollList: HTMLElement | null = null;
  let scrollPointer = 0;
  const clearTarget = () => {
    overlay.hidden = indicator.hidden = true;
    activeStrip?.classList.remove('is-drop-target'); activeStrip = null;
    cancelAnimationFrame(scrollFrame); scrollFrame = 0; scrollList = null;
  };
  function stripTarget(strip: HTMLElement, x: number): Target {
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
    return { groupId: strip.dataset.groupId!, direction: null, index: at };
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
    tabId = transferId = null; canceled = false; leftWindow = sourceDrag = false; view.draggedTabId = null;
    clearTarget(); options.shell.classList.remove('is-tab-dragging');
    setDragging(false);
  };
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
      clearTarget();
      const body = element.querySelector('.group-body')!.getBoundingClientRect();
      const direction = splitDirection(point.x - body.left, point.y - body.top, body.width, body.height);
      const source = tabId ? options.groups.owner(tabId) : null;
      const split = source?.id === groupId && source.tabs.length === 1 ? null : direction;
      const left = body.left + (split === 'right' ? body.width / 2 : 0);
      const top = body.top + (split === 'down' ? body.height / 2 : 0);
      Object.assign(overlay.style, { left: `${left}px`, top: `${top}px`,
        width: `${body.width / (split === 'left' || split === 'right' ? 2 : 1)}px`,
        height: `${body.height / (split === 'up' || split === 'down' ? 2 : 1)}px` });
      overlay.hidden = false;
      return { groupId, direction: split };
    }
    clearTarget();
    return null;
  }
  function move(id: string, destination: Target) {
    const tab = options.tabs.find(tab => tab.id === id);
    if (tab) options.serialize(tab); // Capture the visible source group before reparenting its editor.
    options.groups.move(id, destination.groupId, destination.direction, destination.index);
    options.render(); options.activate(id);
  }
  window.addEventListener('dragstart', event => {
    if (supported(event)) { sourceDrag = true; setDragging(true); options.shell.classList.add('is-tab-dragging'); }
  });
  window.addEventListener('dragover', event => {
    if (!supported(event)) return;
    leftWindow = false;
    const destination = target(event);
    if (!destination) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    // A native Markdown view otherwise intercepts the next dragover/drop.
    setDragging(true);
    options.shell.classList.add('is-tab-dragging');
    if (activeStrip) {
      scrollList = activeStrip.querySelector<HTMLElement>('.tab-list'); scrollPointer = event.clientX;
      if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollStrip);
    }
  }, true);
  window.addEventListener('drop', event => {
    if (!supported(event)) return;
    const destination = target(event);
    if (!destination) { reset(); return; }
    event.preventDefault(); event.stopPropagation();
    const localId = tabId;
    const incoming = event.dataTransfer?.getData(MIME);
    const paths = draggedPaths(event.dataTransfer, PROJECT_FILES, FILE);
    reset();
    if (localId) {
      if (incoming) options.desktop.cancelTabTransfer(incoming);
      move(localId, destination);
    } else if (incoming) {
      void options.desktop.claimTabTransfer(incoming).then(async transfer => {
        if (!transfer) return;
        await options.install(transfer, destination);
      });
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
      leftWindow = true; clearTarget();
      // Native child surfaces can emit this while the pointer is still inside
      // the window. A source drag owns its capture until drop/end/cancel;
      // restoring native views here makes them consume the split drop.
      if (!sourceDrag) { setDragging(false); options.shell.classList.remove('is-tab-dragging'); }
    }
  });
  window.addEventListener('dragend', () => { sourceDrag = false; clearTarget(); setDragging(false); options.shell.classList.remove('is-tab-dragging'); });
  return {
    start(id: string, event: DragEvent) {
      const tab = options.tabs.find(tab => tab.id === id);
      if (!tab) return;
      const image = imageSessions.get(id);
      if (image && (image.history.dirty || image.busy)) {
        event.preventDefault(); window.alert('Save your image changes before moving this tab to another group or window.'); return;
      }
      if (options.groups.pin(id)) options.render();
      // Do not change selection until the drop succeeds.
      tabId = id; transferId = crypto.randomUUID(); canceled = false; leftWindow = false; sourceDrag = true;
      view.draggedTabId = id;
      options.shell.classList.add('is-tab-dragging'); setDragging(true);
      event.dataTransfer?.setData(MIME, transferId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      options.desktop.registerTabTransfer(transferId, options.serialize(tab));
    },
    end(event: DragEvent) {
      const id = transferId;
      const clientOutside = event.clientX < 0 || event.clientY < 0
        || event.clientX >= innerWidth || event.clientY >= innerHeight;
      const screenPositionKnown = event.screenX !== 0 || event.screenY !== 0;
      const screenOutside = screenPositionKnown
        && (event.screenX < window.screenX || event.screenY < window.screenY
          || event.screenX >= window.screenX + window.outerWidth
          || event.screenY >= window.screenY + window.outerHeight);
      // Chromium may report (0, 0) or the last in-window client coordinate for a
      // real OS dragend. The top-level dragleave is the reliable signal that the
      // pointer crossed the window boundary.
      const outside = leftWindow || clientOutside || screenOutside;
      // An external application may accept the OS drag with dropEffect "move".
      // A Setdown drop consumes and resets this transfer before dragend, so an
      // unconsumed transfer outside this window is always a detach.
      const detach = id && !canceled && outside;
      reset();
      if (detach) options.desktop.detachTabToWindow(id, event.screenX, event.screenY);
      else if (id) options.desktop.cancelTabTransfer(id);
    },
    cancel() { canceled = true; clearTarget(); setDragging(false); options.shell.classList.remove('is-tab-dragging'); }, reset,
  };
}
