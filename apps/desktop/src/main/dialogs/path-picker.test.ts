import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { PathPickerRequest } from '../../protocol/files';
import type { WindowState } from '../windows/window-state';
import type { WindowIpc } from '../ipc/window-ipc';
import { installPathPicker, pathDialog, pendingPickerCount } from './path-picker';

let result: ((state: WindowState, ...args: unknown[]) => void) | undefined;
const sent: PathPickerRequest[] = [];
const closers = new Set<() => void>();
const window = {
  isDestroyed: () => false, isMinimized: () => false, restore() {}, focus() {},
  once: (_event: string, listener: () => void) => { closers.add(listener); },
  removeListener: (_event: string, listener: () => void) => { closers.delete(listener); },
  webContents: { id: 7, send: (_channel: string, request: PathPickerRequest) => { sent.push(request); } },
} as unknown as BrowserWindow;
const owner = { webContentsId: 7, rendererTabsReady: true, window } as unknown as WindowState;
const stranger = { ...owner, webContentsId: 8 } as WindowState;
const roots: string[] = [];
let root = '';

beforeAll(() => {
  installPathPicker({ on: (channel: string, listener: typeof result) => { if (channel === 'picker:result') result = listener; }, handle() {} } as unknown as WindowIpc,
    id => id === 7 ? owner : null);
});
afterEach(async () => { sent.length = 0; answered = 0; await Promise.all(roots.splice(0).map(item => rm(item, { recursive: true, force: true }))); });
async function setup() {
  root = await mkdtemp(path.join(os.tmpdir(), 'setdown-picker-')); roots.push(root);
  await mkdir(path.join(root, 'docs')); await writeFile(path.join(root, 'notes.md'), '');
}
let answered = 0;
/** Wait until the next request reaches the renderer, then reply as `from`. */
const answer = async (paths: string[] | null, from = owner) => {
  for (let attempt = 0; attempt < 200 && sent.length <= answered; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  const request = sent[answered];
  if (from === owner) answered++;
  result!(from, request.id, paths);
};

describe('in-app path picker gateway', () => {
  test('maps Electron options to a picker request and starts at an existing folder', async () => {
    await setup();
    const pending = pathDialog.showOpenDialog(window, { title: 'Open Folder', properties: ['openDirectory'], defaultPath: path.join(root, 'docs', 'missing', 'x') });
    await answer([path.join(root, 'docs')]);
    expect(await pending).toEqual({ canceled: false, filePaths: [path.join(root, 'docs')] });
    expect(sent[0]).toMatchObject({ kind: 'open', files: false, folders: true, multiple: false, title: 'Open Folder', folder: path.join(root, 'docs') });
  });

  test('rejects a reply whose kind, count or owner does not match the request', async () => {
    await setup();
    const folder = pathDialog.showOpenDialog(window, { properties: ['openDirectory'] });
    await answer([path.join(root, 'notes.md')]);
    expect(await folder).toEqual({ canceled: true, filePaths: [] });
    const single = pathDialog.showOpenDialog(window, { properties: ['openFile'] });
    await answer([path.join(root, 'notes.md'), path.join(root, 'notes.md')]);
    expect((await single).canceled).toBe(true);
    const owned = pathDialog.showOpenDialog(window, { properties: ['openFile'] });
    await answer([path.join(root, 'notes.md')], stranger);
    expect(pendingPickerCount()).toBe(1);
    await answer([path.join(root, 'notes.md')]);
    expect(await owned).toEqual({ canceled: false, filePaths: [path.join(root, 'notes.md')] });
  });

  test('save requires an existing parent and never returns a folder', async () => {
    await setup();
    const save = pathDialog.showSaveDialog(window, { defaultPath: path.join(root, 'report.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    await answer([path.join(root, 'out.pdf')]);
    expect(await save).toEqual({ canceled: false, filePath: path.join(root, 'out.pdf') });
    expect(sent[0]).toMatchObject({ kind: 'save', folder: root, name: 'report.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    const folder = pathDialog.showSaveDialog(window, {});
    await answer([path.join(root, 'docs')]);
    expect((await folder).canceled).toBe(true);
    const missing = pathDialog.showSaveDialog(window, {});
    await answer([path.join(root, 'nope', 'x.md')]);
    expect((await missing).canceled).toBe(true);
  });

  test('closing the window cancels a pending request', async () => {
    await setup();
    const pending = pathDialog.showOpenDialog(window, { properties: ['openFile'] });
    for (let attempt = 0; attempt < 200 && !sent.length; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(pendingPickerCount()).toBe(1);
    for (const close of [...closers]) close();
    expect(await pending).toEqual({ canceled: true, filePaths: [] });
    expect(pendingPickerCount()).toBe(0);
  });
});
