import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dialog as electronDialog, type BrowserWindow, type OpenDialogOptions, type OpenDialogReturnValue,
  type SaveDialogOptions, type SaveDialogReturnValue } from 'electron';
import type { PathPickerFilter, PathPickerRequest } from '../../protocol/files';
import type { WindowState } from '../windows/window-state';
import type { WindowIpc } from '../ipc/window-ipc';

/**
 * Setdown's file chooser gateway.
 *
 * Electron 44 on GNOME routes `dialog.show*Dialog` through xdg-desktop-portal to
 * GNOME Files. Call sites keep Electron's exact signatures and result shapes, but
 * the request opens a picker-mode folder tab in the requesting window instead.
 * The renderer's reply is untrusted: kind, count and parent folder are checked
 * again here before a caller sees a path (as Theia re-checks native picks).
 *
 * `SETDOWN_NATIVE_DIALOGS=1` keeps the platform dialog (tests that stub
 * `electron.dialog` use it); a window without a ready renderer also falls back.
 */
type Pending = { owner: number; request: PathPickerRequest; resolve(paths: string[] | null): void };
let stateFor: ((webContentsId: number) => WindowState | null) | null = null;
const pending = new Map<string, Pending>();

export const nativeDialogsRequested = () => process.env.SETDOWN_NATIVE_DIALOGS === '1';

export function installPathPicker(channels: WindowIpc, lookup: (webContentsId: number) => WindowState | null): void {
  stateFor = lookup;
  channels.on('picker:result', (state, id: unknown, paths: unknown) => {
    const request = typeof id === 'string' ? pending.get(id) : undefined;
    if (!request || request.owner !== state.webContentsId) return;
    pending.delete(id as string);
    request.resolve(Array.isArray(paths) && paths.every(item => typeof item === 'string') ? paths as string[] : null);
  });
}

async function existingFolder(candidate: string | undefined): Promise<{ folder: string; name?: string }> {
  if (!candidate || !path.isAbsolute(candidate)) return { folder: '', ...(candidate && !path.isAbsolute(candidate) ? { name: path.basename(candidate) } : {}) };
  const resolved = path.resolve(candidate);
  const stat = await fs.stat(resolved).catch(() => null);
  if (stat?.isDirectory()) return { folder: resolved };
  let parent = path.dirname(resolved);
  while (!(await fs.stat(parent).then(item => item.isDirectory(), () => false))) {
    const next = path.dirname(parent);
    if (next === parent) return { folder: '', name: path.basename(resolved) };
    parent = next;
  }
  return { folder: parent, name: parent === path.dirname(resolved) ? path.basename(resolved) : undefined };
}

const filtersOf = (filters: Electron.FileFilter[] | undefined): PathPickerFilter[] =>
  (filters ?? []).filter(filter => filter && typeof filter.name === 'string' && Array.isArray(filter.extensions))
    .map(filter => ({ name: filter.name, extensions: filter.extensions.map(String) }));

function readyState(window: BrowserWindow): WindowState | null {
  // Without an installed picker (unit tests, early startup) Electron's dialog is used unchanged.
  if (nativeDialogsRequested() || !stateFor || window.isDestroyed()) return null;
  const state = stateFor(window.webContents.id);
  return state?.rendererTabsReady ? state : null;
}

function ask(state: WindowState, request: Omit<PathPickerRequest, 'id'>): Promise<string[] | null> {
  const id = randomUUID();
  return new Promise(resolve => {
    const owner = state.webContentsId;
    const close = () => { if (pending.delete(id)) resolve(null); };
    pending.set(id, { owner, request: { ...request, id }, resolve: paths => { state.window.removeListener('closed', close); resolve(paths); } });
    state.window.once('closed', close);
    state.window.webContents.send('picker:request', { ...request, id });
    if (state.window.isMinimized()) state.window.restore();
    state.window.focus();
  });
}

async function validOpen(paths: string[], request: Omit<PathPickerRequest, 'id'>): Promise<string[] | null> {
  if (!paths.length || (!request.multiple && paths.length !== 1)) return null;
  const checked: string[] = [];
  for (const candidate of paths) {
    if (!path.isAbsolute(candidate) || candidate.includes('\0')) return null;
    const stat = await fs.stat(candidate).catch(() => null);
    if (!stat || (stat.isDirectory() ? !request.folders : !request.files)) return null;
    checked.push(path.resolve(candidate));
  }
  return checked;
}

async function validSave(paths: string[]): Promise<string | null> {
  if (paths.length !== 1 || !path.isAbsolute(paths[0]) || paths[0].includes('\0')) return null;
  const target = path.resolve(paths[0]);
  if (!(await fs.stat(path.dirname(target)).then(stat => stat.isDirectory(), () => false))) return null;
  if (await fs.stat(target).then(stat => stat.isDirectory(), () => false)) return null;
  return target;
}

export const pathDialog = {
  async showOpenDialog(window: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue> {
    const state = readyState(window);
    if (!state) return electronDialog.showOpenDialog(window, options);
    const properties = options.properties ?? [];
    const folders = properties.includes('openDirectory');
    const files = properties.includes('openFile') || !folders;
    const start = await existingFolder(options.defaultPath);
    const request = { kind: 'open' as const, files, folders, multiple: properties.includes('multiSelections'),
      title: options.title || (folders && !files ? 'Open Folder' : 'Open File'), buttonLabel: options.buttonLabel || undefined,
      folder: start.folder, name: start.name, filters: filtersOf(options.filters), showHidden: properties.includes('showHiddenFiles'),
      purpose: options.title || (folders && !files ? 'open-folder' : 'open-file') };
    const reply = await ask(state, request);
    const filePaths = reply ? await validOpen(reply, request) : null;
    return filePaths ? { canceled: false, filePaths } : { canceled: true, filePaths: [] };
  },
  async showSaveDialog(window: BrowserWindow, options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
    const state = readyState(window);
    if (!state) return electronDialog.showSaveDialog(window, options);
    const start = await existingFolder(options.defaultPath);
    const request = { kind: 'save' as const, files: true, folders: false, multiple: false,
      title: options.title || 'Save File', buttonLabel: options.buttonLabel || undefined,
      folder: start.folder, name: start.name ?? '', filters: filtersOf(options.filters),
      showHidden: options.properties?.includes('showHiddenFiles') ?? false, purpose: options.title || 'save-file' };
    const reply = await ask(state, request);
    const filePath = reply ? await validSave(reply) : null;
    return filePath ? { canceled: false, filePath } : { canceled: true, filePath: '' };
  },
};

export const pendingPickerCount = () => pending.size;
