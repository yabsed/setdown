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
