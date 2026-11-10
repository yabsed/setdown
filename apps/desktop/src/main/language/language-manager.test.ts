import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WindowState } from '../windows/window-state';
import { LanguageManager, type AutomaticLanguagePackages } from './language-manager';
import { ServerDiscovery } from './server-discovery';
import { ServerEnvironment } from './server-environment';

const mocks = vi.hoisted(() => ({ directory: '', handles: new Map<string, (...args: any[]) => any>(),
  events: new Map<string, (...args: any[]) => void>(), app: new Map<string, (...args: any[]) => void>(),
  servers: [] as { notify: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; root: string; profile: any; failed: (message: string) => void; diagnostics: (params: any) => void }[] }));
vi.mock('electron', () => ({ app: { getPath: () => mocks.directory, on: (key: string, fn: (...args: any[]) => void) => mocks.app.set(key, fn), quit: vi.fn() },
  ipcMain: { handle: (key: string, fn: (...args: any[]) => any) => mocks.handles.set(key, fn),
    on: (key: string, fn: (...args: any[]) => void) => mocks.events.set(key, fn) } }));
vi.mock('../notebook/python-environments', () => ({ notebookPython: { list: async () => ({ candidates: [], selected: '/usr/bin/python3' }), resolve: async (_file: string, python?: string) => ({ python: python ?? '/usr/bin/python3', env: {} }) } }));
vi.mock('./server-session', () => ({ ServerSession: class {
  readonly ready = Promise.resolve({ notebookDocumentSync: { notebookSelector: [{ notebook: 'jupyter-notebook' }] }, textDocumentSync: { openClose: true, change: 2, save: { includeText: true } } });
  readonly capabilities = { forDocument: () => ({ textDocumentSync: { openClose: true, change: 2, save: { includeText: true } } }) };
  readonly notify = vi.fn(async (_method: string, _params: unknown) => {});
  readonly stop = vi.fn(async () => {});
  readonly request = vi.fn(async () => null);
  readonly watch = vi.fn();
  constructor(readonly launch: unknown, readonly root: string, readonly diagnostics: (params: any) => void, readonly failed: (message: string) => void, readonly profile: any) { mocks.servers.push(this); }
} }));
beforeEach(async () => { mocks.directory = await mkdtemp(path.join(os.tmpdir(), 'setdown-manager-test-'));  mocks.handles.clear(); mocks.events.clear(); mocks.app.clear(); mocks.servers.length = 0; });

afterEach(async () => { await rm(mocks.directory, { recursive: true, force: true }); });

const noPackages: AutomaticLanguagePackages = {rank:()=>0,canPrepare:()=>false,prepare:async()=>{throw Error('No package in this discovery fixture');},highlight:async()=>[],dispose() {}};
function fixture(discovery?: ServerDiscovery, root = path.resolve('language-fixture'), packages = noPackages) {
  const states = new Map<number, WindowState>();
  const event = (id: number) => {
    const contents = Object.assign(new EventEmitter(), { id, mainFrame: {}, isDestroyed: () => false, send: vi.fn() });
    states.set(id, { webContentsId: id, projectRoot: root, currentDocument: { path: path.join(root, 'main.py') },
      rendererTabs: ['other.py', 'template.yaml', 'main.cpp', 'helper.h', 'other.c', 'hello.f90', 'other.f90', 'main.ts', 'other.ts', 'main.json', 'other.json', 'Dockerfile', 'notes.ipynb', 'other.ipynb'].map(name => ({ path: path.join(root, name), isUntitled: false })),
      window: { webContents: contents, isDestroyed: () => false } } as unknown as WindowState);
    return { sender: contents, senderFrame: contents.mainFrame };
  };
  const first = event(1), second = event(2);
  new LanguageManager(id => states.get(id) ?? null, discovery, packages).install();
  const document = (id: string, name = 'main.py') => ({ id, generation: `generation-${id}`, path: path.join(root, name), text: id, version: 1 });
  return { first, second, document, invoke: (key: string, ...args: unknown[]) => mocks.handles.get(`language:${key}`)!(...args),
    send: (key: string, ...args: unknown[]) => mocks.events.get(`language:${key}`)!(...args) };
}
test('closing a document during automatic installation prevents a late session and reopening uses the current revision',async()=>{
 const root=path.join(mocks.directory,'project');await mkdir(root);
 const discovery=new ServerDiscovery(new ServerEnvironment({HOME:mocks.directory,PATH:'',SETDOWN_LSP_INHERIT_ENV:'1'}));
 let finish!:(value:any)=>void;const waiting=new Promise<any>(resolve=>{finish=resolve;});
 const prepare=vi.fn(()=>waiting),packages={...noPackages,canPrepare:()=>true,prepare};
 const f=fixture(discovery,root,packages),opening=f.invoke('open',f.first,f.document('fortran','hello.f90'));
 const rejected=expect(opening).rejects.toThrow(/closed|configuration/);
 await vi.waitFor(()=>expect(prepare).toHaveBeenCalledOnce());f.send('close',f.first,'fortran');
 finish({executable:process.execPath,args:['server.js'],settings:{},initializationOptions:{},languageId:'fortran'});
 await rejected;expect(mocks.servers).toHaveLength(0);
 await f.invoke('open',f.first,{...f.document('fortran','hello.f90'),version:7,text:'program latest\nend program'});
 expect(mocks.servers[0].notify).toHaveBeenCalledWith('textDocument/didOpen',expect.objectContaining({textDocument:expect.objectContaining({version:7,text:'program latest\nend program'})}));
 discovery.dispose();
});
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


test('settings are owner-checked, stop previous sessions and notify every subscribed window', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const f = fixture(discovery);
  await f.invoke('configuration', f.first); await f.invoke('configuration', f.second);
  await f.invoke('open', f.first, f.document('one'));
  expect(() => f.invoke('set-enabled', { ...f.first, senderFrame: {} }, 'pyright', false)).toThrow(/owning editor/);
  await f.invoke('set-enabled', f.first, 'pyright', false);
  expect(mocks.servers[0].stop).toHaveBeenCalledOnce();
  for (const event of [f.first, f.second]) expect(event.sender.send).toHaveBeenCalledWith('language:event', { type: 'configuration', servers: expect.arrayContaining(['pyright']) });
  expect((await f.invoke('configuration', f.second)).find((r: { server: string }) => r.server === 'pyright')).toMatchObject({ enabled: false });
  expect(await f.invoke('open', f.first, f.document('one'))).toEqual({ unavailable: 'missing' });
  await f.invoke('set-enabled', f.first, 'pyright', true);
  await f.invoke('open', f.first, { ...f.document('one'), text: 'unsaved buffer', version: 5 });
  expect(mocks.servers[1].notify).toHaveBeenCalledWith('textDocument/didOpen', expect.objectContaining({ textDocument: expect.objectContaining({ text: 'unsaved buffer', version: 5 }) }));
  discovery.dispose();
});

test('save includeText uses the actual disk snapshot and a catalog read starts no process', async () => {
  const f = fixture();
  const catalog = await f.invoke('catalog', f.first);
  expect(catalog.entries.length).toBeGreaterThan(300); expect(mocks.servers).toHaveLength(0);
  expect(catalog.entries.find((entry: { id: string }) => entry.id === 'gopls').automatic).toBe(true);
  expect(catalog.entries.find((entry: { id: string }) => entry.id === 'gopls').managed).toBe(false);
  expect(catalog.entries.find((entry: { id: string }) => entry.id === 'gopls').discoverable).toBe(true);
  expect(catalog.entries.find((entry: { id: string }) => entry.id === 'apex-language-server').discoverable).toBe(false);
  await f.invoke('set-enabled', f.first, 'gopls', false);
  const updated = await f.invoke('catalog', f.first);
  expect(updated.entries.find((entry: { id: string }) => entry.id === 'gopls').managed).toBe(true);
  await f.invoke('open', f.first, f.document('one'));
  f.send('saved', f.first, 'one', 'saved text');
  expect(mocks.servers[0].notify).toHaveBeenCalledWith('textDocument/didSave', expect.objectContaining({ text: 'saved text' }));
  mocks.servers[0].notify.mockClear();
  f.send('saved', { ...f.first, senderFrame: {} }, 'one', 'foreign text');
  f.send('saved', f.first, 'one');
  expect(mocks.servers[0].notify).not.toHaveBeenCalled();
});

test('rescanning and configuring Fortran preserve unrelated Python sessions in every window', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const f = fixture(discovery);
  await f.invoke('open', f.first, f.document('python'));
  await f.invoke('open', f.second, f.document('other-python'));
  expect(await f.invoke('open', f.first, f.document('fortran', 'hello.f90'))).toEqual({ unavailable: 'missing' });
  await f.invoke('rescan', f.first);
  expect(mocks.servers).toHaveLength(2); expect(mocks.servers.every(s => !s.stop.mock.calls.length)).toBe(true);
  await f.invoke('configure', f.first, 'fortls', { args: ['--disable_autoupdate'], settings: {}, initializationOptions: {} });
  expect(mocks.servers.every(s => !s.stop.mock.calls.length)).toBe(true);
  expect(f.first.sender.send).toHaveBeenCalledWith('language:event', { type: 'configuration', servers: ['fortls'] });
  discovery.dispose();
});

test('closing a document during environment discovery prevents a late server launch', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  let finish!: (value: { env: NodeJS.ProcessEnv; source: 'inherited' }) => void;
  const waiting = new Promise<{ env: NodeJS.ProcessEnv; source: 'inherited' }>(resolve => { finish = resolve; });
  const resolve = vi.spyOn(discovery.environment, 'resolve').mockReturnValue(waiting);
  vi.spyOn(discovery, 'find').mockResolvedValue({ candidates: [], selected: { id: 'fixture', path: process.execPath, source: 'path' }, environment: { env: {}, source: 'inherited' }, searched: [] });
  const f = fixture(discovery);
  const opened = f.invoke('open', f.first, f.document('fortran', 'hello.f90'));
  const rejected = expect(opened).rejects.toThrow(/closed or configuration changed/);
  await vi.waitFor(() => expect(resolve).toHaveBeenCalled());
  f.send('close', f.first, 'fortran'); finish({ env: {}, source: 'inherited' });
  await rejected; expect(mocks.servers).toHaveLength(0); discovery.dispose();
});


test('new documents reuse the live workspace session after discovery chooses a new executable', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const find = vi.spyOn(discovery, 'find').mockResolvedValue({ candidates: [], selected: { id: 'first', path: process.execPath, source: 'path' },
    environment: { env: {}, source: 'inherited' }, searched: [] });
  const f = fixture(discovery);
  await f.invoke('open', f.first, f.document('one', 'hello.f90'));
  find.mockResolvedValue({ candidates: [], selected: { id: 'second', path: '/different/fortls', source: 'path' },
    environment: { env: { PATH: '/different' }, source: 'inherited' }, searched: [] });
  await f.invoke('rescan', f.first);
  await f.invoke('open', f.first, f.document('two', 'other.f90'));
  expect(mocks.servers).toHaveLength(1); expect(mocks.servers[0].stop).not.toHaveBeenCalled();
  expect(mocks.servers[0].notify.mock.calls.filter(call => call[0] === 'textDocument/didOpen')).toHaveLength(2);
  await f.invoke('restart', f.first);
  await f.invoke('open', f.first, f.document('three', 'hello.f90'));
  expect(mocks.servers).toHaveLength(2);
  expect(mocks.servers[1]).toMatchObject({ launch: { executable: '/different/fortls' } }); discovery.dispose();
});

test('rescan during document discovery discards the stale plan and completes the pending connection', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const old = { candidates: [], selected: { id: 'old', path: '/old/fortls', source: 'path' as const },
    environment: { env: {}, source: 'inherited' as const }, searched: [] };
  let finish!: (value: typeof old) => void;
  const waiting = new Promise<typeof old>(resolve => { finish = resolve; });
  const find = vi.spyOn(discovery, 'find').mockResolvedValue({ ...old, selected: { ...old.selected, path: '/new/fortls' } }).mockReturnValueOnce(waiting);
  const f = fixture(discovery);
  const opening = f.invoke('open', f.first, f.document('one', 'hello.f90'));
  await vi.waitFor(() => expect(find).toHaveBeenCalledOnce());
  await f.invoke('rescan', f.first);
  finish(old); await opening;
  expect(mocks.servers).toHaveLength(1);
  expect(mocks.servers[0]).toMatchObject({ launch: { executable: '/new/fortls' } }); discovery.dispose();
});

test('an imported Node profile connects without configuration and launches the bin through its runtime', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const find = vi.spyOn(discovery, 'find').mockImplementation(async command => {
    const selected = command === 'vscode-json-language-server' ? { id: 'node-bin', path: '/global/json/bin/server.js', runtime: process.execPath, source: 'npm' as const } : undefined;
    return { selected, candidates: selected ? [selected] : [], environment: { env: {}, source: 'inherited' }, searched: [] };
  });
  const f = fixture(discovery);
  const opened = await f.invoke('open', f.first, f.document('one', 'main.json'));
  expect(opened.server).toBe('json-lsp');
  expect(mocks.servers).toHaveLength(1);
  expect(mocks.servers[0]).toMatchObject({ launch: { executable: process.execPath, args: ['/global/json/bin/server.js', '--stdio'] } });
  expect(mocks.servers[0].notify).toHaveBeenCalledWith('textDocument/didOpen', expect.objectContaining({ textDocument: expect.objectContaining({ languageId: 'json' }) }));
  const probes = find.mock.calls.length;
  await f.invoke('open', f.first, f.document('two', 'other.json'));
  expect(find.mock.calls).toHaveLength(probes); // Reuse the actual selected session, not the first missing alternative.
  expect(mocks.servers).toHaveLength(1);
  discovery.dispose();
});

test('competing installed profiles wait for one choice, persist it, and never fall through a missing chosen server', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const installed = new Set(['vtsls', 'deno']);
  vi.spyOn(discovery, 'find').mockImplementation(async command => {
    const selected = installed.has(command) ? { id: command, path: process.execPath, source: 'path' as const } : undefined;
    return { selected, candidates: selected ? [selected] : [], environment: { env: {}, source: 'inherited' }, searched: [] };
  });
  const f = fixture(discovery);
  await f.invoke('set-enabled', f.first, 'typescript-language-server', false);
  expect(await f.invoke('open', f.first, f.document('one', 'main.ts'))).toEqual({ unavailable: 'selection-needed' });
  expect(mocks.servers).toHaveLength(0);
  await f.invoke('set-enabled', f.first, 'vtsls', true);
  expect((await f.invoke('open', f.first, f.document('one', 'main.ts'))).server).toBe('vtsls');
  await f.invoke('restart', f.first); installed.delete('vtsls');
  await expect(f.invoke('open', f.first, f.document('one', 'main.ts'))).rejects.toThrow(/Executable not found/);
  expect(mocks.servers).toHaveLength(1); discovery.dispose();
});

test('the full catalog discovers a server without a connection profile without launching it', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const query = vi.spyOn(discovery.environment, 'resolve');
  vi.spyOn(discovery, 'find').mockImplementation(async command => {
    const selected = command === 'aiken' ? { id: 'aiken-bin', path: process.execPath, source: 'path' as const } : undefined;
    return { selected, candidates: selected ? [selected] : [], environment: { env: {}, source: 'inherited' }, searched: [] };
  });
  const f = fixture(discovery);
  const catalog = await f.invoke('catalog', f.first);
  expect(catalog.entries.find((e: { id: string }) => e.id === 'aiken')).toMatchObject({ configured: false, discoverable: true, available: true, candidates: [{ id: 'aiken-bin', path: process.execPath, source: 'path' }] });
  expect(mocks.servers).toHaveLength(0); expect(query).not.toHaveBeenCalled();
  await expect(f.invoke('add-connection', f.first, { id: 'aiken', name: 'Aiken', candidateId: 'forged', args: ['lsp'],
    languages: [{ languageId: 'aiken', extensions: ['.ak'] }], rootMarkers: [] })).rejects.toThrow(/Installation changed/);
  await f.invoke('add-connection', f.first, { id: 'aiken', name: 'Aiken', candidateId: 'aiken-bin', args: ['lsp'],
    languages: [{ languageId: 'aiken', extensions: ['.ak'] }], rootMarkers: [] });
  expect(mocks.servers).toHaveLength(0);
  expect((await f.invoke('configuration', f.first)).some((r: { server: string }) => r.server === 'aiken')).toBe(true);
  discovery.dispose();
});


test('native notebook cells require ownership and cannot issue unmapped edits', async () => {
  const f = fixture();
  const document = { ...f.document('notebook', 'notes.ipynb'), notebook: 'python', text: '', cells: [{ id: 'one', version: 1, text: 'values = [1, 2, 3]' }] };
  const connection = await f.invoke('open', f.first, document);
  expect(connection.uri).toMatch(/notes.ipynb$/);
  expect(connection.cells.one).toMatch(/^vscode-notebook-cell:.*notes.ipynb#one\.[a-f0-9-]{36}$/);
  expect(mocks.servers[0].notify).toHaveBeenCalledWith('notebookDocument/didOpen', expect.objectContaining({
    cellTextDocuments: expect.arrayContaining([expect.objectContaining({ uri: connection.cells.one, languageId: 'python', text: document.cells[0].text })]),
  }));
  await expect(f.invoke('open', f.first, { ...document, id: 'bad', path: '/not-owned.ipynb' })).rejects.toThrow(/open notebook/);
  await expect(f.invoke('open', f.first, { ...document, id: 'bad', path: f.document('python').path })).rejects.toThrow(/Invalid/);
  await expect(f.invoke('request', f.first, document.id, 1, 'rename', 'textDocument/rename', { cell: 'one' })).rejects.toThrow(/Invalid/);
  await expect(f.invoke('request', f.first, document.id, 1, 'command', 'workspace/executeCommand', {})).rejects.toThrow(/Invalid/);
  await expect(f.invoke('request', f.first, document.id, 1, 'hover', 'textDocument/hover', { cell: 'one', position: { line: 0, character: 1 } })).resolves.toBeNull();
  const next = await f.invoke('notebook-change', f.first, document.id, 2, [{ id: 'two', version: 1, text: 'values' }, ...document.cells]);
  expect(next.one).toMatch(/#one\.[a-f0-9-]{36}$/);
  expect(next.one).not.toBe(connection.cells.one);
  vi.mocked(f.first.sender.send).mockClear();
  mocks.servers[0].diagnostics({ uri: connection.cells.one, version: 2, diagnostics: [] });
  mocks.servers[0].diagnostics({ uri: next.one, version: 1, diagnostics: [] });
  expect(f.first.sender.send).not.toHaveBeenCalled();
  mocks.servers[0].diagnostics({ uri: next.one, version: 2, diagnostics: [] });
  expect(f.first.sender.send).toHaveBeenCalledWith('language:event', expect.objectContaining({ type: 'diagnostics', version: 2, cell: 'one', cellVersion: 1 }));
  expect(mocks.servers[0].notify).toHaveBeenCalledWith('notebookDocument/didClose', expect.anything());
  await expect(f.invoke('notebook-change', f.first, document.id, 1, document.cells)).rejects.toThrow(/Stale/);
  f.send('close', f.first, document.id);
});

test('quit is not delayed when there are no language processes to drain', () => {
  fixture(); const event = { preventDefault: vi.fn() };
  mocks.app.get('will-quit')!(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
});

test('notebook resolve restores opaque data and rejects another cell, stale revisions and forged handles', async () => {
  const f = fixture(), document = { ...f.document('notebook', 'notes.ipynb'), notebook: 'python', text: '', cells: [
    { id: 'one', version: 1, text: 'value' }, { id: 'two', version: 1, text: 'other' },
  ] };
  await f.invoke('open', f.first, document);
  const server = mocks.servers[0], item = { label: 'value', data: { private: 42 } };
  server.request.mockResolvedValueOnce([item]);
  const [result] = await f.invoke('request', f.first, document.id, 1, 'completion', 'textDocument/completion', { cell: 'one', position: { line: 0, character: 1 } });
  server.request.mockResolvedValueOnce({ ...item, detail: 'resolved' });
  await f.invoke('request', f.first, document.id, 1, 'resolve', 'completionItem/resolve', { ...result, cell: 'one', data: 'injected' });
  expect(server.request).toHaveBeenLastCalledWith('completionItem/resolve', item, expect.anything());
  for (const value of [{ ...result, cell: 'two' }, { label: 'forged', cell: 'one' }])
    await expect(f.invoke('request', f.first, document.id, 1, 'invalid', 'completionItem/resolve', value)).rejects.toThrow(/Invalid/);
  await f.invoke('notebook-change', f.first, document.id, 2, [{ ...document.cells[0], version: 2, text: 'changed' }, document.cells[1]]);
  await expect(f.invoke('request', f.first, document.id, 2, 'stale', 'completionItem/resolve', { ...result, cell: 'one' })).rejects.toThrow(/Invalid/);
  f.send('close', f.first, document.id);
});

test('server cancellation code and data survive the main IPC handler', async () => {
  const f = fixture(), document = f.document('ordinary');
  await f.invoke('open', f.first, document);
  mocks.servers[0].request.mockRejectedValueOnce(Object.assign(Error('reschedule'), { code: -32802, data: { retriggerRequest: true } }));
  expect(await f.invoke('request', f.first, document.id, 1, 'tokens', 'textDocument/semanticTokens/full', {}))
    .toEqual({ $setdownError: { code: -32802, message: 'reschedule', data: { retriggerRequest: true } } });
  f.send('close', f.first, document.id);
});

test('current-document restart retires only its provider session, not another language or window', async () => {
  const f = fixture();
  await f.invoke('open', f.first, f.document('python'));
  await f.invoke('open', f.first, f.document('cpp', 'main.cpp'));
  await f.invoke('open', f.second, f.document('other-window'));
  const [python, cpp, other] = mocks.servers;
  await f.invoke('restart', f.first, f.document('python').path, 'pyright');
  expect(python.stop).toHaveBeenCalledOnce(); expect(cpp.stop).not.toHaveBeenCalled(); expect(other.stop).not.toHaveBeenCalled();
  expect(f.first.sender.send).toHaveBeenCalledWith('language:event', { type: 'configuration', servers: ['pyright'], documents: [{ id: 'python', generation: 'generation-python' }] });
  await f.invoke('open', f.first, { ...f.document('python'), text: 'latest unsaved text', version: 9, generation: 'reconnected' });
  expect(mocks.servers.at(-1)!.notify).toHaveBeenCalledWith('textDocument/didOpen', expect.objectContaining({ textDocument: expect.objectContaining({ text: 'latest unsaved text', version: 9 }) }));
});

test('project environment actions reject foreign documents and forged candidates without launching services', async () => {
  const f = fixture(), file = f.document('python').path;
  await expect(f.invoke('environment', f.first, path.resolve('not-open.py'), 'python')).rejects.toThrow(/not open/);
  await expect(f.invoke('catalog', f.first, path.resolve('not-open.py'))).rejects.toThrow(/not open/);
  await expect(f.invoke('select-environment', f.first, file, 'python', { kind: 'server', value: 'off', root: '/a-different-project' })).rejects.toThrow(/project changed/);
  await expect(f.invoke('select-environment', f.first, file, 'python', { kind: 'python', value: '/arbitrary/program' })).rejects.toThrow(/no longer available/);
  await expect(f.invoke('select-environment', f.first, file, 'python', { kind: 'compilation', value: 'automatic' })).rejects.toThrow(/does not apply/);
  expect(() => f.invoke('answer-message', f.first, file, 'pyright', 'forged', 0)).toThrow(/no longer connected/);
  expect(mocks.servers).toHaveLength(0);
});

test('project Basic editing does not change the global catalog Enable/Disable controls', async () => {
  const f = fixture(), file = f.document('python').path;
  const result = await f.invoke('select-environment', f.first, file, 'python', { kind: 'server', value: 'off' });
  expect(result.servers.every((server: { enabled: boolean }) => !server.enabled)).toBe(true);
  const catalog = await f.invoke('catalog', f.first);
  expect(catalog.entries.find((entry: { id: string }) => entry.id === 'pyright').enabled).toBe(true);
  expect(await f.invoke('open', f.first, f.document('python'))).toEqual({ unavailable: 'missing' });
});

test('the tool catalog has global defaults even with a folder open; document inspection requests its own project options', async () => {
  const root = path.join(mocks.directory, 'project');
  await mkdir(path.join(root, '.git'), { recursive: true });
  await writeFile(path.join(root, 'pyproject.toml'), '[project]\nname = "fixture"\nversion = "0.0.0"\n');
  const f = fixture(undefined, root), file = f.document('python').path;
  await writeFile(file, 'value = 1\n');
  await f.invoke('configure', f.first, 'pyright', { scope: root, args: [], settings: { python: { pythonPath: '/project-only/python' } }, initializationOptions: {} });
  const global = (await f.invoke('catalog', f.first)).entries.find((entry: { id: string }) => entry.id === 'pyright');
  expect(global.projectRoot).toBeUndefined(); expect(global.options.scope).toBeUndefined();
  expect(global.options.settings.python?.pythonPath).not.toBe('/project-only/python');
  const inspected = (await f.invoke('catalog', f.first, file)).entries.find((entry: { id: string }) => entry.id === 'pyright');
  expect(inspected.projectRoot).toBe(root); expect(inspected.options.scope).toBe(root);
  expect(inspected.options.settings.python.pythonPath).toBe('/project-only/python');
});

test('notebooks share analysis by root and environment, while reopen retires old cell epochs', async () => {
  const f = fixture();
  const doc = (id: string, name: string, python = '/usr/bin/python3') => ({ ...f.document(id, name), python, notebook: 'python', text: '', cells: [{ id: 'cell', version: 1, text: 'value = 1' }] });
  const a = doc('a', 'notes.ipynb'), b = doc('b', 'other.ipynb');
  const first = await f.invoke('open', f.first, a), second = await f.invoke('open', f.first, b);
  expect(mocks.servers).toHaveLength(1);
  f.first.sender.send.mockClear();
  mocks.servers[0].diagnostics({ uri: second.cells.cell, version: 1, diagnostics: [] });
  expect(f.first.sender.send).toHaveBeenCalledWith('language:event', expect.objectContaining({ id: 'b', cell: 'cell' }));
  f.send('close', f.first, 'a'); await Promise.resolve();
  const reopened = await f.invoke('open', f.first, a);
  expect(mocks.servers).toHaveLength(1); expect(reopened.cells.cell).not.toBe(first.cells.cell);
  f.first.sender.send.mockClear();
  mocks.servers[0].diagnostics({ uri: first.cells.cell, version: 1, diagnostics: [] });
  expect(f.first.sender.send).not.toHaveBeenCalled();
  await f.invoke('open', f.first, doc('different', 'notes.ipynb', '/different/python'));
  expect(mocks.servers).toHaveLength(2);
  f.first.sender.emit('destroyed'); await vi.waitFor(() => expect(mocks.servers.every(server => server.stop.mock.calls.length === 1)).toBe(true));
});

test('notebook crash recovery reconnects at most three times and never replays user commands', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(), doc = { ...f.document('notebook', 'notes.ipynb'), notebook: 'python', text: '', cells: [{ id: 'cell', version: 1, text: 'value = 1' }] };
    await f.invoke('open', f.first, doc);
    for (const delay of [1000, 3000, 5000]) {
      const server = mocks.servers.at(-1)!; f.first.sender.send.mockClear(); server.failed('crashed');
      await vi.advanceTimersByTimeAsync(delay);
      expect(f.first.sender.send).toHaveBeenCalledWith('language:event', expect.objectContaining({ type: 'configuration', servers: ['notebook-python'] }));
      expect(server.request).not.toHaveBeenCalled();
      await f.invoke('open', f.first, { ...doc, generation: crypto.randomUUID() });
    }
    f.first.sender.send.mockClear(); mocks.servers.at(-1)!.failed('crashed again'); await vi.advanceTimersByTimeAsync(5000);
    expect(f.first.sender.send.mock.calls.some(([, event]) => event.type === 'configuration')).toBe(false);
    expect(f.first.sender.send).toHaveBeenCalledWith('language:event', expect.objectContaining({ recovery: { retrying: false, attempt: undefined } }));
    f.first.sender.emit('destroyed'); await Promise.resolve();
  } finally { vi.useRealTimers(); }
});

test('closing during a structural notebook change cannot reopen a retired document in the shared server', async () => {
  const f = fixture(), doc = { ...f.document('notebook', 'notes.ipynb'), notebook: 'python', text: '', cells: [{ id: 'cell', version: 1, text: 'value = 1' }] };
  await f.invoke('open', f.first, doc);
  const server = mocks.servers[0]; let finish!: () => void;
  server.notify.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const change = f.invoke('notebook-change', f.first, doc.id, 2, [...doc.cells, { id: 'new', version: 1, text: 'value' }]);
  const rejected = expect(change).rejects.toThrow(/closed during/);
  await vi.waitFor(() => expect(finish).toBeDefined());
  f.send('close', f.first, doc.id); finish(); await rejected;
  expect(server.notify.mock.calls.filter(call => call[0] === 'notebookDocument/didOpen')).toHaveLength(1);
  await f.invoke('open', f.first, { ...doc, generation: 'new-owner' });
  expect(mocks.servers).toHaveLength(1);
});

test('Zed YAML customTags reach automatic preparation and the live session and are reapplied after a settings save', async () => {
  const root = path.join(mocks.directory, 'project'); await mkdir(path.join(root, '.zed'), { recursive: true });
  const file = path.join(root, '.zed/settings.json');
  const save = (tags: string[]) => writeFile(file, JSON.stringify({ lsp: { 'yaml-language-server': { settings: { yaml: { customTags: tags } } } } }));
  await save(['!Sub scalar', '!Sub sequence']);
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const prepare = vi.fn<AutomaticLanguagePackages['prepare']>(async () => ({ executable: process.execPath, args: [], settings: {}, initializationOptions: {} }));
  const f = fixture(discovery, root, { ...noPackages, rank: definition => definition.id === 'yaml-language-server' ? 0 : 1, canPrepare: () => true, prepare });
  try {
    await f.invoke('open', f.first, f.document('yaml', 'template.yaml'));
    expect(prepare.mock.calls[0][0].id).toBe('yaml-language-server');
    expect(prepare.mock.calls[0][4]).toMatchObject({ settings: { yaml: { customTags: ['!Sub scalar', '!Sub sequence'] } } });
    expect(mocks.servers[0].profile.configuration).toMatchObject({ yaml: { customTags: ['!Sub scalar', '!Sub sequence'] } });
    await save(['!Ref scalar']);
    await vi.waitFor(() => expect(mocks.servers[0].stop).toHaveBeenCalledOnce(), { timeout: 4000 });
    await f.invoke('open', f.first, { ...f.document('yaml', 'template.yaml'), version: 3, text: 'name: !Ref preserved' });
    expect(mocks.servers[1].profile.configuration).toMatchObject({ yaml: { customTags: ['!Ref scalar'] } });
    expect(mocks.servers[1].notify).toHaveBeenCalledWith('textDocument/didOpen', expect.objectContaining({ textDocument: expect.objectContaining({ version: 3, text: 'name: !Ref preserved' }) }));
  } finally { mocks.app.get('will-quit')?.({ preventDefault() {} }); discovery.dispose(); }
});
