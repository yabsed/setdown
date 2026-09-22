import type { ClaimedTabTransfer, TransferableTab } from '../../protocol/desktop-api';
import { splitDirection, type EditorGroupPlacement, type EditorGroups } from '../../core/workspace/editor-groups';
import { view } from '../view-state.svelte';
import type { WorkspaceTab } from '../../core/workspace/workspace-state';
import type { DesktopPort } from '../ports/desktop-port';

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
  let canceled = false, leftWindow = false;
  const overlay = document.createElement('div');
  overlay.className = 'group-drop-overlay'; overlay.hidden = true;
  options.shell.append(overlay);
  const reset = () => {
    tabId = transferId = null; canceled = false; leftWindow = false; view.draggedTabId = null;
    overlay.hidden = true; options.shell.classList.remove('is-tab-dragging');
    options.dragging(false);
  };
  const supported = (event: DragEvent) => !!transferId || Array.from(event.dataTransfer?.types ?? []).some(type => type === MIME || type === FILE);
  function target(event: DragEvent): Target | null {
    const area = document.querySelector('.editor-area')!;
    const point = { x: event.clientX, y: event.clientY };
    for (const element of area.querySelectorAll<HTMLElement>('.editor-group')) {
      const box = element.getBoundingClientRect();
      if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) continue;
      const groupId = element.dataset.groupId!;
      const strip = element.querySelector<HTMLElement>('.tab-strip')!;
      if (point.y < strip.getBoundingClientRect().bottom) {
        const tabs = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]'));
        const index = tabs.findIndex(tab => { const rect = tab.getBoundingClientRect(); return point.x < rect.left + rect.width / 2; });
        overlay.hidden = true;
        return { groupId, direction: null, index: index < 0 ? tabs.length : index };
      }
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
    overlay.hidden = true;
    return null;
  }
  function move(id: string, destination: Target) {
    const tab = options.tabs.find(tab => tab.id === id);
    if (tab) options.serialize(tab); // Capture the visible source group before reparenting its editor.
    options.groups.move(id, destination.groupId, destination.direction, destination.index);
    options.render(); options.activate(id);
  }
  window.addEventListener('dragstart', event => {
    if (supported(event)) { options.dragging(true); options.shell.classList.add('is-tab-dragging'); }
  });
  window.addEventListener('dragover', event => {
    if (!supported(event)) return;
    leftWindow = false;
    const destination = target(event);
    if (!destination) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    // A native Markdown view otherwise intercepts the next dragover/drop.
    options.dragging(true);
    options.shell.classList.add('is-tab-dragging');
    const list = (event.target as Element)?.closest<HTMLElement>('.tab-list');
    if (list) {
      const rect = list.getBoundingClientRect();
      if (event.clientX < rect.left + 24) list.scrollLeft -= 24;
      else if (event.clientX > rect.right - 24) list.scrollLeft += 24;
    }
  }, true);
  window.addEventListener('drop', event => {
    if (!supported(event)) return;
    const destination = target(event);
    if (!destination) { reset(); return; }
    event.preventDefault(); event.stopPropagation();
    const localId = tabId;
    const incoming = event.dataTransfer?.getData(MIME);
    const path = event.dataTransfer?.getData(FILE);
    reset();
    if (localId) {
      if (incoming) options.desktop.cancelTabTransfer(incoming);
      move(localId, destination);
    } else if (incoming) {
      void options.desktop.claimTabTransfer(incoming).then(async transfer => {
        if (!transfer) return;
        await options.install(transfer, destination);
      });
    } else if (path) {
      void options.openFile(path, destination).catch(error => console.error('Could not open dropped file', error));
    }
  }, true);
  window.addEventListener('dragleave', event => {
    if (!event.relatedTarget) { leftWindow = true; overlay.hidden = true; }
  });
  window.addEventListener('dragend', () => { overlay.hidden = true; options.dragging(false); options.shell.classList.remove('is-tab-dragging'); });
  return {
    start(id: string, event: DragEvent) {
      const tab = options.tabs.find(tab => tab.id === id);
      if (!tab) return;
      // Do not change selection until the drop succeeds.
      tabId = id; transferId = crypto.randomUUID(); canceled = false; leftWindow = false;
      view.draggedTabId = id;
      options.shell.classList.add('is-tab-dragging'); options.dragging(true);
      event.dataTransfer?.setData(MIME, transferId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      options.desktop.registerTabTransfer(transferId, options.serialize(tab));
    },
    end(event: DragEvent) {
      const id = transferId;
      const clientOutside = event.clientX < 0 || event.clientY < 0
        || event.clientX >= innerWidth || event.clientY >= innerHeight;
      const screenOutside = event.screenX < window.screenX || event.screenY < window.screenY
        || event.screenX >= window.screenX + window.outerWidth || event.screenY >= window.screenY + window.outerHeight;
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
    cancel() { canceled = true; overlay.hidden = true; }, reset,
  };
}
