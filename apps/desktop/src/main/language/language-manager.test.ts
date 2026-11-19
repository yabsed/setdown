import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WindowState } from '../windows/window-state';
import { LanguageManager, type AutomaticLanguagePackages } from './language-manager';
import { AutomaticDownloadsDisabled } from './language-provisioner';
import { ServerDiscovery } from './server-discovery';
import { ServerEnvironment } from './server-environment';

const mocks = vi.hoisted(() => ({ directory: '', handles: new Map<string, (...args: any[]) => any>(),
  events: new Map<string, (...args: any[]) => void>(), app: new Map<string, (...args: any[]) => void>(),
  answer: undefined as ((method: string, params: unknown) => unknown) | undefined,
  servers: [] as { notify: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; root: string; profile: any; hooks: any; context: Map<string, string>; failed: (message: string) => void; diagnostics: (params: any) => void }[] }));
vi.mock('electron', () => ({ app: { getPath: () => mocks.directory, on: (key: string, fn: (...args: any[]) => void) => mocks.app.set(key, fn), quit: vi.fn() },
  ipcMain: { handle: (key: string, fn: (...args: any[]) => any) => mocks.handles.set(key, fn),
    on: (key: string, fn: (...args: any[]) => void) => mocks.events.set(key, fn) } }));
vi.mock('../notebook/python-environments', () => ({ notebookPython: { searchPaths: async () => ({ paths: [] }), list: async () => ({ candidates: [], selected: '/usr/bin/python3' }), resolve: async (_file: string, python?: string) => ({ python: python ?? '/usr/bin/python3', env: {} }) } }));
vi.mock('./server-session', () => ({ ServerSession: class {
  readonly ready = Promise.resolve({ notebookDocumentSync: { notebookSelector: [{ notebook: 'jupyter-notebook' }] }, textDocumentSync: { openClose: true, change: 2, save: { includeText: true } } });
  readonly capabilities = { forDocument: () => ({ textDocumentSync: { openClose: true, change: 2, save: { includeText: true } } }) };
  readonly notify = vi.fn(async (_method: string, _params: unknown) => {});
  readonly stop = vi.fn(async () => {});
  readonly request = vi.fn(async (method: string, params: unknown) => mocks.answer?.(method, params) ?? null);
  readonly watch = vi.fn();
  readonly context = new Map<string, string>();
  constructor(readonly launch: unknown, readonly root: string, readonly diagnostics: (params: any) => void, readonly failed: (message: string) => void, readonly profile: any, readonly hooks: any) { mocks.servers.push(this); }
} }));
beforeEach(async () => { mocks.directory = await mkdtemp(path.join(os.tmpdir(), 'setdown-manager-test-'));  mocks.handles.clear(); mocks.events.clear(); mocks.app.clear(); mocks.servers.length = 0; mocks.answer = undefined; });

afterEach(async () => { await rm(mocks.directory, { recursive: true, force: true }); });

const noPackages: AutomaticLanguagePackages = {rank:()=>0,canPrepare:()=>false,prepare:async()=>{throw Error('No package in this discovery fixture');},highlight:async()=>[],dispose() {}};
function fixture(discovery?: ServerDiscovery, root = path.resolve('language-fixture'), packages = noPackages) {
  const states = new Map<number, WindowState>();
  const event = (id: number) => {
    const contents = Object.assign(new EventEmitter(), { id, mainFrame: {}, isDestroyed: () => false, send: vi.fn() });
    states.set(id, { webContentsId: id, projectRoot: root, currentDocument: { path: path.join(root, 'main.py') },
      rendererTabs: ['Makefile', 'other.py', 'template.yaml', 'main.cpp', 'helper.h', 'other.c', 'hello.f90', 'other.f90', 'main.ts', 'other.ts', 'main.json', 'other.json', 'Dockerfile', 'notes.ipynb', 'other.ipynb', 'index.html', 'App.svelte', 'Main.kt'].map(name => ({ path: path.join(root, name), isUntitled: false })),
      window: { webContents: contents, isDestroyed: () => false } } as unknown as WindowState);
    return { sender: contents, senderFrame: contents.mainFrame };
  };
  const first = event(1), second = event(2);
  new LanguageManager(id => states.get(id) ?? null, discovery, packages).install();
  const document = (id: string, name = 'main.py') => ({ id, generation: `generation-${id}`, path: path.join(root, name), text: id, version: 1 });
  return { first, second, document, invoke: (key: string, ...args: unknown[]) => mocks.handles.get(`language:${key}`)!(...args),
    send: (key: string, ...args: unknown[]) => mocks.events.get(`language:${key}`)!(...args) };
}
test('Make has editing support without borrowing a disabled companion environment', async () => {
  const f = fixture(), context = await f.invoke('environment', f.first, f.document('make', 'Makefile').path, 'make');
  expect(context.kind).toBeUndefined(); expect(context.choices).toEqual([]);
  expect(context.analysisSelection).toEqual({ mode: 'automatic', source: 'default' });
  expect(context.servers.every((server: any) => server.role === 'supplementary' && !server.enabled)).toBe(true);
  expect(mocks.servers).toHaveLength(0);
});
test('opening app settings performs no executable discovery or automatic preparation', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const find = vi.spyOn(discovery, 'find'), prepare = vi.fn(noPackages.prepare), f = fixture(discovery, undefined, { ...noPackages, prepare });
  const settings = await f.invoke('catalog', f.first);
  expect(settings.languages.find((language: any) => language.id === 'make').servers).toEqual([]);
  // TSX and JSX are edited as TypeScript and JavaScript; the language is listed under its own name.
  expect(settings.languages.filter((language: any) => ['typescript', 'javascript'].includes(language.id)).map((language: any) => language.name).sort()).toEqual(['JavaScript', 'TypeScript']);
  expect(settings.automaticInstall).toBe(true); expect(find).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  expect(mocks.servers).toHaveLength(0); discovery.dispose();
});

test('Zed resolves a server before global executable candidates, receives the project environment, and downloads only a supported or requested tool', async () => {
  const root = path.join(mocks.directory, 'zed-project'); await mkdir(path.join(root, '.git'), { recursive: true }); await writeFile(path.join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '/global/broken-shims', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const find = vi.spyOn(discovery, 'find');
  const prepare = vi.fn(async () => ({ executable: '/zed/managed/fortls', args: ['--stdio'], settings: {}, initializationOptions: {} }));
  const projectEnvironment = vi.fn(async () => ({ PATH: '/project/toolchain' }));
  const f = fixture(discovery, root, { ...noPackages, usesZed: async () => true, projectEnvironment, prepare });
  await f.invoke('open', f.first, f.document('fortran', 'hello.f90'));
  expect(find).not.toHaveBeenCalled();
  expect(projectEnvironment).toHaveBeenCalledWith(root, expect.objectContaining({ PATH: '/global/broken-shims' }));
  // Fortran is outside the supported languages: its tool is used where it already exists, and not downloaded unasked.
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ id: 'fortls' }), 'fortran', root,
    { PATH: '/project/toolchain' }, expect.objectContaining({ automaticInstall: false }), expect.any(Function));
  expect(mocks.servers[0]).toMatchObject({ launch: { executable: '/zed/managed/fortls', env: { PATH: '/project/toolchain' } } });
  await f.invoke('open', f.first, f.document('cpp', 'main.cpp'));
  expect(prepare).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'clangd' }), 'cpp', root,
    { PATH: '/project/toolchain' }, expect.objectContaining({ automaticInstall: true }), expect.any(Function));
  discovery.dispose();
});

test('a tool outside the supported languages asks once; a stand-in for a supported language that was turned off is not offered', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const prepare = vi.fn(async (_definition: unknown, _language: string, _root: string, _env: unknown, options: { automaticInstall?: boolean }) => {
    if (!options.automaticInstall) throw new AutomaticDownloadsDisabled('Automatic downloads are off.');
    return { executable: '/managed/tool', args: [], settings: {}, initializationOptions: {} };
  });
  const f = fixture(discovery, undefined, { ...noPackages, usesZed: async () => true, canPrepare: () => true, prepare });
  expect(await f.invoke('open', f.first, f.document('fortran', 'hello.f90'))).toMatchObject({ unavailable: 'missing', issue: { kind: 'downloads-off', optional: true }, server: { id: 'fortls' } });
  await f.invoke('set-enabled', f.first, 'json-lsp', false);
  // Other extensions list JSON as well. None of them is offered as "JSON support".
  const standIn = await f.invoke('open', f.first, f.document('json', 'main.json'));
  expect(standIn.unavailable).toBe('missing'); expect(standIn.issue).toBeUndefined(); expect(standIn.server.id).not.toBe('json-lsp');
  // Saying yes to the question is the whole installation.
  await f.invoke('allow-download', f.first, 'fortls');
  expect((await f.invoke('open', f.first, f.document('fortran', 'hello.f90'))).server).toBe('fortls');
  expect(mocks.servers).toHaveLength(1); discovery.dispose();
});

test('a tool that waits to be asked for still runs from a program already on this computer', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  vi.spyOn(discovery, 'find').mockImplementation(async command => {
    const selected = command === 'fortls' ? { id: 'fortls-bin', path: process.execPath, source: 'path' as const } : undefined;
    return { selected, candidates: selected ? [selected] : [], environment: { env: {}, source: 'inherited' }, searched: [] };
  });
  // The extension that prepares fortls is not loaded without leave to download.
  const prepare = vi.fn(async () => { throw new AutomaticDownloadsDisabled('Automatic downloads are off.'); });
  const f = fixture(discovery, undefined, { ...noPackages, usesZed: async () => true, canPrepare: () => true, prepare });
  expect((await f.invoke('open', f.first, f.document('fortran', 'hello.f90'))).server).toBe('fortls');
  expect(mocks.servers[0]).toMatchObject({ launch: { executable: process.execPath } });
  discovery.dispose();
});

test('an old managed installation cannot hide a missing explicitly selected executable', async () => {
  const executable = path.join(mocks.directory, 'missing-gopls');
  await writeFile(path.join(mocks.directory, 'language-servers.json'), JSON.stringify({ version: 1, servers: { gopls: { executable } }, custom: [], preferred: {} }));
  const installation = vi.fn(async () => ({ state: 'ready' as const, source: 'managed' as const, executable: '/previous/managed-gopls' }));
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const f = fixture(discovery, undefined, { ...noPackages, canPrepare: () => true, installation });
  const catalog = await f.invoke('catalog', f.first);
  const gopls = catalog.entries.find((entry: any) => entry.id === 'gopls');
  expect(gopls.executable).toBe(executable); expect(gopls.available).toBe(false); expect(gopls.preparation).toBeUndefined();
  expect(installation).not.toHaveBeenCalledWith('gopls'); discovery.dispose();
});
test('changing an app default preserves a project-pinned live session and download changes preserve all live sessions', async () => {
  const f = fixture();
  await f.invoke('select-environment', f.first, f.document('one').path, 'python', { kind: 'server', value: 'pyright' });
  await f.invoke('open', f.first, f.document('one'));
  await f.invoke('set-default', f.first, 'python', 'basedpyright');
  expect(mocks.servers[0].stop).not.toHaveBeenCalled();
  const configuration = f.first.sender.send.mock.calls.filter(call => call[1].type === 'configuration').at(-1)![1];
  expect(configuration.retainedDocuments).toContainEqual({ id: 'one', generation: 'generation-one' });
  await f.invoke('set-automatic-install', f.first, false);
  expect(mocks.servers[0].stop).not.toHaveBeenCalled();
});
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


test('an ordinary Python file starts with the project\'s environment that Zed\'s search finds; a failed search starts with the one Setdown finds', async () => {
  const root = path.join(mocks.directory, 'poetry-project'), poetry = path.join(mocks.directory, 'pypoetry/virtualenvs/app-x-py3.12/bin/python');
  await mkdir(path.join(root, '.git'), { recursive: true }); await mkdir(path.dirname(poetry), { recursive: true }); await writeFile(poetry, '');
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '/global/bin', PYENV_ROOT: '/pyenv', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const pythonEnvironments = vi.fn(async () => [{ path: poetry, name: 'Python 3.12.3 (app-x-py3.12; Poetry)', kind: 'Poetry', project: root }]);
  const f = fixture(discovery, root, { ...noPackages, pythonEnvironments });
  await f.invoke('open', f.first, f.document('python'));
  expect(pythonEnvironments).toHaveBeenCalledWith(root, expect.objectContaining({ PATH: '/global/bin', PYENV_ROOT: '/pyenv' }));
  expect(mocks.servers[0].profile.configuration).toMatchObject({ python: { pythonPath: poetry } });
  const environment = await f.invoke('environment', f.first, f.document('python').path, 'python');
  expect(environment.choices.find((choice: { id: string }) => choice.id === environment.selected)).toMatchObject({ path: poetry, name: 'Python 3.12.3 (app-x-py3.12; Poetry)' });
  expect(environment.issues).toEqual([]);
  discovery.dispose();
  mocks.servers.length = 0;
  const failing = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '/global/bin', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const g = fixture(failing, root, { ...noPackages, pythonEnvironments: async () => { throw Error('Zed lists no environments for Python'); } });
  await g.invoke('open', g.first, g.document('python'));
  expect(mocks.servers[0].profile.configuration).toMatchObject({ python: { pythonPath: '/usr/bin/python3' } });
  expect(warn).toHaveBeenCalledWith('Could not list Python environments', expect.any(Error));
  warn.mockRestore(); failing.dispose();
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
  for (const event of [f.first, f.second]) expect(event.sender.send).toHaveBeenCalledWith('language:event', { type: 'configuration', servers: expect.arrayContaining(['pyright']), retainedDocuments: [] });
  expect((await f.invoke('configuration', f.second)).find((r: { server: string }) => r.server === 'pyright')).toMatchObject({ enabled: false });
  expect(await f.invoke('open', f.first, f.document('one'))).toMatchObject({ unavailable: 'missing', issue: { kind: 'no-installer' } });
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
  // Nothing was looked up on this computer, so whether the program exists is not claimed.
  expect(catalog.entries.find((entry: { id: string }) => entry.id === 'gopls').available).toBeUndefined();
  expect(catalog.entries.every((entry: { configured: boolean }) => entry.configured)).toBe(true);
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
  expect(await f.invoke('open', f.first, f.document('fortran', 'hello.f90'))).toMatchObject({ unavailable: 'missing', issue: { kind: 'no-installer' }, server: { id: 'fortls' } });
  await f.invoke('rescan', f.first);
  expect(mocks.servers).toHaveLength(2); expect(mocks.servers.every(s => !s.stop.mock.calls.length)).toBe(true);
  await f.invoke('configure', f.first, 'fortls', { args: ['--disable_autoupdate'], settings: {}, initializationOptions: {} });
  expect(mocks.servers.every(s => !s.stop.mock.calls.length)).toBe(true);
  expect(f.first.sender.send).toHaveBeenCalledWith('language:event', { type: 'configuration', servers: ['fortls'], retainedDocuments: [{ id: 'python', generation: 'generation-python' }, { id: 'other-python', generation: 'generation-other-python' }] });
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

test('competing installed profiles start the tool the language ranks first, keep an explicit choice, and never fall through a missing chosen server', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const installed = new Set(['vtsls', 'deno']);
  vi.spyOn(discovery, 'find').mockImplementation(async command => {
    const selected = installed.has(command) ? { id: command, path: process.execPath, source: 'path' as const } : undefined;
    return { selected, candidates: selected ? [selected] : [], environment: { env: {}, source: 'inherited' }, searched: [] };
  });
  const f = fixture(discovery, undefined, { ...noPackages, rank: definition => definition.id === 'deno' ? 0 : 1 });
  await f.invoke('set-enabled', f.first, 'typescript-language-server', false);
  // No question is asked: the person may not know either tool by name.
  expect((await f.invoke('open', f.first, f.document('one', 'main.ts'))).server).toBe('deno');
  await f.invoke('restart', f.first);
  await f.invoke('set-enabled', f.first, 'vtsls', true);
  expect((await f.invoke('open', f.first, f.document('one', 'main.ts'))).server).toBe('vtsls');
  await f.invoke('restart', f.first); installed.delete('vtsls');
  f.first.sender.send.mockClear();
  await expect(f.invoke('open', f.first, f.document('one', 'main.ts'))).rejects.toThrow(/Program not found/);
  expect(f.first.sender.send).toHaveBeenCalledWith('language:event', expect.objectContaining({ type: 'status', state: 'failed', issue: { kind: 'no-installer', help: expect.any(Boolean) }, server: expect.objectContaining({ id: 'vtsls' }) }));
  expect(mocks.servers).toHaveLength(2); discovery.dispose();
});

test('the catalog lists only tools that can run and looks up a program for the one tool a person opened', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const find = vi.spyOn(discovery, 'find').mockImplementation(async command => {
    const selected = command === 'gopls' ? { id: 'gopls-bin', path: process.execPath, source: 'path' as const } : undefined;
    return { selected, candidates: selected ? [selected] : [], environment: { env: {}, source: 'inherited' }, searched: [] };
  });
  const f = fixture(discovery);
  const catalog = await f.invoke('catalog', f.first);
  // Aiken is in an imported catalog but has no connection profile: it cannot run, so it is not offered.
  expect(catalog.entries.some((e: { id: string }) => e.id === 'aiken')).toBe(false);
  expect(find).not.toHaveBeenCalled();
  const inspected = await f.invoke('catalog', f.first, undefined, 'gopls');
  expect(inspected.entries.find((e: { id: string }) => e.id === 'gopls')).toMatchObject({ available: true, executable: process.execPath, chosen: false });
  expect(find.mock.calls.map(([command]) => command)).toEqual(['gopls']);
  await expect(f.invoke('catalog', f.first, undefined, 7)).rejects.toThrow(/Invalid tool/);
  expect(mocks.servers).toHaveLength(0); discovery.dispose();
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
  await mkdir(path.join(root, '.git'), { recursive: true }); await writeFile(path.join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
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

test('the name a Zed extension gives its server is never looked up as a program', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  // `java` on PATH is the JVM. Offering it as the "java" language server makes the tool exit at once.
  const find = vi.spyOn(discovery, 'find').mockImplementation(async command => {
    const selected = { id: command, path: process.execPath, source: 'path' as const };
    return { selected, candidates: [selected], environment: { env: {}, source: 'inherited' }, searched: ['/usr/bin'] };
  });
  const f = fixture(discovery);
  const java = (await f.invoke('catalog', f.first, undefined, 'zed.java-eclipse-jdtls.java')).entries.find((entry: any) => entry.id === 'zed.java-eclipse-jdtls.java');
  expect(java).toMatchObject({ available: false, chosen: false });
  expect(find.mock.calls.map(([command]) => command)).not.toContain('java');
  discovery.dispose();
});

test('a tool that ends is reported with its cause, and a cause that repeats is not retried', async () => {
  await writeFile(path.join(mocks.directory, 'language-servers.json'), JSON.stringify({ version: 1, servers: { clangd: { executable: process.execPath, automaticExecutable: false } }, custom: [], preferred: {} }));
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  vi.spyOn(discovery, 'find').mockImplementation(async command => {
    const selected = path.isAbsolute(command) ? { id: command, path: command, source: 'explicit' as const } : undefined;
    return { selected, candidates: selected ? [selected] : [], environment: { env: {}, source: 'inherited' }, searched: [] };
  });
  const f = fixture(discovery);
  const failed = (issue: object, recovery: object) => expect.objectContaining({ type: 'status', state: 'failed', issue, recovery: expect.objectContaining(recovery) });
  await f.invoke('open', f.first, f.document('cpp', 'main.cpp'));
  const chosen = mocks.servers.at(-1)! as any;
  expect(chosen.launch.executable).toBe(process.execPath);
  // It printed its usage and ended before answering: the program the person chose is not a language tool.
  chosen.failureFacts = async () => ({ started: false, reason: 'clangd language server exited (1).', stderr: 'Usage: node [options]' });
  f.first.sender.send.mockClear(); chosen.failed('initialization: exited');
  await vi.waitFor(() => expect(f.first.sender.send).toHaveBeenCalledWith('language:event', failed({ kind: 'executable', path: process.execPath, automatic: true }, { retrying: false })));
  expect((await f.invoke('catalog', f.first)).entries.find((entry: any) => entry.id === 'clangd').sessions[0]).toMatchObject({ state: 'failed', issue: { kind: 'executable' } });
  // A tool that worked and then stopped is a different cause: it is reconnected.
  await f.invoke('open', f.first, f.document('python'));
  const worked = mocks.servers.at(-1)! as any;
  worked.failureFacts = async () => ({ started: true, reason: 'Pyright language server exited (SIGSEGV).', stderr: '' });
  f.first.sender.send.mockClear(); worked.failed('running: exited');
  await vi.waitFor(() => expect(f.first.sender.send).toHaveBeenCalledWith('language:event', failed({ kind: 'crashed' }, { retrying: true, attempt: 1 })));
  await f.invoke('restart', f.first); discovery.dispose();
});

test('a tool that cannot be prepared says why before the connection is refused', async () => {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const prepare = vi.fn(async () => { throw Error('error sending request: network is unreachable'); });
  const f = fixture(discovery, undefined, { ...noPackages, canPrepare: () => true, prepare });
  await expect(f.invoke('open', f.first, f.document('fortran', 'hello.f90'))).rejects.toThrow(/network is unreachable/);
  expect(f.first.sender.send).toHaveBeenCalledWith('language:event', expect.objectContaining({ type: 'status', state: 'failed',
    issue: { kind: 'download-failed', detail: 'error sending request: network is unreachable' }, server: expect.objectContaining({ id: 'fortls' }),
    documents: [{ id: 'fortran', generation: 'generation-fortran' }] }));
  expect(mocks.servers).toHaveLength(0); discovery.dispose();
});

/** Every tool a test names is installed as a program of that name. */
function installed(...commands: string[]) {
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  vi.spyOn(discovery, 'find').mockImplementation(async command => {
    const selected = commands.includes(command) ? { id: command, path: process.execPath, source: 'path' as const } : undefined;
    return { selected, candidates: selected ? [selected] : [], environment: { env: {}, source: 'inherited' }, searched: [] };
  });
  return discovery;
}

test('the HTML tool closes tags and quotes, clangd switches between source and header, and no other tool is asked for either', async () => {
  const discovery = installed('vscode-html-language-server', 'clangd'), f = fixture(discovery);
  const html = await f.invoke('open', f.first, f.document('page', 'index.html'));
  expect(html).toMatchObject({ server: 'html-lsp', autoInsert: { method: 'html/autoInsert', close: true, quote: true } });
  expect(html.companion).toBeUndefined();
  const source = await f.invoke('open', f.first, f.document('source', 'main.cpp'));
  expect(source).toMatchObject({ server: 'clangd', companion: true });
  expect(source.autoInsert).toBeUndefined();
  const [htmlServer, clangd] = mocks.servers;
  mocks.answer = method => method === 'html/autoInsert' ? '$0</p>' : method === 'textDocument/switchSourceHeader' ? 'file:///project/main.h' : null;
  expect(await f.invoke('request', f.first, 'page', 1, 'r1', 'html/autoInsert', { kind: 'autoClose', position: { line: 0, character: 3 } })).toBe('$0</p>');
  expect(htmlServer.request.mock.lastCall!.slice(0, 2)).toEqual(['html/autoInsert', { kind: 'autoClose', position: { line: 0, character: 3 }, textDocument: { uri: html.uri } }]);
  expect(await f.invoke('request', f.first, 'source', 1, 'r2', 'textDocument/switchSourceHeader', {})).toBe('file:///project/main.h');
  // clangd takes the document itself as the parameter.
  expect(clangd.request.mock.lastCall!.slice(0, 2)).toEqual(['textDocument/switchSourceHeader', { uri: source.uri }]);
  await expect(f.invoke('request', f.first, 'page', 1, 'r3', 'textDocument/switchSourceHeader', {})).rejects.toThrow('does not answer');
  await expect(f.invoke('request', f.first, 'source', 1, 'r4', 'html/autoInsert', { kind: 'autoClose', position: { line: 0, character: 3 } })).rejects.toThrow('does not answer');
  await expect(f.invoke('request', f.first, 'page', 1, 'r5', 'html/tag', { position: { line: 0, character: 3 } })).rejects.toThrow('does not answer');
  // A person turns either kind off in the tool's settings, by the names VS Code uses.
  await f.invoke('configure', f.first, 'html-lsp', { settings: { html: { autoClosingTags: false } }, initializationOptions: {} });
  expect((await f.invoke('open', f.first, f.document('page-again', 'index.html'))).autoInsert).toEqual({ method: 'html/autoInsert', close: false, quote: true });
  discovery.dispose();
});

test('the JSON tool asks Setdown for a schema it does not read itself, and the document shows its schemas', async () => {
  const discovery = installed('vscode-json-language-server'), f = fixture(discovery);
  mocks.answer = method => method === 'json/languageStatus' ? { schemas: ['https://json.schemastore.org/package.json'] } : null;
  const opened = await f.invoke('open', f.first, f.document('one', 'main.json'));
  const [server] = mocks.servers;
  expect(server.profile.initializationOptions).toMatchObject({ handledSchemaProtocols: ['file'] });
  // One string is the whole parameter: vscode-jsonrpc sends it as a list of one.
  expect(server.request).toHaveBeenCalledWith('json/languageStatus', opened.uri, undefined, 3000);
  expect(opened.context).toContain('Schema: https://json.schemastore.org/package.json');
  // Refusals need no network: a domain that is not trusted, and downloads the person turned off.
  await expect(server.hooks.schemaContent('https://schemas.example.org/unknown.json')).rejects.toMatchObject({ code: 2, message: 'Location https://schemas.example.org/unknown.json is untrusted' });
  await f.invoke('configure', f.first, 'json-lsp', { settings: { json: { schemaDownload: { enable: false } } }, initializationOptions: {} });
  const again = await f.invoke('open', f.first, f.document('two', 'main.json'));
  expect(again.server).toBe('json-lsp');
  await expect(mocks.servers.at(-1)!.hooks.schemaContent('https://json.schemastore.org/package.json')).rejects.toMatchObject({ code: 4 });
  discovery.dispose();
});

test('the Svelte tool starts trusted with its settings, hears unsaved TypeScript changes, and restarts when its configuration file changes', async () => {
  const discovery = installed('svelteserver', 'vtsls'), f = fixture(discovery);
  await f.invoke('set-enabled', f.first, 'typescript-language-server', false);
  const page = await f.invoke('open', f.first, f.document('page', 'App.svelte'));
  expect(page).toMatchObject({ autoInsert: { method: 'html/tag', close: true, quote: false } });
  const svelte = mocks.servers[0];
  expect(svelte.profile.initializationOptions).toMatchObject({ isTrusted: true, dontFilterIncompleteCompletions: true });
  const script = await f.invoke('open', f.first, f.document('script', 'main.ts'));
  const changes = [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'export const a = 1;' }];
  await f.invoke('change', f.first, 'script', 2, changes);
  expect(svelte.notify).toHaveBeenCalledWith('$/onDidChangeTsOrJsFile', { uri: script.uri, changes });
  // The Svelte file's own changes are the Svelte tool's already.
  svelte.notify.mockClear();
  await f.invoke('change', f.first, 'page', 2, changes);
  expect(svelte.notify).not.toHaveBeenCalledWith('$/onDidChangeTsOrJsFile', expect.anything());
  // extension.ts restarts the server when a file it reads once changes.
  f.first.sender.send.mockClear();
  svelte.hooks.filesChanged([path.join(svelte.root, 'src', 'other.ts')]);
  expect(svelte.stop).not.toHaveBeenCalled();
  svelte.hooks.filesChanged([path.join(svelte.root, 'svelte.config.js')]);
  await vi.waitFor(() => expect(svelte.stop).toHaveBeenCalled());
  discovery.dispose();
});

test("JetBrains' Kotlin server is told the build settings its VS Code extension sends, and nothing malformed", async () => {
  const root = path.join(mocks.directory, 'kotlin-project'); await mkdir(path.join(root, '.git'), { recursive: true }); await writeFile(path.join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
  const discovery = new ServerDiscovery(new ServerEnvironment({ HOME: mocks.directory, PATH: '', SETDOWN_LSP_INHERIT_ENV: '1' }));
  const prepare = vi.fn(async () => ({ executable: '/zed/kotlin-lsp/bin/intellij-server', args: ['--stdio'], settings: {}, initializationOptions: {} }));
  const f = fixture(discovery, root, { ...noPackages, usesZed: async () => true, canPrepare: () => true, projectEnvironment: async () => ({}), prepare });
  await f.invoke('open', f.first, f.document('one', 'Main.kt'));
  // With nothing set, this is what the extension sends; the Zed extension that starts the server sends nothing.
  expect(mocks.servers[0].profile.initializationOptions).toEqual({ buildTools: {}, projects: [] });
  await f.invoke('configure', f.first, 'kotlin-lsp', { settings: { 'intellij.buildTool': 'gradle', 'intellij.jdkForSymbolResolution': '/opt/jdk-21', 'intellij.projects': [{ type: 'maven', path: 'server' }, { path: 'no-type' }] }, initializationOptions: {} });
  await f.invoke('open', f.first, f.document('two', 'Main.kt'));
  const server = mocks.servers.at(-1)!;
  expect(server.profile.initializationOptions).toEqual({ defaultSdk: '/opt/jdk-21', buildTools: { [pathToFileURL(server.root).href]: 'gradle' }, projects: [{ type: 'maven', path: 'server' }] });
  expect(server.context.get('Settings not sent')).toBe('`intellij.projects` entry #1 requires "type" to be specified as a non-empty string');
  discovery.dispose();
});
