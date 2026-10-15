import { afterEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CompletionList, Hover, Location, PublishDiagnosticsParams, WorkspaceEdit } from 'vscode-languageserver-protocol';
import { ServerSession } from './server-session';
import { clangdArgs, serverProfiles } from './server-definitions';

const roots: string[] = [], servers: ServerSession[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
test('real clangd uses build flags, isolates buffers, and supplies C++ navigation and edits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-clangd-rpc-')); roots.push(root);
  await mkdir(path.join(root, 'include'));
  const file = path.join(root, 'main.cpp'), header = path.join(root, 'include', 'helper.hpp');
  await writeFile(header, 'inline int helper(int value) { return value + BUILD_VALUE + CONFIG_VALUE; }\n');
  await writeFile(path.join(root, '.clangd'), 'CompileFlags:\n  Add: [-DCONFIG_VALUE=9]\n');
  await writeFile(path.join(root, 'compile_commands.json'), JSON.stringify([{ directory: root, file,
    arguments: ['clang++', '-Iinclude', '-DBUILD_VALUE=7', '-std=c++20', '-c', file] }]));
  const source = '#include "helper.hpp"\nint greeting(int value) { return helper(value); }\nint main() { return greeting(3); }\n';
  await writeFile(file, source);
  const uri = pathToFileURL(file).href;
  const published: PublishDiagnosticsParams[][] = [[], []], failures: string[] = [];
  const create = (index: number) => {
    const server = new ServerSession({ executable: process.env.SETDOWN_CLANGD_PATH || 'clangd', args: clangdArgs }, root,
      params => published[index].push(params), message => failures.push(message), serverProfiles.clangd);
    servers.push(server); return server;
  };
  const first = create(0), second = create(1);
  const [capabilities] = await Promise.all([first.ready, second.ready]);
  expect(capabilities.completionProvider?.triggerCharacters).toContain('>');
  expect(capabilities.completionProvider?.resolveProvider).not.toBe(true);
  await first.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'cpp', version: 1, text: source } });
  await second.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'cpp', version: 1,
    text: source + 'int invalid = "wrong";\n' } });
  await expect.poll(() => published[0].find(p => p.uri === uri && p.version === 1)?.diagnostics, { timeout: 15_000 }).toEqual([]);
  await expect.poll(() => published[1].find(p => p.uri === uri && p.version === 1)?.diagnostics.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const hover = await first.request<Hover>('textDocument/hover', { textDocument: { uri }, position: { line: 1, character: 5 } });
  expect(JSON.stringify(hover)).toContain('greeting');
  const definition = await first.request<Location[]>('textDocument/definition', { textDocument: { uri }, position: { line: 1, character: 34 } });
  expect(definition.some(location => location.uri === pathToFileURL(header).href)).toBe(true);
  const references = await first.request<Location[]>('textDocument/references', { textDocument: { uri }, position: { line: 1, character: 5 }, context: { includeDeclaration: true } });
  expect(references.filter(location => location.uri === uri)).toHaveLength(2);
  const renamed = await first.request<WorkspaceEdit>('textDocument/rename', { textDocument: { uri }, position: { line: 1, character: 5 }, newName: 'welcome' });
  expect(JSON.stringify(renamed)).toContain('welcome');
  // UTF-16 offsets after an astral character must not corrupt incremental edits.
  const unicode = 'int number = /*😄*/"wrong";\r\n';
  await second.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: unicode }] });
  await expect.poll(() => published[1].find(p => p.uri === uri && p.version === 2)?.diagnostics.length, { timeout: 15_000 }).toBeGreaterThan(0);
  await second.notify('textDocument/didChange', { textDocument: { uri, version: 3 }, contentChanges: [
    { range: { start: { line: 0, character: unicode.indexOf('"wrong"') }, end: { line: 0, character: unicode.indexOf('"wrong"') + 7 } }, text: '42' },
  ] });
  await expect.poll(() => published[1].find(p => p.uri === uri && p.version === 3)?.diagnostics, { timeout: 15_000 }).toEqual([]);
  const completing = source + 'int test() { return greet; }\n';
  await first.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: completing }] });
  const items = await first.request<CompletionList>('textDocument/completion', { textDocument: { uri }, position: { line: 3, character: 25 }, context: { triggerKind: 1 } });
  expect(items.items.some(item => item.label.includes('greeting'))).toBe(true);
  expect(failures).toEqual([]);
}, 30_000);
