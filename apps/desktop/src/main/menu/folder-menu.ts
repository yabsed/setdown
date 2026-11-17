import { clipboard, type MenuItemConstructorOptions } from 'electron';
import { showContextMenu } from './menu-overlay';
import type { WindowState } from '../windows/window-state';
import { folderMenu, type FolderMenuCommand, type FolderMenuContext } from '../../core/files/folder-menu';

/**
 * A folder tab's menu, in the native menu layer: a website playing in another group stays visible
 * and running behind it. Resolves with the chosen command, which the folder tab carries out,
 * except copying a path: its document does not hold focus while the menu layer is open.
 */
export function showFolderMenu(state: WindowState, context: FolderMenuContext, copy: { paths: string; folder: string },
  point?: { x: number; y: number }): Promise<FolderMenuCommand | null> {
  return new Promise(resolve => {
    const choose = (command: FolderMenuCommand) => {
      if (command === 'copy-path') clipboard.writeText(copy.paths);
      else if (command === 'copy-folder-path') clipboard.writeText(copy.folder);
      resolve(command);
    };
    const template: MenuItemConstructorOptions[] = folderMenu(context).map(item => item.type === 'separator' ? { type: 'separator' }
      // The accelerator is a hint for the folder tab's own shortcut.
      : { label: item.label, enabled: item.enabled, accelerator: item.accelerator, registerAccelerator: false, click: () => choose(item.command),
        ...(item.role ? { type: item.role, checked: item.checked === true } : {}) });
    // The folder tab asked; it gets the keyboard back whichever view held it meanwhile.
    void showContextMenu(state, template, { point, source: state.window.webContents, closed: () => resolve(null) });
  });
}
