import { beforeEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { WindowState } from '../windows/window-state';
import { LanguageManager } from './language-manager';

const mocks = vi.hoisted(() => ({ handles: new Map<string, (...args: any[]) => any>(),
  events: new Map<string, (...args: any[]) => void>(), app: new Map<string, (...args: any[]) => void>(),
  servers: [] as { notify: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; root: string }[] }));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/setdown-language-settings-test', on: (key: string, fn: (...args: any[]) => void) => mocks.app.set(key, fn), quit: vi.fn() },
  ipcMain: { handle: (key: string, fn: (...args: any[]) => any) => mocks.handles.set(key, fn),
    on: (key: string, fn: (...args: any[]) => void) => mocks.events.set(key, fn) } }));
vi.mock('./server-session', () => ({ ServerSession: class {
  readonly ready = Promise.resolve({});
  readonly notify = vi.fn(async (_method: string, _params: unknown) => {});
  readonly stop = vi.fn(async () => {});
  readonly request = vi.fn(async () => null);
  readonly watch = vi.fn();
  constructor(readonly launch: unknown, readonly root: string) { mocks.servers.push(this); }
} }));
beforeEach(() => { mocks.handles.clear(); mocks.events.clear(); mocks.app.clear(); mocks.servers.length = 0; });

function fixture() {
  const root = path.resolve('language-fixture');
  const states = new Map<number, WindowState>();
  const event = (id: number) => {
    const contents = Object.assign(new EventEmitter(), { id, mainFrame: {}, isDestroyed: () => false, send: vi.fn() });
    states.set(id, { webContentsId: id, projectRoot: root, currentDocument: { path: path.join(root, 'main.py') },
      rendererTabs: ['other.py', 'main.cpp', 'helper.h', 'other.c'].map(name => ({ path: path.join(root, name), isUntitled: false })),
      window: { webContents: contents, isDestroyed: () => false } } as unknown as WindowState);
    return { sender: contents, senderFrame: contents.mainFrame };
  };
  const first = event(1), second = event(2);
  new LanguageManager(id => states.get(id) ?? null).install();
  const document = (id: string, name = 'main.py') => ({ id, generation: `generation-${id}`, path: path.join(root, name), text: id, version: 1 });
  return { first, second, document, invoke: (key: string, ...args: unknown[]) => mocks.handles.get(`language:${key}`)!(...args),
    send: (key: string, ...args: unknown[]) => mocks.events.get(`language:${key}`)!(...args) };
}
test('one server per window and root, with independent buffers and last-document shutdown', async () => {
  const f = fixture();
  await f.invoke('open', f.first, f.document('one'));
  await f.invoke('open', f.first, f.document('two', 'other.py'));
  await f.invoke('open', f.second, f.document('three'));
  expect(mocks.servers).toHaveLength(2);
  expect(mocks.servers[0].notify.mock.calls.filter(call => call[0] === 'textDocument/didOpen')).toHaveLength(2);
  expect(mocks.servers[1].notify).toHaveBeenCalledWith('textDocument/didOpen', expect.objectContaining({ textDocument: expect.objectContaining({ text: 'three' }) }));
  f.send('close', f.first, 'one');
  expect(mocks.servers[0].stop).not.toHaveBeenCalled();
  f.send('close', f.first, 'two');
  expect(mocks.servers[0].stop).toHaveBeenCalledOnce();
  expect(mocks.servers[1].stop).not.toHaveBeenCalled();
  f.second.sender.emit('destroyed');
  expect(mocks.servers[1].stop).toHaveBeenCalledOnce();
});
test('foreign frames, unknown files, methods and stale versions cannot reach a server', async () => {
  const f = fixture();
  expect(() => f.invoke('open', { ...f.first, senderFrame: {} }, f.document('one'))).toThrow(/owning editor/);
  await expect(f.invoke('open', f.first, f.document('one', 'not-open.py'))).rejects.toThrow(/not open/);
  expect(mocks.servers).toHaveLength(0);
  await f.invoke('open', f.first, f.document('one'));
  await expect(f.invoke('request', f.first, 'one', 1, 'request', 'workspace/executeCommand', {})).rejects.toThrow(/Invalid/);
  await f.invoke('change', f.first, 'one', 2, [{ text: 'new text' }]);
  await expect(f.invoke('request', f.first, 'one', 1, 'request', 'textDocument/hover', {})).rejects.toThrow(/stale/);
  expect(() => f.invoke('change', f.first, 'one', 1, [{ text: 'old text' }])).toThrow(/Invalid/);
  expect(() => f.send('close', { ...f.first, senderFrame: {} }, 'one')).not.toThrow();
  expect(mocks.servers[0].stop).not.toHaveBeenCalled();
});


test('C, C++ and headers share clangd while Python and other windows remain independent', async () => {
  const f = fixture();
  await f.invoke('open', f.first, f.document('python'));
  await f.invoke('open', f.first, f.document('cpp', 'main.cpp'));
  await f.invoke('open', f.first, f.document('header', 'helper.h'));
  await f.invoke('open', f.first, f.document('c', 'other.c'));
  await f.invoke('open', f.second, f.document('other-window', 'main.cpp'));
  expect(mocks.servers).toHaveLength(3);
  expect(mocks.servers[1].notify).toHaveBeenCalledWith('textDocument/didOpen', expect.objectContaining({ textDocument: expect.objectContaining({ languageId: 'cpp' }) }));
  expect(mocks.servers[1].notify).toHaveBeenCalledWith('textDocument/didOpen', expect.objectContaining({ textDocument: expect.objectContaining({ languageId: 'c' }) }));
  f.send('close', f.first, 'cpp'); f.send('close', f.first, 'header');
  expect(mocks.servers[1].stop).not.toHaveBeenCalled();
  f.send('close', f.first, 'c');
  expect(mocks.servers[1].stop).toHaveBeenCalledOnce();
  expect(mocks.servers[0].stop).not.toHaveBeenCalled();
  expect(mocks.servers[2].stop).not.toHaveBeenCalled();
});
