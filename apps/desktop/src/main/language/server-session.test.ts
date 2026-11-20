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
import { applyPythonProjectSettings } from './python-project-settings';
import { notebookAnalysisSource } from './notebook-ipython-syntax';
import { notebookClientCapabilities } from '../../protocol/language-features';
import { ServerSession } from './server-session';

const require = createRequire(import.meta.url);
const pullProfile = { ...serverProfiles.pyright, configuration: { python: { analysis: { typeCheckingMode: 'basic' } } }, renameAfterDiagnostics: false, initializationOptions: { ...serverProfiles.pyright.initializationOptions, disablePullDiagnostics: false } };
const sessions: ServerSession[] = [];
const roots: string[] = [];
/** What a notebook's analyzer is sent: Off unless a level is chosen. */
const notebookConfiguration = (level?: 'basic') => applyPythonProjectSettings(
  { basedpyright: { analysis: notebookPythonAnalysis } }, { errors: [] }, 'basedpyright', true, level);
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

test.each(['pyright', 'basedpyright'] as const)('%s basic preset reports real type errors without requiring strict annotations', async module => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-basic-diagnostics-')); roots.push(root);
  const uri = pathToFileURL(path.join(root, 'main.py')).href;
  const analysis = module === 'basedpyright' ? notebookPythonAnalysis
    : (serverProfiles.pyright.configuration.python as { analysis: Record<string, unknown> }).analysis;
  // Notebooks start at Off: this is what the app sends once Basic is chosen.
  const configuration = applyPythonProjectSettings({ python: { analysis }, basedpyright: { analysis } }, { errors: [] }, module, true, 'basic');
  const profile = { ...serverProfiles.pyright, renameAfterDiagnostics: false, configuration };
  const published: PublishDiagnosticsParams[] = [], failures: string[] = [];
  const server = new ServerSession({ executable: process.execPath, args: [require.resolve(`${module}/langserver.index.js`), '--stdio'] },
    root, params => published.push(params), message => failures.push(message), profile);
  sessions.push(server); await server.ready;
  const text = 'from typing import Literal\ndef choose(mode: Literal["fast", "safe"]) -> str:\n    return mode\n'
    + 'valid = choose("fast")\ninvalid = choose("turbo")\ncount: int = "wrong"\n'
    + 'def identity(value):\n    return value\n';
  await server.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text } });
  await expect.poll(() => published.at(-1)?.diagnostics.filter(d => d.severity === 1 || d.severity === 2).map(d => d.code).sort(), { timeout: 15_000 })
    .toEqual(['reportArgumentType', 'reportAssignmentType']);
  expect(published.at(-1)?.diagnostics.find(d => d.code === 'reportArgumentType')?.range.start.line).toBe(4);
  const fixed = text.replace('choose("turbo")', 'choose("safe")').replace('count: int = "wrong"', 'count: int = 1');
  await server.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: fixed }] });
  await expect.poll(() => published.at(-1)?.version, { timeout: 15_000 }).toBe(2);
  expect(published.at(-1)?.diagnostics).toEqual([]); expect(failures).toEqual([]);
}, 30_000);

test.each(['pyright', 'basedpyright'] as const)('%s Off reports unresolved imports and undefined names as warnings and no type errors', async module => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-default-diagnostics-')); roots.push(root);
  const uri = pathToFileURL(path.join(root, 'main.py')).href;
  const configuration = applyPythonProjectSettings({ python: { analysis: notebookPythonAnalysis }, basedpyright: { analysis: notebookPythonAnalysis } }, { errors: [] }, module, true, 'off');
  const published: PublishDiagnosticsParams[] = [], failures: string[] = [];
  const server = new ServerSession({ executable: process.execPath, args: [require.resolve(`${module}/langserver.index.js`), '--stdio'] },
    root, params => published.push(params), message => failures.push(message), { ...serverProfiles.pyright, renameAfterDiagnostics: false, configuration });
  sessions.push(server); await server.ready;
  // Each line fails when run; only the first two are certain without library type information.
  const text = 'import setdown_missing_module\nprint(setdown_undefined_name)\n'
    + 'from typing import Literal\ndef choose(mode: Literal["fast", "safe"]) -> str:\n    return mode\n'
    + 'choose("turbo")\ncount: int = "wrong"\n';
  await server.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text } });
  await expect.poll(() => published.at(-1)?.diagnostics.filter(d => d.severity === 1 || d.severity === 2).map(d => [d.code, d.severity]).sort(), { timeout: 15_000 })
    .toEqual([['reportMissingImports', 2], ['reportUndefinedVariable', 2]]);
  expect(failures).toEqual([]);
}, 30_000);

test.each(['pyright', 'basedpyright'])('%s honors native off and strict policies over the bundled basic default', async module => {
  for (const mode of ['off', 'strict']) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-native-checking-')); roots.push(root);
    await writeFile(path.join(root, 'pyrightconfig.json'), JSON.stringify({ typeCheckingMode: mode }));
    const uri = pathToFileURL(path.join(root, 'main.py')).href, published: PublishDiagnosticsParams[] = [];
    const server = new ServerSession({ executable: process.execPath, args: [require.resolve(`${module}/langserver.index.js`), '--stdio'] }, root,
      params => published.push(params), () => {}, { ...serverProfiles.pyright, renameAfterDiagnostics: false,
        configuration: { python: { analysis: notebookPythonAnalysis }, basedpyright: { analysis: notebookPythonAnalysis } } });
    sessions.push(server); await server.ready;
    await server.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1,
      text: 'def identity(value):\n    return value\ncount: int = "wrong"\n' } });
    await expect.poll(() => published.at(-1)?.version, { timeout: 15_000 }).toBe(1);
    const codes = published.at(-1)!.diagnostics.map(d => d.code);
    if (mode === 'off') expect(codes).toEqual([]);
    else expect(codes).toEqual(expect.arrayContaining(['reportAssignmentType', 'reportUnknownParameterType']));
  }
}, 45_000);

test('one real basedpyright process keeps native notebook namespaces and dependency snapshots independent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-isolation-')); roots.push(root);
  const published: PublishDiagnosticsParams[] = [];
  const server = new ServerSession({ executable: process.execPath, args: [require.resolve('basedpyright/langserver.index.js'), '--stdio'] }, root,
    params => published.push(params), () => {}, { name: 'Notebook Python', watches: () => false, capabilities: notebookClientCapabilities(),
      initializationOptions: { disablePullDiagnostics: true }, configuration: notebookConfiguration('basic') });
  sessions.push(server); await server.ready;
  const open = async (name: string, sources: string[]) => {
    const uri = pathToFileURL(path.join(root, name + '.ipynb')).href;
    const cells = sources.map((text, i) => ({ uri: uri.replace(/^file:/, 'vscode-notebook-cell:') + '#' + i, languageId: 'python', version: 1, text }));
    await server.notify('notebookDocument/didOpen', { notebookDocument: { uri, notebookType: 'jupyter-notebook', version: 1,
      cells: cells.map(cell => ({ kind: 2, document: cell.uri })) }, cellTextDocuments: cells });
    return { uri, cells };
  };
  const a = await open('a', ['from typing import Literal\ndef choose(mode: Literal["safe"]) -> str:\n    return mode', 'choose("turbo")']);
  const b = await open('b', ['choose("safe")']);
  const latest = (uri: string) => published.filter(batch => batch.uri === uri).at(-1);
  await expect.poll(() => latest(a.cells[1].uri)?.diagnostics.map(d => d.code), { timeout: 15_000 }).toEqual(['reportArgumentType']);
  await expect.poll(() => latest(b.cells[0].uri)?.diagnostics.map(d => d.code), { timeout: 15_000 }).toEqual(['reportUndefinedVariable']);
  await server.notify('notebookDocument/didChange', { notebookDocument: { uri: a.uri, version: 2 }, change: { cells: { textContent: a.cells.map((cell, i) => ({
    document: { uri: cell.uri, version: 2 }, changes: [{ text: i === 0 ? cell.text.replace('"safe"', '"turbo"') : cell.text }],
  })) } } } satisfies import('vscode-languageserver-protocol').DidChangeNotebookDocumentParams);
  await expect.poll(() => latest(a.cells[1].uri)?.version, { timeout: 15_000 }).toBe(2);
  expect(latest(a.cells[1].uri)?.diagnostics).toEqual([]);
  expect(latest(b.cells[0].uri)?.diagnostics.map(d => d.code)).toEqual(['reportUndefinedVariable']);
}, 45_000);

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

test('a notice the server shows stays until it is dismissed, without repeats and within a bound', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-notices-')); roots.push(root);
  const fixture = path.join(root, 'server.cjs');
  await writeFile(fixture, `
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    c.onRequest('initialize', () => ({capabilities:{}}));
    c.onRequest('say', params => { for (const [type, message] of params) c.sendNotification('window/showMessage', {type, message}); return null; });
    c.onRequest('ask', () => c.sendRequest('window/showMessageRequest', {message:'Reload workspace?',actions:[{title:'Reload'}]}));
    c.onRequest('shutdown', () => null); c.onNotification('exit', () => process.exit(0)); c.listen();
  `);
  let activity = 0;
  const server = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, () => {}, undefined, { activity: () => { activity++; } });
  sessions.push(server); await server.ready;
  // A log-level message and an empty one are not notices; the same text is shown once.
  await server.request('say', [[2, 'Your licence key has expired.'], [2, 'Your licence key has expired.'], [4, 'verbose'], [3, ' '], [1, 'Indexing failed.']]);
  await expect.poll(() => server.messages.length).toBe(2);
  expect(server.messages.map(({ message, actions, severity }) => ({ message, actions, severity }))).toEqual([
    { message: 'Your licence key has expired.', actions: [], severity: 'warning' }, { message: 'Indexing failed.', actions: [], severity: 'error' }]);
  expect(activity).toBeGreaterThanOrEqual(2);
  expect(server.logs.join('\n')).toContain('verbose');
  server.answerMessage(server.messages[0].id);
  expect(server.messages.map(entry => entry.message)).toEqual(['Indexing failed.']);
  // The newest four notices are kept, and they do not displace a question.
  const question = server.request('ask', {}); await expect.poll(() => server.messages.some(entry => entry.actions.length)).toBe(true);
  await server.request('say', [[3, 'one'], [3, 'two'], [3, 'three'], [3, 'four'], [3, 'five']]);
  await expect.poll(() => server.messages.some(entry => entry.message === 'five')).toBe(true);
  expect(server.messages.filter(entry => entry.severity).map(entry => entry.message)).toEqual(['two', 'three', 'four', 'five']);
  const asked = server.messages.find(entry => entry.actions.length)!; server.answerMessage(asked.id, 0);
  expect(await question).toEqual({ title: 'Reload' });
  await server.stop(); expect(server.messages).toEqual([]);
});

test('rust-analyzer\'s standing status is shown as it stands: one notice replaced by the next, a line of facts, and work still going on', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-status-')); roots.push(root);
  const fixture = path.join(root, 'server.cjs');
  await writeFile(fixture, `
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    let asked;
    c.onRequest('initialize', params => { asked = params.capabilities.experimental; return {capabilities:{}}; });
    c.onRequest('asked', () => asked ?? null);
    c.onRequest('status', params => { c.sendNotification('experimental/serverStatus', params); return null; });
    c.onRequest('shutdown', () => null); c.onNotification('exit', () => process.exit(0)); c.listen();
  `);
  let activity = 0;
  const server = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, () => {}, serverProfiles['rust-analyzer'], { activity: () => { activity++; } });
  sessions.push(server); await server.ready;
  // The tool reports its status only to an editor that asks for it.
  expect(await server.request('asked', {})).toMatchObject({ serverStatusNotification: true });
  const notices = () => server.messages.map(({ message, severity, actions }) => ({ message, severity, actions }));
  await server.request('status', { health: 'ok', quiescent: false });
  await expect.poll(() => server.progress.size).toBe(1);
  expect([...server.progress.values()]).toEqual(['rust-analyzer is still working: results may change']);
  expect(notices()).toEqual([]); expect(server.context.has('Server status')).toBe(false);
  await server.request('status', { health: 'warning', quiescent: true, message: 'Failed to load workspaces.' });
  await expect.poll(() => server.messages.length).toBe(1);
  expect(notices()).toEqual([{ severity: 'warning', actions: [], message: 'rust-analyzer is only partly working: some results may be wrong.\n\nFailed to load workspaces.' }]);
  expect(server.context.get('Server status')).toBe('rust-analyzer is only partly working: some results may be wrong. Failed to load workspaces.');
  expect(server.progress.size).toBe(0);
  expect(server.logs.join('\n')).toContain('Server status (warning): Failed to load workspaces.');
  // The same status again is the same notice; dismissed, it does not come back until the status changes.
  const first = server.messages[0].id, before = activity;
  await server.request('status', { health: 'warning', quiescent: true, message: 'Failed to load workspaces.' });
  await expect.poll(() => activity).toBeGreaterThan(before);
  expect(server.messages.map(entry => entry.id)).toEqual([first]);
  server.answerMessage(first);
  await server.request('status', { health: 'warning', quiescent: false, message: 'Failed to load workspaces.' });
  await expect.poll(() => server.progress.size).toBe(1);
  expect(notices()).toEqual([]);
  expect(server.context.get('Server status')).toContain('some results may be wrong');
  // A worse status replaces it, and a good one takes it away.
  await server.request('status', { health: 'error', quiescent: true });
  await expect.poll(() => server.messages.length).toBe(1);
  expect(notices()).toEqual([{ severity: 'error', actions: [], message: 'rust-analyzer is not working: most results will be incomplete or wrong.' }]);
  await server.request('status', { health: 'warning', quiescent: true, message: 'proc-macro server failed' });
  await expect.poll(() => server.messages[0]?.severity).toBe('warning');
  expect(server.messages).toHaveLength(1);
  await server.request('status', { health: 'ok', quiescent: true });
  await expect.poll(() => server.messages.length).toBe(0);
  expect(server.context.has('Server status')).toBe(false); expect(server.progress.size).toBe(0);
  // What is not a status changes nothing.
  await server.request('status', { health: 'fine' });
  await server.request('status', { health: 'ok', quiescent: true, message: 'Ready' });
  await expect.poll(() => server.context.get('Server status')).toBe('Ready');
  expect(notices()).toEqual([]);
});

test('clangd\'s inactive regions reach the editor with its diagnostics of the same version, and only for a tool that was asked for them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-regions-')); roots.push(root);
  const fixture = path.join(root, 'server.cjs');
  await writeFile(fixture, `
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    let asked;
    c.onRequest('initialize', params => { asked = params.capabilities.textDocument.inactiveRegionsCapabilities; return {capabilities:{}}; });
    c.onRequest('asked', () => asked ?? null);
    c.onRequest('send', params => { for (const [method, value] of params) c.sendNotification(method, value); return null; });
    c.onNotification('textDocument/didClose', () => {});
    c.onRequest('shutdown', () => null); c.onNotification('exit', () => process.exit(0)); c.listen();
  `);
  const uri = pathToFileURL(path.join(root, 'main.c')).href, region = { start: { line: 4, character: 0 }, end: { line: 9, character: 6 } };
  const error = { range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }, severity: 1, message: 'unknown type name' };
  const faded = { range: region, severity: 4, source: 'clangd', message: 'Inactive region: the preprocessor leaves these lines out of this build', tags: [1] };
  const seen: PublishDiagnosticsParams[] = [];
  const server = new ServerSession({ executable: process.execPath, args: [fixture] }, root, params => seen.push(params), () => {}, serverProfiles.clangd);
  sessions.push(server); await server.ready;
  expect(await server.request('asked', {})).toEqual({ inactiveRegions: true });
  // Regions before the diagnostics of that version say nothing yet; with them, both are given.
  await server.request('send', [['textDocument/inactiveRegions', { textDocument: { uri, version: 1 }, regions: [region] }]]);
  await server.request('send', [['textDocument/publishDiagnostics', { uri, version: 1, diagnostics: [error] }]]);
  await expect.poll(() => seen.length).toBe(1);
  expect(seen[0]).toEqual({ uri, version: 1, diagnostics: [error, faded] });
  // New diagnostics for a changed text are given without the old regions, then with the new ones.
  await server.request('send', [['textDocument/publishDiagnostics', { uri, version: 2, diagnostics: [] }], ['textDocument/inactiveRegions', { textDocument: { uri, version: 2 }, regions: [region, region] }]]);
  await expect.poll(() => seen.length).toBe(3);
  expect(seen.slice(1)).toEqual([{ uri, version: 2, diagnostics: [] }, { uri, version: 2, diagnostics: [faded, faded] }]);
  // A closed file keeps nothing.
  await server.notify('textDocument/didClose', { textDocument: { uri } });
  await server.request('send', [['textDocument/publishDiagnostics', { uri, version: 2, diagnostics: [error] }]]);
  await expect.poll(() => seen.length).toBe(4);
  expect(seen[3]).toEqual({ uri, version: 2, diagnostics: [error] });
  // A tool that was not asked for regions has its diagnostics passed on as they are, whatever else it sends.
  const plain: PublishDiagnosticsParams[] = [];
  const other = new ServerSession({ executable: process.execPath, args: [fixture] }, root, params => plain.push(params), () => {});
  sessions.push(other); await other.ready;
  expect(await other.request('asked', {})).toBeNull();
  await other.request('send', [['textDocument/publishDiagnostics', { uri, version: 1, diagnostics: [error] }], ['textDocument/inactiveRegions', { textDocument: { uri, version: 1 }, regions: [region] }],
    ['textDocument/publishDiagnostics', { uri, version: 1, diagnostics: [] }]]);
  await expect.poll(() => plain.length).toBe(2);
  expect(plain).toEqual([{ uri, version: 1, diagnostics: [error] }, { uri, version: 1, diagnostics: [] }]);
});

test('a server that registers configuration or unknown capabilities stays connected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-registration-'));
  roots.push(root);
  const fixture = path.join(root, 'server.cjs');
  // Like vscode-languageserver, the fixture dies when a registration is rejected.
  await writeFile(fixture, `
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    let declared;
    c.onRequest('initialize', params => { declared = params.capabilities.workspace.didChangeConfiguration; return {capabilities:{positionEncoding:'utf-16'}}; });
    c.onNotification('initialized', () => c.sendRequest('client/registerCapability', {registrations:[
      {id:'settings', method:'workspace/didChangeConfiguration', registerOptions:{section:'fixture'}},
      {id:'future', method:'fixture/notYetStandardized'},
      {id:'hover', method:'textDocument/hover', registerOptions:{documentSelector:[{language:'fixture'}]}},
    ]}).catch(() => process.exit(9)));
    c.onRequest('declared', () => declared);
    c.onRequest('shutdown', () => null);
    c.onNotification('exit', () => process.exit(0));
    c.listen();
  `);
  const failures: string[] = [];
  const server = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, message => failures.push(message), { name: 'Fixture', configuration: {}, watches: () => false });
  sessions.push(server);
  await server.ready;
  await expect.poll(() => server.capabilities.forDocument(pathToFileURL(path.join(root, 'a.fixture')).href, 'fixture').hoverProvider).toBeTruthy();
  expect(await server.request('declared', null)).toEqual({ dynamicRegistration: true });
  expect(server.logs.join('\n')).toContain('fixture/notYetStandardized');
  expect(server.logs.join('\n')).not.toContain('workspace/didChangeConfiguration');
  expect(failures).toEqual([]);
});

test('real basedpyright reads %%time bodies and IPython help only through the notebook rules', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-ipython-')); roots.push(root);
  const published: PublishDiagnosticsParams[] = [];
  const server = new ServerSession({ executable: process.execPath, args: [require.resolve('basedpyright/langserver.index.js'), '--stdio'] }, root,
    params => published.push(params), () => {}, { name: 'Notebook Python', watches: () => false, capabilities: notebookClientCapabilities(),
      initializationOptions: { disablePullDiagnostics: true }, configuration: notebookConfiguration() });
  sessions.push(server); await server.ready;
  const sources = ['%%time\ntotal = sum(range(3))', 'print(total)\ntotal?', '??print', '%%bash\necho "$total" ?', 'print(total, missing_name)'];
  const open = async (name: string, texts: string[]) => {
    const uri = pathToFileURL(path.join(root, name + '.ipynb')).href;
    const cells = texts.map((text, i) => ({ uri: uri.replace(/^file:/, 'vscode-notebook-cell:') + '#' + i, languageId: 'python', version: 1, text }));
    await server.notify('notebookDocument/didOpen', { notebookDocument: { uri, notebookType: 'jupyter-notebook', version: 1,
      cells: cells.map(cell => ({ kind: 2, document: cell.uri })) }, cellTextDocuments: cells });
    return cells;
  };
  // At the notebook default an undefined name is a warning and a syntax error an error.
  const reports = (cells: { uri: string }[]) => cells.map(cell => published.filter(batch => batch.uri === cell.uri).at(-1)?.diagnostics
    .filter(d => d.severity === 1 || d.severity === 2).map(d => d.code ?? 'syntax').sort().filter((code, i, all) => all.indexOf(code) === i));
  const written = await open('written', sources), analyzed = await open('analyzed', sources.map(notebookAnalysisSource));
  // As written, the analyzer loses the name defined under %%time and cannot parse help.
  // If this expectation fails, upstream reads them and notebookAnalysisSource can go.
  await expect.poll(() => reports(written), { timeout: 20_000 }).toEqual([[], ['reportUndefinedVariable', 'syntax'], ['syntax'], [], ['reportUndefinedVariable']]);
  // The real report stays; positions are unchanged because every rule keeps the length.
  await expect.poll(() => reports(analyzed), { timeout: 20_000 }).toEqual([[], [], [], [], ['reportUndefinedVariable']]);
  const real = published.filter(batch => batch.uri === analyzed[4].uri).at(-1)!.diagnostics.filter(d => d.code === 'reportUndefinedVariable');
  expect(real.map(d => [d.severity, d.range.start.character, d.range.end.character])).toEqual([[2, 13, 25]]);
}, 60_000);

test('the JSON server gets a schema from its editor, or the refusal with its code, and is asked a document\'s schemas by its address alone', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-schemas-')); roots.push(root);
  const fixture = path.join(root, 'server.cjs');
  // As vendor/vscode/extensions/json-language-features/server/src/jsonServer.ts asks and is asked.
  await writeFile(fixture, `
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter, RequestType} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    const content = new RequestType('vscode/content');
    c.onRequest('initialize', () => ({capabilities:{}}));
    c.onRequest('fetch', ({uri}) => c.sendRequest(content, uri).then(text => ({text}), error => ({code: error.code, message: error.message})));
    c.onRequest('json/languageStatus', uri => ({schemas: [typeof uri === 'string' ? 'asked for ' + uri : 'not an address']}));
    c.onRequest('shutdown', () => null); c.onNotification('exit', () => process.exit(0)); c.listen();
  `);
  const asked: string[] = [];
  const server = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, () => {}, undefined, { schemaContent: async uri => {
    asked.push(uri);
    if (uri.includes('untrusted')) throw Object.assign(Error(`Location ${uri} is untrusted`), { code: 2 });
    if (uri.includes('broken')) throw Error('socket hang up');
    return '{"type":"object"}';
  } });
  sessions.push(server); await server.ready;
  expect(await server.request('fetch', { uri: 'https://json.schemastore.org/package.json' })).toEqual({ text: '{"type":"object"}' });
  expect(await server.request('fetch', { uri: 'https://untrusted.example/s.json' })).toEqual({ code: 2, message: 'Location https://untrusted.example/s.json is untrusted' });
  // A failure without a code of its own is the extension's "could not load" (5).
  expect(await server.request('fetch', { uri: 'https://broken.example/s.json' })).toEqual({ code: 5, message: 'socket hang up' });
  expect(asked).toEqual(['https://json.schemastore.org/package.json', 'https://untrusted.example/s.json', 'https://broken.example/s.json']);
  expect(await server.request('json/languageStatus', 'file:///project/package.json')).toEqual({ schemas: ['asked for file:///project/package.json'] });
  const plain = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, () => {});
  sessions.push(plain); await plain.ready;
  expect(await plain.request('fetch', { uri: 'https://json.schemastore.org/package.json' })).toMatchObject({ code: 5 });
});

test('a tool\'s own rules: its notifications become lines and notices, a notice button acts, its requests are answered and may ask the person', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-rules-')); roots.push(root);
  const fixture = path.join(root, 'server.cjs');
  await writeFile(fixture, `
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    let asked;
    c.onRequest('initialize', params => { asked = params; return {capabilities:{}}; });
    c.onRequest('asked', () => ({ options: asked.initializationOptions, experimental: asked.capabilities.experimental ?? null }));
    c.onRequest('tell', ([method, params]) => { c.sendNotification(method, params); return null; });
    c.onRequest('call', async ([method, params]) => { try { return { result: await c.sendRequest(method, params) }; } catch (error) { return { error: error.message }; } });
    c.onRequest('shutdown', () => null); c.onNotification('exit', () => process.exit(0)); c.listen();
  `);
  const acted: unknown[] = [];
  const { withRules } = await import('./tool-rules');
  const profile = withRules({ ...serverProfiles.gopls, initializationOptions: { written: 'by the person', shared: 'person' } }, {
    capabilities: general => ({ ...general, experimental: { tool: true } }),
    initializationOptions: { shared: 'rules', added: 1 },
    started: () => ({ context: { Import: 'not started' } }),
    notifications: {
      'tool/status': params => { const status = params as { state: string; problem?: string };
        return { context: { Import: status.state }, progress: { import: status.state === 'importing' ? 'Importing the project' : undefined }, log: [`status ${status.state}`],
          notices: { jdk: status.problem ? { severity: 'warning', message: status.problem, actions: [{ title: 'Use Java 21', setting: { name: 'java.home', value: '/jdk21' } }, { title: 'Later', dismiss: true }] } : undefined } }; },
      'tool/broken': () => { throw Error('a rule that fails'); },
      // A handler of the session's own is not replaced by a rule of the same name.
      'window/logMessage': () => ({ context: { Stolen: 'yes' } }),
    },
    requests: {
      'tool/bundles': () => ({ result: ['a.jar'], signal: { context: { Asked: 'bundles' } } }),
      'tool/choose': params => ({ question: { message: 'Which build tool?', answers: (params as { tools: string[] }).tools }, result: answer => answer === undefined ? null : (params as { tools: string[] }).tools[answer] }),
      'tool/refuses': () => { throw Error('not here'); },
    },
  });
  const server = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, () => {}, profile, { act: action => { acted.push(action); } });
  sessions.push(server); await server.ready;
  // What the rules add is told at startup; what the person wrote wins.
  expect(await server.request('asked', {})).toEqual({ options: { written: 'by the person', shared: 'person', added: 1 }, experimental: { tool: true } });
  expect(server.context.get('Import')).toBe('not started');
  await server.request('tell', ['tool/status', { state: 'importing' }]);
  await expect.poll(() => server.context.get('Import')).toBe('importing');
  expect([...server.progress.values()]).toEqual(['Importing the project']); expect(server.logs).toContain('status importing'); expect(server.messages).toEqual([]);
  await server.request('tell', ['tool/status', { state: 'imported', problem: 'Gradle needs Java 21.' }]);
  await expect.poll(() => server.messages.length).toBe(1);
  expect(server.progress.size).toBe(0);
  expect(server.messages.map(({ message, severity, actions }) => ({ message, severity, actions }))).toEqual([{ message: 'Gradle needs Java 21.', severity: 'warning', actions: ['Use Java 21', 'Later'] }]);
  // The same notice again is the same notice. Its button acts once and takes the notice away.
  const id = server.messages[0].id;
  await server.request('tell', ['tool/status', { state: 'imported', problem: 'Gradle needs Java 21.' }]);
  await server.request('asked', {}); expect(server.messages.map(entry => entry.id)).toEqual([id]);
  expect(() => server.answerMessage(id, 2)).toThrow('no longer available');
  server.answerMessage(id, 0);
  await expect.poll(() => acted).toEqual([{ title: 'Use Java 21', setting: { name: 'java.home', value: '/jdk21' } }]);
  expect(server.messages).toEqual([]);
  // Answered, it stays away while the tool repeats itself, and returns when what it says changes.
  await server.request('tell', ['tool/status', { state: 'imported', problem: 'Gradle needs Java 21.' }]);
  await server.request('asked', {}); expect(server.messages).toEqual([]);
  await server.request('tell', ['tool/status', { state: 'imported', problem: 'Gradle needs Java 25.' }]);
  await expect.poll(() => server.messages.length).toBe(1);
  // "Later" only removes it; the rule taking the notice back removes it too.
  server.answerMessage(server.messages[0].id, 1); expect(server.messages).toEqual([]); expect(acted).toHaveLength(1);
  await server.request('tell', ['tool/status', { state: 'imported', problem: 'Another problem.' }]);
  await expect.poll(() => server.messages.length).toBe(1);
  await server.request('tell', ['tool/status', { state: 'imported' }]);
  await expect.poll(() => server.messages.length).toBe(0);
  // A rule that fails is logged and nothing else happens; the session's own handlers stay.
  await server.request('tell', ['tool/broken', {}]); await server.request('tell', ['window/logMessage', { message: 'plain log' }]);
  await expect.poll(() => server.logs.join('\n')).toContain('plain log');
  expect(server.logs.join('\n')).toContain('tool/broken: Error: a rule that fails'); expect(server.context.has('Stolen')).toBe(false);
  // The tool's own requests: an answer at once, an answer the person chooses, and a refusal.
  expect(await server.request('call', ['tool/bundles', {}])).toEqual({ result: ['a.jar'] }); expect(server.context.get('Asked')).toBe('bundles');
  const choice = server.request('call', ['tool/choose', { tools: ['Gradle', 'Maven'] }]);
  await expect.poll(() => server.messages.length).toBe(1);
  expect(server.messages[0]).toMatchObject({ message: 'Which build tool?', actions: ['Gradle', 'Maven'] }); expect(server.messages[0].severity).toBeUndefined();
  server.answerMessage(server.messages[0].id, 1);
  expect(await choice).toEqual({ result: 'Maven' });
  const dismissed = server.request('call', ['tool/choose', { tools: ['Gradle', 'Maven'] }]);
  await expect.poll(() => server.messages.length).toBe(1); server.answerMessage(server.messages[0].id);
  expect(await dismissed).toEqual({ result: null });
  expect(await server.request('call', ['tool/refuses', {}])).toEqual({ error: 'not here' });
  expect(acted).toHaveLength(1);
});
