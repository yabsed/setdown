import type { ClaimedTabTransfer, TransferableTab } from '../../protocol/desktop-api';
import { view } from '../view-state.svelte';
import type { WorkspaceTab } from '../../core/workspace/workspace-state';
import type { DesktopPort } from '../ports/desktop-port';

type Options = {
  desktop: DesktopPort;
  shell: HTMLElement;
  strip: HTMLElement;
  tabs: WorkspaceTab[];
  activeId: () => string | null;
  activate: (id: string) => void;
  serialize: (tab: WorkspaceTab) => TransferableTab;
  render: () => void;
  install: (transfer: ClaimedTabTransfer) => void;
};

export function createTabDrag(options: Options) {
  let tabId: string | null = null;
  let transferId: string | null = null;
  let canceled = false;

  const reset = () => {
    tabId = null;
    transferId = null;
    canceled = false;
    view.draggedTabId = null;
    options.strip.classList.remove('is-drop-target');
    options.shell.classList.remove('is-tab-dragging', 'is-window-drop-target');
  };
  const transferFrom = (event: DragEvent) =>
    event.dataTransfer?.getData('application/x-setdown-tab') || null;
  const isTabDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('application/x-setdown-tab') || !!transferId;
  const isStrip = (event: DragEvent) =>
    event.target instanceof Element && event.target.closest('.tab-strip') !== null;
  const claim = (id: string) => void options.desktop.claimTabTransfer(id).then((transfer) => {
    if (transfer) options.install(transfer);
  });

  function reorder(event: DragEvent, id: string) {
    const from = options.tabs.findIndex((tab) => tab.id === id);
    if (from < 0) return;
    const element = (event.target as Element | null)?.closest<HTMLElement>('.document-tab');
    let to = options.tabs.length - 1;
    if (element?.dataset.tabId) {
      const hovered = options.tabs.findIndex((tab) => tab.id === element.dataset.tabId);
      if (hovered >= 0) {
        const rect = element.getBoundingClientRect();
        to = hovered + (event.clientX > rect.left + rect.width / 2 ? 1 : 0);
      }
    }
    const [moved] = options.tabs.splice(from, 1);
    if (from < to) to -= 1;
    options.tabs.splice(Math.max(0, Math.min(to, options.tabs.length)), 0, moved);
    options.render();
  }

  options.strip.addEventListener('dragover', (event) => {
    if (!isTabDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    options.strip.classList.add('is-drop-target');
  });
  options.strip.addEventListener('dragleave', (event) => {
    if (!options.strip.contains(event.relatedTarget as Node | null)) {
      options.strip.classList.remove('is-drop-target');
    }
  });
  options.strip.addEventListener('drop', (event) => {
    const incoming = transferFrom(event);
    if (!incoming) return;
    event.preventDefault();
    event.stopPropagation();
    options.strip.classList.remove('is-drop-target');
    if (!tabId) {
      claim(incoming);
      return;
    }
    reorder(event, tabId);
    options.desktop.cancelTabTransfer(incoming);
    reset();
  });

  window.addEventListener('dragover', (event) => {
    if (isStrip(event) || !isTabDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    options.shell.classList.add('is-window-drop-target');
  }, { capture: true });
  window.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) options.shell.classList.remove('is-window-drop-target');
  });
  window.addEventListener('drop', (event) => {
    if (isStrip(event)) return;
    const incoming = transferFrom(event);
    if (!incoming) return;
    event.preventDefault();
    event.stopPropagation();
    options.shell.classList.remove('is-window-drop-target');
    if (!tabId) {
      claim(incoming);
      return;
    }
    reset();
    options.desktop.detachTabToWindow(incoming, event.screenX, event.screenY);
  }, { capture: true });

  return {
    start(id: string, event: DragEvent) {
      const tab = options.tabs.find((candidate) => candidate.id === id);
      if (!tab) return;
      if (id !== options.activeId()) options.activate(id);
      tabId = id;
      transferId = crypto.randomUUID();
      canceled = false;
      view.draggedTabId = id;
      options.shell.classList.add('is-tab-dragging');
      event.dataTransfer?.setData('application/x-setdown-tab', transferId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      options.desktop.registerTabTransfer(transferId, options.serialize(tab));
    },
    end(event: DragEvent) {
      const id = transferId;
      const shouldDetach = id && !canceled && event.dataTransfer?.dropEffect !== 'move';
      reset();
      if (shouldDetach) options.desktop.detachTabToWindow(id, event.screenX, event.screenY);
      else if (id && canceled) options.desktop.cancelTabTransfer(id);
    },
    cancel() {
      if (tabId) canceled = true;
    },
    reset,
  };
}
