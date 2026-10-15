import { expect, test } from 'vitest';
import { ServerCapabilitiesState } from './server-capabilities';
import { ServerItems } from './server-items';
import { clientCapabilities } from '../../protocol/language-features';

test('dynamic capabilities honor language, URI scheme and path and disappear on unregister', () => {
  const state = new ServerCapabilitiesState('/project');
  state.base = { hoverProvider: true };
  state.register([{ id: 'format-python', method: 'textDocument/formatting', registerOptions: {
    documentSelector: [{ language: 'python', scheme: 'file', pattern: '**/src/*.py' }], workDoneProgress: true,
  } }]);
  expect(state.forDocument('file:///project/src/main.py', 'python')).toMatchObject({ hoverProvider: true, documentFormattingProvider: { workDoneProgress: true } });
  expect(state.forDocument('file:///project/test/main.py', 'python').documentFormattingProvider).toBeUndefined();
  expect(state.forDocument('file:///project/src/main.py', 'cpp').documentFormattingProvider).toBeUndefined();
  state.unregister(['format-python']);
  expect(state.forDocument('file:///project/src/main.py', 'python')).toEqual({ hoverProvider: true });
  expect(() => state.register([{ id: 'unsupported', method: 'notebookDocument/sync' }])).toThrow(/Unsupported/);
  expect(clientCapabilities().workspace?.workspaceEdit?.resourceOperations).toEqual([]);
});

test('relative file watchers honor operation masks and stay inside their base directory', () => {
  const state = new ServerCapabilitiesState('/project');
  state.register([{ id: 'watch', method: 'workspace/didChangeWatchedFiles', registerOptions: { watchers: [
    { globPattern: { baseUri: 'file:///project/src', pattern: '**/*.h' }, kind: 2 },
  ] } }]);
  expect(state.watches('/project/src/a.h', 2)).toBe(true);
  expect(state.watches('/project/src/a.h', 1)).toBe(false);
  expect(state.watches('/project/else/a.h', 2)).toBe(false);
  state.unregister(['watch']); expect(state.watches('/project/src/a.h', 2)).toBe(false);
});

test('static semantic registrations also honor their document selector', () => {
  const state = new ServerCapabilitiesState('/project');
  state.base = { semanticTokensProvider: { id: 'cpp-tokens', documentSelector: [{ language: 'cpp' }],
    legend: { tokenTypes: ['function'], tokenModifiers: [] }, full: true } };
  expect(state.forDocument('file:///project/main.cpp', 'cpp').semanticTokensProvider).toBeTruthy();
  expect(state.forDocument('file:///project/main.c', 'c').semanticTokensProvider).toBeUndefined();
});

test('opaque resolve and command handles retain server data and reject forgery, stale items and foreign documents', () => {
  const items = new ServerItems(), origin = { document: 'a', generation: 'first', version: 1 };
  const original = { title: 'Fix', data: { privateServerId: 42 }, command: { title: 'Apply', command: 'server.fix', arguments: ['owned'] } };
  const [action] = items.remember('textDocument/codeAction', [original], origin) as any[];
  expect(items.resolve('codeAction/resolve', { ...action, data: 'forged' }, origin)).toEqual(original);
  expect(() => items.resolve('codeAction/resolve', action, { ...origin, version: 2 })).toThrow(/Invalid/);
  expect(() => items.resolve('workspace/executeCommand', { command: 'arbitrary' }, origin)).toThrow(/Invalid/);
  expect(() => items.resolve('workspace/executeCommand', action.command, { ...origin, document: 'other' })).toThrow(/Invalid/);
  items.forget('a', false); // Applying a user-selected action changes the document before its command runs.
  expect(items.resolve('workspace/executeCommand', { ...action.command, arguments: ['injected'] }, { ...origin, version: 2 })).toEqual({ command: 'server.fix', arguments: ['owned'] });
  expect(() => items.resolve('workspace/executeCommand', action.command, origin)).toThrow(/Invalid/);
});

test('file-operation registrations filter both rename paths and file/folder kinds', async () => {
  const { filteredFileOperation } = await import('./file-operations');
  const state = new ServerCapabilitiesState('/project');
  state.base = { workspace: { fileOperations: { didRename: { filters: [{ pattern: { glob: '**/*.py' } }] } } } };
  expect(state.fileOperation('workspace/didRenameFiles')).toEqual([{ filters: [{ pattern: { glob: '**/*.py' } }] }]);
  state.register([{ id: 'rename', method: 'workspace/willRenameFiles', registerOptions: { filters: [{ scheme: 'file', pattern: { glob: '**/*.PY', matches: 'file', options: { ignoreCase: true } } }] } }]);
  const result = filteredFileOperation({ kind: 'rename', files: [
    { path: '/project/source.txt', to: '/project/main.py', directory: false },
    { path: '/project/folder.py', to: '/project/new.py', directory: true },
  ] }, state.fileOperation('workspace/willRenameFiles'));
  expect(result.files).toEqual([{ oldUri: 'file:///project/source.txt', newUri: 'file:///project/main.py' }]);
});
