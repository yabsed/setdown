import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import bindings from './catalog/zed-profiles.json';
import type { LanguageEvent } from '../../protocol/language';
import type { WindowState } from '../windows/window-state';
import { isSvelteServer } from './extension-rules';
import { SchemaContentError, type JsonSchemaContent } from './json-schema-content';
import { ProjectLanguages } from './project-languages';
import { ServerRegistry } from './server-registry';
import type { HostEvent } from './zed-language-host';

// What Setdown adds to Zed's project engine for single tools, with the host played by a list
// of answers: which settings Zed is given before it starts a tool, and what crosses afterwards.
type Call = { op: string; values: Record<string, unknown> };
const host = vi.hoisted(() => ({ calls: [] as { op: string; values: Record<string, unknown> }[], answers: {} as Record<string, (values: Record<string, unknown>) => unknown>,
  listener: undefined as ((event: { event: string; [key: string]: unknown }) => void) | undefined }));
vi.mock('./zed-language-host', async importOriginal => ({
  ...await importOriginal<typeof import('./zed-language-host')>(),
  ZedLanguageHost: class {
    async request(op: string, values: Record<string, unknown> = {}) { host.calls.push({ op, values }); return host.answers[op]?.(values) ?? {}; }
    onEvent(listener: (event: HostEvent) => void) { host.listener = listener; return () => { host.listener = undefined; }; }
    dispose() {}
  },
}));
const go = vi.hoisted(() => ({ goEnvironment: vi.fn(), findGoTool: vi.fn(), installGoTool: vi.fn() }));
vi.mock('./go-tools', async importOriginal => ({ ...await importOriginal<typeof import('./go-tools')>(), ...go }));
const kotlin = vi.hoisted(() => ({ kotlinServerForRun: vi.fn(), forgetKotlinServer: vi.fn() }));
vi.mock('./kotlin-download', async importOriginal => ({ ...await importOriginal<typeof import('./kotlin-download')>(), ...kotlin }));
vi.mock('./language-package-store', async importOriginal => ({
  ...await importOriginal<typeof import('./language-package-store')>(),
  LanguagePackageStore: class { async ensure() {} },
}));

// What Zed 1.29 reports without any extension; the HTML, Svelte and Kotlin servers come from extensions.
const servers = ['json-language-server', 'gopls', 'clangd', 'typescript-language-server'];
const numbers: Record<string, number> = { gopls: 1, 'json-language-server': 2, 'vscode-html-language-server': 3, clangd: 4, 'svelte-language-server': 5, 'typescript-language-server': 6, 'kotlin-lsp': 7 };
const binding = (id: string) => (bindings.bindings as { id: string; server: string; extension: string }[]).find(found => found.id === id);
const goFound = { executable: '/usr/bin/go', source: 'PATH', GOROOT: '/usr/lib/golang', GOPATH: '/home/person/go', GOBIN: '', GOPROXY: '', GOMODCACHE: '', GOVERSION: 'go1.27.4' };

let root = '', project = '', directory = '', registry: ServerRegistry, languages: ProjectLanguages, events: LanguageEvent[] = [], sequence = 0;
const schemas = { content: vi.fn() };
const state = () => ({ webContentsId: 1, projectRoot: project }) as unknown as WindowState;
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'setdown-project-languages-')));
  project = path.join(root, 'project'); directory = path.join(root, 'packages');
  await mkdir(project); await mkdir(directory);
  // The person's Zed settings file exists, so that watching it reports nothing by itself.
  await mkdir(path.join(root, 'config', 'zed'), { recursive: true }); await writeFile(path.join(root, 'config', 'zed', 'settings.json'), '{}');
  registry = new ServerRegistry(path.join(root, 'registry'));
  events = []; sequence = 0; host.calls.length = 0;
  host.answers = {
    inventory: () => ({ servers, languages: ['JSON', 'Go', 'C', 'C++', 'TypeScript', 'JavaScript'] }),
    'project.open': () => ({ servers: Object.keys(numbers) }),
    'project.servers': () => ({ servers: Object.entries(numbers).map(([name, server]) => ({ server, name, capabilities: {} })) }),
  };
  go.goEnvironment.mockResolvedValue(goFound); go.findGoTool.mockResolvedValue({ path: '/usr/bin/gopls', source: 'PATH' });
  kotlin.kotlinServerForRun.mockResolvedValue({ folder: '/kotlin', version: '1.0', downloaded: false });
  languages = new ProjectLanguages({ directory, executable: '/unused-host', home: root, packaged: false, registry: () => registry,
    catalog: () => ({ binding, package: id => ({ id, version: '1.0.0', url: 'https://packages.invalid/extension', sha256: '0'.repeat(64) }) }),
    emit: (_state, event) => { events.push(event); }, environment: { XDG_CONFIG_HOME: path.join(root, 'config') }, schemas: schemas as unknown as JsonSchemaContent,
    toolEnvironment: () => ({ PATH: '/usr/bin' }) });
});
afterEach(async () => { await languages.dispose(); vi.resetAllMocks(); await rm(root, { recursive: true, force: true }); });

async function open(name: string, toolId: string, languageId: string) {
  const file = path.join(project, name), definition = registry.definition(toolId), id = `document-${++sequence}`;
  await writeFile(file, '');
  const target = { tool: toolId, toolName: definition.name, server: (await languages.target(definition))!, primary: true, languageId };
  const connection = await languages.open(state(), { id, generation: 'g1', path: file, text: '', version: 1 }, file, target, definition);
  return { id, file, uri: pathToFileURL(file).href, connection, server: numbers[target.server] };
}
const called = (op: string) => host.calls.filter(call => call.op === op);
const position = (matches: (call: Call) => boolean) => host.calls.findIndex(matches);
/** Setdown's own layer of Zed's settings, as it was last given to Zed. */
const shipped = () => JSON.parse(String(called('project.settings').at(-1)!.values.defaults)).lsp as Record<string, { binary?: unknown; initialization_options?: Record<string, unknown> }>;

test('a gopls outside PATH is named to Zed before the file is opened, with the Go it needs', async () => {
  go.goEnvironment.mockResolvedValue({ ...goFound, executable: '/usr/local/go/bin/go', source: 'default', GOROOT: '/usr/local/go' });
  go.findGoTool.mockResolvedValue({ path: '/home/person/go/bin/gopls', source: 'GOPATH' });
  const first = await open('main.go', 'gopls', 'go');
  expect(first.connection).toMatchObject({ server: 'gopls' });
  expect(go.findGoTool).toHaveBeenCalledWith('gopls', { PATH: '/usr/bin' }, expect.objectContaining({ GOROOT: '/usr/local/go' }));
  // Zed runs a named program with exactly these arguments, and gopls is found `go` by its folder in front of PATH.
  expect(shipped().gopls.binary).toEqual({ path: '/home/person/go/bin/gopls', arguments: ['-mode=stdio'], env: { PATH: `/usr/local/go/bin${path.delimiter}/usr/bin` } });
  expect(position(call => call.op === 'project.settings' && String(call.values.defaults).includes('/home/person/go/bin/gopls'))).toBeLessThan(position(call => call.op === 'project.open'));
  expect(go.installGoTool).not.toHaveBeenCalled();
  // Found out once for the folder; a restart is how a person says that something changed outside.
  const asked = go.goEnvironment.mock.calls.length, applied = called('project.settings').length;
  await open('other.go', 'gopls', 'go');
  expect([go.goEnvironment.mock.calls.length, called('project.settings').length]).toEqual([asked, applied]);
  go.findGoTool.mockResolvedValue({ path: '/home/person/bin/gopls', source: 'GOBIN' });
  await languages.restart(1, first.file);
  expect((shipped().gopls.binary as { path: string }).path).toBe('/home/person/bin/gopls');
  expect(position(call => call.op === 'project.settings' && String(call.values.defaults).includes('/home/person/bin/gopls'))).toBeLessThan(position(call => call.op === 'project.restart'));
});

test('a gopls and a Go that are on PATH are Zed\'s to find, and a named program is used as it is', async () => {
  await open('main.go', 'gopls', 'go');
  expect(shipped().gopls?.binary).toBeUndefined();
  expect(called('project.settings')).toHaveLength(1);
  const program = path.join(root, 'my-gopls'); await writeFile(program, '#!/bin/sh\n'); await chmod(program, 0o755);
  await registry.chooseExecutable('gopls', program); await languages.configure();
  go.goEnvironment.mockClear();
  await open('second.go', 'gopls', 'go');
  expect(go.goEnvironment).not.toHaveBeenCalled();
  expect(JSON.parse(String(called('project.settings').at(-1)!.values.choices)).lsp.gopls.binary).toMatchObject({ path: program });
});

test('a missing gopls is installed with the Go of this computer, into Setdown\'s own folder', async () => {
  const own = path.join(directory, 'go', 'bin'), installed = path.join(own, 'gopls');
  go.findGoTool.mockResolvedValue(undefined);
  go.goEnvironment.mockImplementation(async (_env, _run, options) => options?.cwd ? { ...goFound, GOVERSION: 'go1.22.3' } : goFound);
  go.installGoTool.mockRejectedValueOnce(Error('gopls was not installed: go install -v golang.org/x/tools/gopls@latest failed. go: golang.org/x/tools/gopls@latest: Get "https://proxy.golang.org/golang.org/x/tools/gopls/@v/list": dial tcp: lookup proxy.golang.org: no such host'));
  // The person reads why; Zed is not asked to start anything.
  await expect(open('main.go', 'gopls', 'go')).rejects.toThrow('no such host');
  expect(called('project.open')).toHaveLength(0);
  expect(events).toContainEqual(expect.objectContaining({ type: 'status', state: 'starting', preparing: true, message: 'Installing gopls…' }));
  expect(events).toContainEqual(expect.objectContaining({ type: 'status', state: 'failed', issue: expect.objectContaining({ kind: 'download-failed' }) }));
  // The next bind tries again.
  languages.close(1, 'document-1');
  go.installGoTool.mockResolvedValue(installed);
  await open('main.go', 'gopls', 'go');
  expect(go.installGoTool).toHaveBeenCalledTimes(2);
  // The Go the project is built with decides the toolchain gopls is built with; nothing lands in the person's Go folders.
  expect(go.installGoTool).toHaveBeenLastCalledWith(expect.objectContaining({ go: goFound, destination: own, projectGoVersion: 'go1.22.3', cwd: project }));
  expect(shipped().gopls.binary).toEqual({ path: installed, arguments: ['-mode=stdio'] });
});

test('nothing is installed over a gopls that Setdown or Zed installed earlier, or when downloads are off', async () => {
  go.findGoTool.mockResolvedValue(undefined);
  await mkdir(path.join(directory, 'servers', 'gopls'), { recursive: true }); await writeFile(path.join(directory, 'servers', 'gopls', 'gopls_0.21.0_go_1.27.4'), '');
  await open('main.go', 'gopls', 'go');
  expect(shipped().gopls?.binary).toBeUndefined();
  await mkdir(path.join(directory, 'go', 'bin'), { recursive: true }); await writeFile(path.join(directory, 'go', 'bin', 'gopls'), '');
  await languages.restart(1, path.join(project, 'main.go'));
  expect(shipped().gopls.binary).toEqual({ path: path.join(directory, 'go', 'bin', 'gopls'), arguments: ['-mode=stdio'] });
  expect(go.installGoTool).not.toHaveBeenCalled();
});

test('downloads that are off install no gopls', async () => {
  registry.setAutomaticInstall(false);
  go.findGoTool.mockResolvedValue(undefined);
  await open('main.go', 'gopls', 'go');
  expect(go.installGoTool).not.toHaveBeenCalled();
  expect(shipped().gopls?.binary).toBeUndefined();
});

test("JetBrains' Kotlin server is verified first and told the person's build settings", async () => {
  registry.configure('kotlin-lsp', { settings: { 'intellij.buildTool': 'gradle', intellij: { jdkForSymbolResolution: '/opt/jdk-21' }, 'intellij.projects': [{ type: 'gradle', path: '.' }, { type: 'ant', path: '.' }] } });
  const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await open('Main.kt', 'kotlin-lsp', 'kotlin');
  expect(kotlin.kotlinServerForRun).toHaveBeenCalledWith(expect.objectContaining({ work: path.join(directory, 'extensions', 'work', 'kotlin') }));
  expect(shipped()['kotlin-lsp'].initialization_options).toEqual({ defaultSdk: '/opt/jdk-21', buildTools: { [pathToFileURL(project).href]: 'gradle' }, projects: [{ type: 'gradle', path: '.' }] });
  expect(warned).toHaveBeenCalledWith(expect.stringContaining('`intellij.projects` entry #1 has an unsupported "type": "ant"'));
  expect(position(call => call.op === 'project.settings' && String(call.values.defaults).includes('defaultSdk'))).toBeLessThan(position(call => call.op === 'project.open'));
  // The options are made from the tool's settings, so a change of those makes them again.
  registry.configure('kotlin-lsp', { settings: { 'intellij.buildTool': 'maven' } });
  await languages.configure();
  expect(shipped()['kotlin-lsp'].initialization_options).toEqual({ buildTools: { [pathToFileURL(project).href]: 'maven' }, projects: [] });
  warned.mockRestore();
});

test('a Kotlin server that fails its checksum is not started', async () => {
  kotlin.kotlinServerForRun.mockRejectedValue(Error('Could not verify the language server download: expected SHA-256 a, got b. The downloaded file was deleted.'));
  await expect(open('Main.kt', 'kotlin-lsp', 'kotlin')).rejects.toThrow('Could not verify the language server download');
  expect(called('project.open')).toHaveLength(0);
  expect(kotlin.forgetKotlinServer).toHaveBeenCalledWith(path.join(directory, 'extensions', 'work', 'kotlin'));
});

test('the JSON server asks Setdown for a schema, and the file shows which schemas check it', async () => {
  host.answers['project.request'] = values => values.method === 'json/languageStatus' ? { schemas: ['https://json.schemastore.org/package.json'] } : null;
  const json = await open('package.json', 'json-lsp', 'json');
  expect(shipped()['json-language-server'].initialization_options).toEqual({ handledSchemaProtocols: ['file'] });
  // vscode-jsonrpc sends one string as a list of one.
  expect(called('project.request')).toEqual([{ op: 'project.request', values: expect.objectContaining({ server: json.server, method: 'json/languageStatus', params: [json.uri] }) }]);
  expect((json.connection as { context: string[] }).context).toContain('Schema: https://json.schemastore.org/package.json');
  const workspace = called('project.open')[0].values.workspace;
  schemas.content.mockResolvedValueOnce('{"type":"object"}');
  host.listener!({ event: 'project.schemaContent', workspace, server: json.server, request: 41, uri: 'https://json.schemastore.org/package.json' });
  await vi.waitFor(() => expect(called('project.schemaContentResult')).toHaveLength(1));
  expect(schemas.content).toHaveBeenCalledWith('https://json.schemastore.org/package.json', expect.objectContaining({ enable: true, trustedDomains: expect.objectContaining({ 'https://json.schemastore.org/': true }) }));
  expect(called('project.schemaContentResult')[0].values).toEqual({ request: 41, content: '{"type":"object"}' });
  // A refusal keeps the code VS Code's JSON extension answers with, which the server turns into its diagnostic.
  schemas.content.mockRejectedValueOnce(new SchemaContentError(2, 'Location https://example.org/s.json is untrusted'));
  host.listener!({ event: 'project.schemaContent', workspace, server: json.server, request: 42, uri: 'https://example.org/s.json' });
  await vi.waitFor(() => expect(called('project.schemaContentResult')).toHaveLength(2));
  expect(called('project.schemaContentResult')[1].values).toEqual({ request: 42, error: 'Location https://example.org/s.json is untrusted', code: 2 });
});

test('each tool is asked only the requests of its own editor extension', async () => {
  const html = await open('index.html', 'html-lsp', 'html');
  expect(html.connection).toMatchObject({ autoInsert: { method: 'html/autoInsert', close: true, quote: true } });
  host.answers['project.request'] = () => '$0</div>';
  expect(await languages.request(1, html.id, 1, 'r1', 'html/autoInsert', { kind: 'autoClose', position: { line: 0, character: 5 } })).toBe('$0</div>');
  expect(called('project.request').at(-1)!.values).toMatchObject({ server: html.server, method: 'html/autoInsert', params: { kind: 'autoClose', position: { line: 0, character: 5 }, textDocument: { uri: html.uri } } });
  await expect(languages.request(1, html.id, 1, 'r2', 'html/tag', { position: { line: 0, character: 5 } })).rejects.toThrow('does not answer');
  await expect(languages.request(1, html.id, 1, 'r3', 'textDocument/switchSourceHeader', {})).rejects.toThrow('does not answer');
  const source = await open('widget.cpp', 'clangd', 'cpp');
  expect(source.connection).toMatchObject({ companion: true });
  expect((source.connection as { autoInsert?: unknown }).autoInsert).toBeUndefined();
  host.answers['project.request'] = () => pathToFileURL(path.join(project, 'widget.h')).href;
  expect(await languages.request(1, source.id, 1, 'r4', 'textDocument/switchSourceHeader', {})).toBe(pathToFileURL(path.join(project, 'widget.h')).href);
  // clangd takes the document itself as the parameter.
  expect(called('project.request').at(-1)!.values).toMatchObject({ server: source.server, method: 'textDocument/switchSourceHeader', params: { uri: source.uri } });
});

test('a copy Zed read again from a file Setdown saved is given the saved text, and the document stays bound', async () => {
  const opened = await open('main.go', 'gopls', 'go');
  const changes = [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'package main\n' }];
  await languages.change(1, opened.id, 2, changes);
  await writeFile(opened.file, 'package main\n');
  languages.saved(1, opened.id);
  const workspace = called('project.open').at(-1)!.values.workspace;
  events.length = 0;
  host.listener!({ event: 'project.diverged', workspace, path: opened.file, revision: 2 });
  await vi.waitFor(() => expect(called('project.change').at(-1)!.values).toMatchObject({ path: opened.file, revision: 2, text: 'package main\n' }));
  // Past the time after which a diverged copy is bound again, nothing was bound again.
  await new Promise(resolve => setTimeout(resolve, 1700));
  expect(events.filter(event => event.type === 'configuration')).toEqual([]);

  // With text that is not saved the file is not the document: it is bound again, as before.
  await languages.change(1, opened.id, 3, changes);
  const sent = called('project.change').length;
  host.listener!({ event: 'project.diverged', workspace, path: opened.file, revision: 3 });
  await new Promise(resolve => setTimeout(resolve, 1700));
  expect(called('project.change')).toHaveLength(sent);
  expect(events.some(event => event.type === 'configuration')).toBe(true);
});

test('the Svelte tool hears each unsaved change of a TypeScript file, and of no other language', async () => {
  const svelteTool = registry.definitions().find(isSvelteServer)!;
  const svelte = await open('App.svelte', svelteTool.id, 'svelte');
  expect(svelte.connection).toMatchObject({ autoInsert: { method: 'html/tag', close: true, quote: false } });
  const script = await open('util.ts', 'typescript-language-server', 'typescript'), other = await open('main.go', 'gopls', 'go');
  const changes = [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'export const a = 1;' }];
  await languages.change(1, script.id, 2, changes);
  await languages.change(1, other.id, 2, changes);
  expect(called('project.notify')).toEqual([{ op: 'project.notify', values: expect.objectContaining({ server: svelte.server, method: '$/onDidChangeTsOrJsFile', params: { uri: script.uri, changes } }) }]);
});
