import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { CancellationTokenSource } from 'vscode-jsonrpc/node';
import type { FullDocumentDiagnosticReport, Hover, PublishDiagnosticsParams } from 'vscode-languageserver-protocol';
import { serverProfiles } from './server-definitions';
import { notebookPythonAnalysis } from './python-analysis';
import { ServerSession } from './server-session';

const require = createRequire(import.meta.url);
const pullProfile = { ...serverProfiles.pyright, configuration: { python: { analysis: { typeCheckingMode: 'basic' } } }, renameAfterDiagnostics: false, initializationOptions: { ...serverProfiles.pyright.initializationOptions, disablePullDiagnostics: false } };
const sessions: ServerSession[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.stop()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
test('real Pyright sees independent unsaved buffers and versioned incremental Unicode changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pyright-unit-'));
  roots.push(root);
  const file = path.join(root, 'example.py');
  await writeFile(file, 'value = None\n');
  const uri = pathToFileURL(file).href;
  const diagnostics: PublishDiagnosticsParams[][] = [[], []];
  const failures: string[] = [];
  const create = (index: number) => {
    const server = new ServerSession({ executable: process.execPath, args: [require.resolve('pyright/langserver.index.js'), '--stdio'] },
      root, params => diagnostics[index].push(params), message => failures.push(message), pullProfile);
    sessions.push(server); return server;
  };
  const first = create(0), second = create(1);
  await Promise.all([first.ready, second.ready]);
  await first.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text: 'value: int = "😄"\r\n' } });
  await second.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text: 'value = "other window"\r\n' } });
  await expect.poll(() => first.capabilities.forDocument(uri, 'python').diagnosticProvider).toBeTruthy();
  await expect.poll(async () => (await first.request<FullDocumentDiagnosticReport>('textDocument/diagnostic', { textDocument: { uri } })).items.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const hover = await second.request<Hover>('textDocument/hover', { textDocument: { uri }, position: { line: 0, character: 2 } });
  expect(JSON.stringify(hover)).toContain('other window');
  await first.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [
    { range: { start: { line: 0, character: 13 }, end: { line: 0, character: 17 } }, text: '42' },
  ] });
  await expect.poll(async () => (await first.request<FullDocumentDiagnosticReport>('textDocument/diagnostic', { textDocument: { uri } })).items, { timeout: 15_000 }).toEqual([]);
  expect(JSON.stringify(await first.request<Hover>('textDocument/hover', { textDocument: { uri }, position: { line: 0, character: 2 } }))).toContain('Literal[42]');
  expect(failures).toEqual([]);
}, 30_000);

test('cancellation, timeouts, crash and shutdown do not leave pending requests', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-fake-'));
  roots.push(root);
  const fixture = path.join(root, 'server.cjs');
  await writeFile(fixture, `
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    c.onRequest('initialize', () => ({capabilities:{positionEncoding:'utf-16'}}));
    c.onRequest('ping', () => 'alive');
    c.onRequest('hang', () => new Promise(() => {}));
    c.onRequest('crash', () => process.exit(7));
    c.onRequest('shutdown', () => null);
    c.onNotification('exit', () => process.exit(0));
    c.listen();
  `);
  const failures: string[] = [];
  const server = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, message => failures.push(message), pullProfile);
  sessions.push(server);
  await server.ready;
  const token = new CancellationTokenSource();
  const pending = server.request('hang', {}, token);
  token.cancel();
  await expect(pending).rejects.toThrow(/cancelled/);
  await expect(server.request('hang', {}, undefined, 25)).rejects.toThrow(/cancelled|timed out/);
  expect(failures).toEqual([]);
  expect(await server.request('ping', {})).toBe('alive');
  await server.stop();
  await expect(server.request('hang', {})).rejects.toThrow(/stopped/);
  const crashed = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, message => failures.push(message), pullProfile);
  sessions.push(crashed);
  await crashed.ready;
  await expect(crashed.request('crash', {})).rejects.toThrow();
  await expect.poll(() => failures.length).toBe(1);
});

test('profile-gated rename waits for initial analysis, remains cancellable and never sends a timed-out edit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-analysis-barrier-'));
  roots.push(root);
  const fixture = path.join(root, 'server.cjs');
  await writeFile(fixture, `
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    let renames=0;
    c.onRequest('initialize',()=>({capabilities:{renameProvider:true}}));
    c.onRequest('count',()=>renames);
    c.onRequest('textDocument/rename',()=>++renames);
    c.onNotification('analyzed',()=>c.sendNotification('textDocument/publishDiagnostics',{uri:'file:///project/main.py',diagnostics:[]}));
    c.onRequest('shutdown',()=>null); c.onNotification('exit',()=>process.exit(0)); c.listen();
  `);
  const server = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, () => {}, { ...pullProfile, renameAfterDiagnostics: true });
  sessions.push(server); await server.ready;
  const token = new CancellationTokenSource();
  const pending = server.request('textDocument/rename', {}, token);
  expect(await server.request('count', {})).toBe(0);
  token.cancel(); await expect(pending).rejects.toThrow(/cancelled/);
  await expect(server.request('textDocument/rename', {}, undefined, 25)).rejects.toThrow(/timed out|cancelled/);
  const ready = server.request('textDocument/rename', {});
  await server.notify('analyzed', {});
  expect(await ready).toBe(1);
  expect(await server.request('count', {})).toBe(1);
});

test('watching a closed imported file refreshes analysis without overwriting the open buffer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-watch-'));
  roots.push(root);
  const dependency = path.join(root, 'dependency.py');
  await writeFile(dependency, 'value = 1\n');
  const uri = pathToFileURL(path.join(root, 'main.py')).href;
  const published: PublishDiagnosticsParams[] = [];
  let refreshes = 0;
  const server = new ServerSession({ executable: process.execPath, args: [require.resolve('pyright/langserver.index.js'), '--stdio'] }, root,
    params => published.push(params), () => {}, pullProfile, { refresh: feature => { if (feature === 'diagnostic') refreshes++; } });
  sessions.push(server);
  server.watch(root);
  await server.ready;
  await server.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1,
    text: 'from dependency import value\nresult: int = value\n' } });
  expect((await server.request<FullDocumentDiagnosticReport>('textDocument/diagnostic', { textDocument: { uri } })).items).toEqual([]);
  const initialRefreshes = refreshes;
  await writeFile(dependency, 'value = "changed on disk"\n');
  await expect.poll(() => refreshes, { timeout: 15_000 }).toBeGreaterThan(initialRefreshes);
  await expect.poll(async () => (await server.request<FullDocumentDiagnosticReport>('textDocument/diagnostic', { textDocument: { uri } })).items.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const hover = await server.request<Hover>('textDocument/hover', { textDocument: { uri }, position: { line: 1, character: 2 } });
  expect(JSON.stringify(hover)).toContain('result');
}, 25_000);

test('workspace rename includes unopened Python files immediately after initialization', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-rename-unit-')); roots.push(root);
  const helpers = path.join(root, 'helpers.py'), main = path.join(root, 'main.py'), uri = pathToFileURL(helpers).href;
  const text = 'def greeting(name: str) -> str:\n    return name.upper()\n';
  await writeFile(helpers, text); await writeFile(main, 'from helpers import greeting\nprint(greeting("Setdown"))\n');
  const server = new ServerSession({ executable: require('electron'), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, args: [require.resolve('pyright/langserver.index.js'), '--stdio'] }, root, () => {}, () => {}, serverProfiles.pyright);
  sessions.push(server); server.watch(root); await server.ready;
  await server.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text } });
  expect(serverProfiles.pyright.initializationOptions?.disablePullDiagnostics).toBe(true);
  await server.request('textDocument/prepareRename', { textDocument: { uri }, position: { line: 0, character: 5 } });
  const result = await server.request<import('vscode-languageserver-protocol').WorkspaceEdit>('textDocument/rename', { textDocument: { uri }, position: { line: 0, character: 5 }, newName: 'welcome' });
  expect(JSON.stringify(result)).toContain(pathToFileURL(main).href);
});

test.each(['pyright', 'basedpyright'])('%s off preset keeps core diagnostics and inference without type noise', async module => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-light-diagnostics-')); roots.push(root);
  const uri = pathToFileURL(path.join(root, 'main.py')).href;
  const analysis = module === 'basedpyright' ? notebookPythonAnalysis
    : (serverProfiles.pyright.configuration.python as { analysis: Record<string, unknown> }).analysis;
  const profile = { ...serverProfiles.pyright, renameAfterDiagnostics: false,
    configuration: { python: { analysis }, basedpyright: { analysis } } };
  const published: PublishDiagnosticsParams[] = [];
  const failures: string[] = [];
  const server = new ServerSession({ executable: process.execPath, args: [require.resolve(`${module}/langserver.index.js`), '--stdio'] },
    root, params => published.push(params), message => failures.push(message), profile);
  sessions.push(server); await server.ready;
  const text = 'from typing import Literal\n'
    + 'def read_csv(*, float_precision: Literal["high"]) -> object:\n    return object()\n'
    + 'frame = read_csv(float_precision="round_trip")\nframe.groupby("method")\n'
    + 'row = (3,)\nrow.R_nominal\ncount: int = "wrong"\n'
    + 'import setdown_missing_module_9a72\nprint(setdown_missing_name)\n';
  await server.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text } });
  await expect.poll(() => published.at(-1)?.diagnostics.filter(d => d.severity === 1 || d.severity === 2).map(d => d.code).sort(), { timeout: 15_000 })
    .toEqual(['reportMissingImports', 'reportUndefinedVariable']);
  expect(published.at(-1)?.diagnostics.filter(d => d.code === 'reportMissingImports' || d.code === 'reportUndefinedVariable').every(d => d.severity === 2)).toBe(true);
  const hover = await server.request<Hover>('textDocument/hover', { textDocument: { uri }, position: { line: 5, character: 1 } });
  expect(JSON.stringify(hover)).toContain('tuple');
  const completions = await server.request('textDocument/completion', { textDocument: { uri }, position: { line: 4, character: 6 } });
  expect(JSON.stringify(completions)).toContain('__class__');
  await server.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: 'values = [\n' }] });
  await expect.poll(() => published.at(-1)?.version, { timeout: 15_000 }).toBe(2);
  expect(published.at(-1)?.diagnostics.some(d => d.severity === 1)).toBe(true);
  await server.notify('textDocument/didChange', { textDocument: { uri, version: 3 }, contentChanges: [{ text: 'values = []\n' }] });
  await expect.poll(() => published.at(-1)?.version, { timeout: 15_000 }).toBe(3);
  expect(published.at(-1)?.diagnostics).toEqual([]);
  expect(failures).toEqual([]);
}, 30_000);

test('server action requests remain nonmodal, bounded to their session and cancelled by shutdown', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-actions-')); roots.push(root);
  const fixture = path.join(root, 'server.cjs');
  await writeFile(fixture, `
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    c.onRequest('initialize', () => ({capabilities:{}}));
    c.onRequest('ask', () => c.sendRequest('window/showMessageRequest', {message:'Reload workspace?',actions:[{title:'Reload',detail:'opaque origin'},{title:'Later'}]}));
    c.onRequest('shutdown', () => null); c.onNotification('exit', () => process.exit(0)); c.listen();
  `);
  const server = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, () => {});
  sessions.push(server); await server.ready;
  const answer = server.request('ask', {}); await expect.poll(() => server.messages.length).toBe(1);
  expect(server.messages[0]).toMatchObject({ message: 'Reload workspace?', actions: ['Reload', 'Later'] });
  expect(() => server.answerMessage(server.messages[0].id, 8)).toThrow(/no longer/);
  const id = server.messages[0].id; server.answerMessage(id, 0);
  expect(await answer).toEqual({ title: 'Reload', detail: 'opaque origin' });
  expect(() => server.answerMessage(id, 0)).toThrow(/no longer/);
  const dismissed = server.request('ask', {}); await expect.poll(() => server.messages.length).toBe(1);
  server.answerMessage(server.messages[0].id); expect(await dismissed).toBeNull();
  const pending = server.request('ask', {}).catch(() => null); await expect.poll(() => server.messages.length).toBe(1);
  await server.stop(); await pending; expect(server.messages).toEqual([]);
});
