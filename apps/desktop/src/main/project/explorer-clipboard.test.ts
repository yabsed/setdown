import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const memory = vi.hoisted(() => ({ items: [] as { types: string[]; getType(type: string): Promise<Blob> }[] }));
vi.mock('electron', () => ({
  ClipboardItem: class {
    types: string[];
    constructor(private entries: Record<string, Blob | string>) { this.types = Object.keys(entries); }
    async getType(type: string) { const value = this.entries[type]; return typeof value === 'string' ? new Blob([value]) : value; }
  },
  clipboard: {
    read: async () => memory.items,
    has: async (type: string) => memory.items.some(item => item.types.includes(type)),
    write: async (items: typeof memory.items) => { memory.items = items; },
    clear: () => { memory.items = []; },
  },
}));
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExplorerClipboardStore } from './explorer-clipboard';
import { ExplorerService } from './explorer-service';
import { ProjectPaths } from './project-paths';
import { FileBrowserService } from '../files/file-browser-service';
import type { LanguageFileOperation } from '../language/file-operations';
import type { WindowState } from '../windows/window-state';
import type { ExplorerOperationResult } from '../../protocol/explorer';

const temporary: string[] = [];
beforeEach(() => { memory.items = []; });
afterEach(async () => { await Promise.all(temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const moved = (from: string): ExplorerOperationResult => ({ kind: 'move', undoable: false,
  items: [{ from, to: `/target${from}`, status: 'completed' }] });

test('an OS clipboard replacement invalidates Cut instead of resurrecting a persisted selection', async () => {
  const store = new ExplorerClipboardStore(); await store.write(['/a'], true);
  expect(await store.read()).toEqual({ paths: ['/a'], cut: true });
  memory.items = [];
  expect(await store.read()).toBeNull();
});
test('a copy names its files for other applications; a Cut offers them only as a copy', async () => {
  const store = new ExplorerClipboardStore(), raw = (format: string) => `electron application/osclipboard;format="${format}"`;
  const text = async (format: string) => (await memory.items[0].getType(format)).text();
  await store.write(['/photos/a b.jpg', '/notes/회의.hwp'], false);
  expect(await text(raw('text/uri-list'))).toBe('file:///photos/a%20b.jpg\r\nfile:///notes/%ED%9A%8C%EC%9D%98.hwp');
  expect(await text(raw('x-special/gnome-copied-files'))).toBe('copy\nfile:///photos/a%20b.jpg\nfile:///notes/%ED%9A%8C%EC%9D%98.hwp');
  expect(await text('text/plain')).toBe('/photos/a b.jpg\n/notes/회의.hwp');
  expect(await store.read()).toEqual({ paths: ['/photos/a b.jpg', '/notes/회의.hwp'], cut: false });
  await store.write(['/photos/a b.jpg'], true);
  expect(memory.items[0].types).toContain(raw('text/uri-list'));
  expect(memory.items[0].types).not.toContain(raw('x-special/gnome-copied-files'));
});
test('only committed moves consume Cut and another copy of the same paths has a different identity', async () => {
  const store = new ExplorerClipboardStore(); await store.write(['/a', '/b'], true);
  const first = (await store.snapshot())!;
  await store.consume(first, moved('/a'));
  expect(await store.read()).toEqual({ paths: ['/b'], cut: true });
  const pending = (await store.snapshot())!;
  await store.write(['/b'], true);
  await store.consume(pending, moved('/b'));
  expect(await store.read()).toEqual({ paths: ['/b'], cut: true });
  await store.consume((await store.snapshot())!, moved('/b'));
  expect(await store.read()).toBeNull();
});
test('Escape does not clear unrelated clipboard data', async () => {
  const store = new ExplorerClipboardStore(); await store.write(['/a'], true);
  const other = { types: ['text/plain'], getType: async () => new Blob(['keep']) };
  memory.items = [other]; await store.clear(); expect(memory.items).toEqual([other]);
});

test('completed Cut cannot clear a new selection arriving during asynchronous clipboard cleanup', async () => {
  const store = new ExplorerClipboardStore(); await store.write(['/a'], true);
  const original = (await store.snapshot())!;
  const clear = store.clear.bind(store);
  vi.spyOn(store, 'clear').mockImplementationOnce(async token => {
    await store.write(['/new'], true);
    await clear(token);
  });
  await store.consume(original, moved('/a'));
  expect(await store.read()).toEqual({ paths: ['/new'], cut: true });
});

test('clearing waits for clipboard verification without deleting a newer Setdown selection', async () => {
  const store = new ExplorerClipboardStore(); await store.write(['/a'], true);
  const snapshot = store.snapshot.bind(store);
  vi.spyOn(store, 'snapshot').mockImplementationOnce(async () => {
    const previous = await snapshot();
    await store.write(['/new'], false);
    return previous;
  });
  await store.clear();
  expect(await store.read()).toEqual({ paths: ['/new'], cut: false });
});

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3);
const item = (entries: Record<string, Blob | string>) => ({ types: Object.keys(entries),
  getType: async (type: string) => { const value = entries[type]; return typeof value === 'string' ? new Blob([value]) : value; } });
const explorer = () => ({ transfer: vi.fn(async (_state: unknown, request: { kind: string }) => ({ kind: request.kind, items: [], undoable: false })),
  createFile: vi.fn(async (_state: unknown, target: string, name: string) => ({ kind: 'import', undoable: true,
    items: [{ from: `${target}/${name}`, to: `${target}/${name}`, status: 'completed' }] })) });

test('image data copied from a browser pastes as a new file named after its source', async () => {
  const store = new ExplorerClipboardStore(), target = explorer();
  memory.items = [item({ 'text/html': '<img src="https://example.com/cat.jpg">', 'image/png': new Blob([PNG]) })];
  expect(await store.read()).toEqual({ paths: [], cut: false, image: true });
  const result = await store.paste(target as never, {} as never, '/folder');
  expect(target.transfer).not.toHaveBeenCalled();
  expect(target.createFile).toHaveBeenCalledWith({}, '/folder', 'cat.png', PNG);
  expect(result.items[0].to).toBe('/folder/cat.png');
});

test('a format that is advertised but not delivered falls through to the next one', async () => {
  const store = new ExplorerClipboardStore();
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 9);
  memory.items = [{ types: ['image/png', 'electron application/osclipboard;format="image/jpeg"'],
    getType: async (type: string) => { if (type === 'image/png') throw Error('conversion failed'); return new Blob([jpeg]); } }];
  expect(await store.image()).toEqual({ name: 'Pasted image.jpg', bytes: jpeg });
  memory.items = [item({ 'image/png': '<html>an error page, not pixels</html>' })];
  expect(await store.image()).toBeNull();
});

test('copied files win over image data, and a clipboard with neither says what to copy', async () => {
  const store = new ExplorerClipboardStore(), target = explorer();
  // An image viewer can offer the file and its pixels together; the file keeps its name and format.
  memory.items = [item({ 'text/uri-list': 'file:///photos/a%20b.jpg\r\n', 'image/png': new Blob([PNG]) })];
  expect(await store.read()).toEqual({ paths: ['/photos/a b.jpg'], cut: false });
  await store.paste(target as never, {} as never, '/folder', 'keep-both');
  expect(target.transfer).toHaveBeenCalledWith({}, { kind: 'import', paths: ['/photos/a b.jpg'], target: '/folder', conflict: 'keep-both' });
  expect(target.createFile).not.toHaveBeenCalled();
  memory.items = [item({ 'text/plain': 'ordinary text' })];
  expect(await store.read()).toBeNull();
  await expect(store.paste(target as never, {} as never, '/folder')).rejects.toThrow('Copy files or an image first');
});

test('a pending Setdown selection is replaced by a newer image copy', async () => {
  const store = new ExplorerClipboardStore(), target = explorer(); await store.write(['/a'], true);
  memory.items = [item({ 'image/png': new Blob([PNG]) })];
  expect(await store.read()).toEqual({ paths: [], cut: false, image: true });
  await store.paste(target as never, {} as never, '/folder');
  expect(target.transfer).not.toHaveBeenCalled();
  expect(target.createFile).toHaveBeenCalledWith({}, '/folder', 'Pasted image.png', PNG);
});

test('files copied or cut in a folder tab paste into the folder the sidebar shows, and Undo sends a cut file back', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'setdown-clipboard-')); temporary.push(base);
  const root = path.join(base, 'workspace'), elsewhere = path.join(base, 'elsewhere');
  await mkdir(path.join(root, 'src'), { recursive: true }); await mkdir(path.join(elsewhere, 'kit'), { recursive: true });
  const copied = path.join(elsewhere, 'main.cpp'), cut = path.join(elsewhere, 'kit');
  await writeFile(copied, 'int main() {}'); await writeFile(path.join(cut, 'tool.py'), 'pass');
  const store = new ExplorerClipboardStore();
  const tabs = new FileBrowserService({ clipboard: store, beforeMutation() {} });
  const sidebar = new ExplorerService(new ProjectPaths(), file => rm(file, { recursive: true }));
  const events: string[] = [];
  sidebar.languageOperation = async (_state, operation: LanguageFileOperation, phase) => {
    events.push(`${phase}:${operation.kind}:${operation.files.map(file => path.relative(base, file.path)).join()}`);
  };
  const state = { projectRoot: root, webContentsId: 1, rendererTabs: [], window: { webContents: { send() {} } } } as unknown as WindowState;

  await tabs.setClipboard([copied], false);
  expect(await store.paste(sidebar, state, path.join(root, 'src'))).toEqual({ kind: 'copy', undoable: true,
    items: [{ from: copied, to: path.join(root, 'src', 'main.cpp'), status: 'completed' }] });
  expect(await readFile(path.join(root, 'src', 'main.cpp'), 'utf8')).toBe('int main() {}');
  expect(await readFile(copied, 'utf8')).toBe('int main() {}');
  // A second paste meets the first one's file and asks, like any other paste.
  await expect(store.paste(sidebar, state, path.join(root, 'src'))).rejects.toThrow('already exists');

  await tabs.setClipboard([cut], true);
  const moved = await store.paste(sidebar, state, root);
  expect(moved.items).toEqual([{ from: cut, to: path.join(root, 'kit'), status: 'completed' }]);
  expect(await readFile(path.join(root, 'kit', 'tool.py'), 'utf8')).toBe('pass');
  expect(await readdir(elsewhere)).toEqual(['main.cpp']);
  expect(await store.read()).toBeNull();
  // The servers of the open folder never knew the old path: what arrives is a new file, not a rename.
  expect(events).toEqual(['will:create:workspace/src/main.cpp', 'did:create:workspace/src/main.cpp',
    'will:create:workspace/kit', 'did:create:workspace/kit']);

  expect((await sidebar.transfer(state, { kind: 'undo', paths: [] })).items).toEqual([{ from: path.join(root, 'kit'), to: cut, status: 'completed' }]);
  expect(await readFile(path.join(cut, 'tool.py'), 'utf8')).toBe('pass');
  expect(await readdir(root)).toEqual(['src']);

  // The paste target is still held to the open folder, and so is a request that names its own sources.
  await tabs.setClipboard([copied], false);
  await expect(store.paste(sidebar, state, elsewhere)).rejects.toThrow('outside the open folder');
  await expect(sidebar.transfer(state, { kind: 'move', paths: [copied], target: root })).rejects.toThrow('outside the open folder');
  await expect(sidebar.transfer(state, { kind: 'copy', paths: [copied], target: root })).rejects.toThrow('outside the open folder');
  // A folder that holds the open folder cannot be pasted into it.
  await tabs.setClipboard([base], false);
  await expect(store.paste(sidebar, state, root)).rejects.toThrow('into itself');
});
