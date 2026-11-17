import { beforeEach, expect, test, vi } from 'vitest';
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
import { ExplorerClipboardStore } from './explorer-clipboard';
import type { ExplorerOperationResult } from '../../protocol/explorer';

beforeEach(() => { memory.items = []; });
const moved = (from: string): ExplorerOperationResult => ({ kind: 'move', undoable: false,
  items: [{ from, to: `/target${from}`, status: 'completed' }] });

test('an OS clipboard replacement invalidates Cut instead of resurrecting a persisted selection', async () => {
  const store = new ExplorerClipboardStore(); await store.write(['/a'], true);
  expect(await store.read()).toEqual({ paths: ['/a'], cut: true });
  memory.items = [];
  expect(await store.read()).toBeNull();
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
