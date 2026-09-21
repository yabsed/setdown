import { app, Menu } from 'electron';
import type { BrowserWindow, MenuItem } from 'electron';
import type { ApplicationMenuEntry, AppCommand } from '../../protocol/desktop-api';
import { PREVIEW_THEMES, type PreviewThemeId } from '../../core/preview/preview-preferences';
import type { WindowState } from '../windows/window-state';

type MenuContext = {
  focusedState: () => WindowState | null;
  createWindow: () => unknown;
  openDocument: (state: WindowState) => unknown;
  reloadWindow: (state: WindowState) => void;
  sendCommand: (command: AppCommand) => void;
  setTheme: (theme: PreviewThemeId) => void;
  theme: () => PreviewThemeId;
  zoom: (steps: number, scope?: 'app' | 'text') => void;
};

const TOP_LEVEL_IDS = new Set([
  'application-menu-file',
  'application-menu-view',
  'application-menu-edit',
  'application-menu-window',
]);

function serialize(items: readonly MenuItem[], parentId: string): ApplicationMenuEntry[] {
  return items.filter((item) => item.visible).map((item, index) => ({
    id: item.id || `${parentId}-separator-${index}`,
    label: item.label,
    ...(item.accelerator ? { accelerator: String(item.accelerator) } : {}),
    type: item.submenu ? 'submenu'
      : item.type === 'separator' || item.type === 'checkbox' || item.type === 'radio'
        ? item.type : 'normal',
    enabled: item.enabled,
    checked: item.checked,
    ...(item.submenu ? { submenu: serialize(item.submenu.items, item.id || parentId) } : {}),
  }));
}

function find(items: readonly MenuItem[], id: string): MenuItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    const nested = item.submenu && find(item.submenu.items, id);
    if (nested) return nested;
  }
  return null;
}

export function applicationMenuEntries(menuId: unknown): ApplicationMenuEntry[] {
  if (typeof menuId !== 'string' || !TOP_LEVEL_IDS.has(menuId)) return [];
  const item = Menu.getApplicationMenu()?.getMenuItemById(menuId);
  return item?.submenu ? serialize(item.submenu.items, menuId) : [];
}

export function executeApplicationMenu(itemId: unknown, window: BrowserWindow) {
  const menu = Menu.getApplicationMenu();
  if (!menu || typeof itemId !== 'string') return;
  const item = find(menu.items, itemId);
  if (!item?.click || item.submenu || item.type === 'separator') return;
  item.click(item, window, { triggeredByAccelerator: false } as Electron.KeyboardEvent);
}

export function installApplicationMenu(context: MenuContext) {
  const state = () => context.focusedState();
  const contents = () => state()?.window.webContents;
  const command = context.sendCommand;
  const menu = Menu.buildFromTemplate([
    {
      id: 'application-menu-file', label: 'File', submenu: [
        { id: 'menu-new-window', label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => context.createWindow() },
        { id: 'menu-new-document', label: 'New', accelerator: 'CmdOrCtrl+N', click: () => command('new-document') },
        { id: 'menu-open-document', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => {
          const current = state();
          if (current) void context.openDocument(current);
        } },
        { id: 'menu-open-folder', label: 'Open Folder…', click: () => command('open-folder') },
        { type: 'separator' },
        { id: 'save', label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => command('save') },
        { id: 'menu-save-as', label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => command('save-as') },
        { id: 'menu-export-pdf', label: 'Export as PDF…', click: () => command('export-pdf') },
        { type: 'separator' },
        { id: 'menu-close-tab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => command('close-tab') },
        { type: 'separator' },
        { id: 'menu-quit', label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      id: 'application-menu-view', label: 'View', submenu: [
        { id: 'menu-toggle-terminal', label: 'Toggle Terminal', accelerator: 'Ctrl+`', click: () => command('toggle-terminal') },
        { id: 'menu-toggle-folder-tools', label: 'Toggle Folder Tools', click: () => command('toggle-folder-tools') },
        { id: 'menu-toggle-surface', label: 'Toggle Viewer / Editor', accelerator: 'CmdOrCtrl+E', click: () => command('toggle-surface') },
        { id: 'menu-next-tab', label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => command('next-tab') },
        { id: 'menu-previous-tab', label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => command('previous-tab') },
        { type: 'separator' },
        { id: 'preview-find', label: 'Find in Preview', accelerator: 'CmdOrCtrl+F', click: () => command('open-find') },
        {
          id: 'menu-theme', label: 'Theme', submenu: PREVIEW_THEMES.map((theme) => ({
            id: `preview-theme-${theme.id}`,
            label: theme.label,
            type: 'radio' as const,
            checked: theme.id === context.theme(),
            click: () => context.setTheme(theme.id),
          })),
        },
        { type: 'separator' },
        { id: 'menu-reload', label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => {
          const current = state();
          if (current) context.reloadWindow(current);
        } },
        { id: 'menu-toggle-devtools', label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', click: () => contents()?.toggleDevTools() },
        { type: 'separator' },
        { id: 'menu-reset-zoom', label: 'Reset App Zoom', accelerator: 'CmdOrCtrl+0', click: () => context.zoom(0) },
        { id: 'menu-zoom-in', label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => context.zoom(1) },
        { id: 'menu-zoom-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => context.zoom(-1) },
        { id: 'menu-reset-text-zoom', label: 'Reset Text Size', click: () => context.zoom(0, 'text') },
      ],
    },
    {
      id: 'application-menu-edit', label: 'Edit', submenu: [
        { id: 'menu-undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => contents()?.undo() },
        { id: 'menu-redo', label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => contents()?.redo() },
        { type: 'separator' },
        { id: 'menu-cut', label: 'Cut', accelerator: 'CmdOrCtrl+X', click: () => contents()?.cut() },
        { id: 'menu-copy', label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => contents()?.copy() },
        { id: 'menu-paste', label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => contents()?.paste() },
        { type: 'separator' },
        { id: 'menu-select-all', label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => contents()?.selectAll() },
      ],
    },
    {
      id: 'application-menu-window', label: 'Window', submenu: [
        { id: 'menu-minimize-window', label: 'Minimize', accelerator: 'CmdOrCtrl+M', click: () => state()?.window.minimize() },
        { id: 'menu-toggle-maximize-window', label: 'Toggle Maximize', click: () => {
          const window = state()?.window;
          if (window?.isMaximized()) window.unmaximize();
          else window?.maximize();
        } },
        { id: 'menu-close-window', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => state()?.window.close() },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}
