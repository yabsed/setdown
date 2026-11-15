import { clipboard, type MenuItemConstructorOptions } from 'electron';
import { showContextMenu } from './menu-overlay';
import type { WindowState } from '../windows/window-state';
import { tabMenu, type TabMenuCommand, type TabMenuContext, type TabMenuItem } from '../../core/workspace/tab-menu';

/**
 * Resolves with the chosen command. The renderer owns its tabs and carries it out,
 * except copying: its document does not hold focus while the menu layer is open.
 */
export function showTabMenu(state: WindowState, context: TabMenuContext, copy: { path: string; relative: string },
  point?: { x: number; y: number }): Promise<TabMenuCommand | null> {
  return new Promise(resolve => {
    const choose = (command: TabMenuCommand) => {
      if (command === 'copy-path') clipboard.writeText(copy.path);
      else if (command === 'copy-relative-path') clipboard.writeText(copy.relative);
      resolve(command);
    };
    const template = (items: TabMenuItem[]): MenuItemConstructorOptions[] => items.map(item => item.type === 'separator' ? { type: 'separator' }
      : item.type === 'submenu' ? { label: item.label, submenu: template(item.items) }
        // The accelerator is a hint for the application menu's own shortcut.
        : { label: item.label, enabled: item.enabled, accelerator: item.accelerator, registerAccelerator: false, click: () => choose(item.command) });
    void showContextMenu(state, template(tabMenu(context)), { point, closed: () => resolve(null) });
  });
}
