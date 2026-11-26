import { clipboard, type MenuItemConstructorOptions } from 'electron';
import { showContextMenu } from './menu-overlay';
import type { WindowState } from '../windows/window-state';
import type { LocationLinkCommand } from '../../protocol/desktop-api';

/**
 * The menu of a folder name in the address bar, in the native menu layer. Resolves with the chosen
 * command, which the shell carries out, except copying: its document does not hold focus while the
 * menu layer is open.
 */
export function showLocationLinkMenu(state: WindowState, path: string, point?: { x: number; y: number }): Promise<LocationLinkCommand | null> {
  return new Promise(resolve => {
    const item = (command: LocationLinkCommand, label: string): MenuItemConstructorOptions => ({ label, click: () => {
      if (command === 'copy-path') clipboard.writeText(path);
      resolve(command);
    } });
    void showContextMenu(state, [item('open-tab', 'Open in New Tab'), item('open-side', 'Open to the Side'), { type: 'separator' },
      item('copy-path', 'Copy Path')], { point, closed: () => resolve(null) });
  });
}
