import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { CancellationTokenSource } from 'vscode-jsonrpc/node';
import type { Hover, PublishDiagnosticsParams } from 'vscode-languageserver-protocol';
import { ServerSession } from './server-session';

const require = createRequire(import.meta.url);
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
      root, params => diagnostics[index].push(params), message => failures.push(message));
    sessions.push(server); return server;
  };
  const first = create(0), second = create(1);
  await Promise.all([first.ready, second.ready]);
  await first.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text: 'value: int = "😄"\r\n' } });
  await second.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text: 'value = "other window"\r\n' } });
  await expect.poll(() => diagnostics[0].find(d => d.version === 1)?.diagnostics.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const hover = await second.request<Hover>('textDocument/hover', { textDocument: { uri }, position: { line: 0, character: 2 } });
  expect(JSON.stringify(hover)).toContain('other window');
  await first.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [
    { range: { start: { line: 0, character: 13 }, end: { line: 0, character: 17 } }, text: '42' },
  ] });
  await expect.poll(() => diagnostics[0].find(d => d.version === 2)?.diagnostics, { timeout: 15_000 }).toEqual([]);
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
    c.onRequest('hang', () => new Promise(() => {}));
    c.onRequest('crash', () => process.exit(7));
    c.onRequest('shutdown', () => null);
    c.onNotification('exit', () => process.exit(0));
    c.listen();
  `);
  const failures: string[] = [];
  const server = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, message => failures.push(message));
  sessions.push(server);
  await server.ready;
  const token = new CancellationTokenSource();
  const pending = server.request('hang', {}, token);
  token.cancel();
  await expect(pending).rejects.toThrow(/cancelled/);
  await expect(server.request('hang', {}, undefined, 25)).rejects.toThrow(/cancelled|timed out/);
  await expect.poll(() => failures.length).toBe(1);
  await server.stop();
  await expect(server.request('hang', {})).rejects.toThrow(/stopped/);
  const crashed = new ServerSession({ executable: process.execPath, args: [fixture] }, root, () => {}, message => failures.push(message));
  sessions.push(crashed);
  await crashed.ready;
  await expect(crashed.request('crash', {})).rejects.toThrow();
  await expect.poll(() => failures.length).toBe(2);
});

test('watching a closed imported file refreshes analysis without overwriting the open buffer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-language-watch-'));
  roots.push(root);
  const dependency = path.join(root, 'dependency.py');
  await writeFile(dependency, 'value = 1\n');
  const uri = pathToFileURL(path.join(root, 'main.py')).href;
  const published: PublishDiagnosticsParams[] = [];
  const server = new ServerSession({ executable: process.execPath, args: [require.resolve('pyright/langserver.index.js'), '--stdio'] }, root,
    params => published.push(params), () => {});
  sessions.push(server);
  server.watch(root);
  await server.ready;
  await server.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1,
    text: 'from dependency import value\nresult: int = value\n' } });
  await expect.poll(() => published.at(-1)?.diagnostics, { timeout: 15_000 }).toEqual([]);
  published.length = 0;
  await writeFile(dependency, 'value = "changed on disk"\n');
  await expect.poll(() => published.at(-1)?.diagnostics.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(published.at(-1)?.version).toBe(1);
}, 25_000);
