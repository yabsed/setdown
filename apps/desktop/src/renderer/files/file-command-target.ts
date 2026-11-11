import type { ExplorerApi } from '../../protocol/explorer';

/**
 * Which file view owns Edit-menu and Ctrl+C/X/V/A/Z commands: the sidebar
 * Explorer or one folder tab. Main reroutes those keys while a target is set
 * (window-manager.ts `explorerEditTarget`); both views listen to the same
 * `setdown:explorer-command` event and act only when they are the owner.
 */
export const fileCommandTarget = { owner: '' };
const MENUS = '.application-menu, .application-menu-popup, .application-submenu-popup, .project-context-menu, .folder-context-menu';
const EDITABLE = 'input, textarea, select, [contenteditable="true"]';

export function ownerFor(target: Element, explorerVisible: boolean): string {
  if (target.closest(EDITABLE)) return '';
  if (explorerVisible && target.closest('.explorer-row:not(.explorer-edit), .explorer-root, .explorer-tree')) return 'explorer';
  const folder = target.closest<HTMLElement>('[data-folder-list]');
  return folder?.dataset.folderList ? `folder:${folder.dataset.folderList}` : '';
}

export function installFileCommandTarget(explorer: Pick<ExplorerApi, 'setEditTarget'>, explorerVisible: () => boolean): () => void {
  const update = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(MENUS)) return;
    const owner = ownerFor(target, explorerVisible());
    fileCommandTarget.owner = owner;
    explorer.setEditTarget(!!owner);
  };
  const blur = () => { fileCommandTarget.owner = ''; explorer.setEditTarget(false); };
  document.addEventListener('focusin', update);
  document.addEventListener('pointerdown', update, true);
  window.addEventListener('blur', blur);
  return () => {
    document.removeEventListener('focusin', update);
    document.removeEventListener('pointerdown', update, true);
    window.removeEventListener('blur', blur);
  };
}
