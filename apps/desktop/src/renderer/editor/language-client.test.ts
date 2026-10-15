import { expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import type { LanguageApi, LanguageDocument, LanguageEvent } from '../../protocol/language';
import { createWorkspaceTab } from '../../core/workspace/workspace-state';
import { LanguageClient } from './language-client';
import { fromRange, markdown, toRange } from './language-conversion';

function fixture(file = '/project/main.py', capabilities: import('vscode-languageserver-protocol').ServerCapabilities = { hoverProvider: true }) {
  let version = 1;
  let listener: ((event: M.editor.IModelContentChangedEvent) => void) | undefined;
  let event: (event: LanguageEvent) => void = () => {};
  const opened: LanguageDocument[] = [];
  const hover: { current?: M.languages.HoverProvider } = {};
  const providers = new Map<string, any>();
  const dispose = () => {};
  const api = {
    languages: new Proxy({}, { get: (_target, key) => (_selector: unknown, provider: M.languages.HoverProvider) => {
      providers.set(String(key), provider);
      if (key === 'registerHoverProvider') hover.current = provider;
      return { dispose };
    } }),
    editor: { registerEditorOpener: () => ({ dispose }), setModelMarkers: vi.fn() },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 }, MarkerTag: { Unnecessary: 1, Deprecated: 2 },
  } as unknown as typeof M;
  const model = {
    uri: { fsPath: file, toString: () => `file://${file}?tab-1` },
    getValue: () => 'text', getVersionId: () => version, getLanguageId: () => file.endsWith('.py') ? 'python' : 'cpp', isDisposed: () => false,
    onDidChangeContent: (callback: typeof listener) => { listener = callback; return { dispose: () => { listener = undefined; } }; },
  } as unknown as M.editor.ITextModel;
  const tab = createWorkspaceTab('tab-1', { path: file, name: file.split('/').at(-1)!, text: 'text', savedText: 'text',
    revision: 0, savedRevision: 0, isUntitled: false, diskVersion: { mtimeMs: 0, size: 0 } }, 'editor',
  { sourceLine: 1, yRatio: .3, reason: 'empty-document', confidence: 'fallback' });
  const port: LanguageApi = {
    open: vi.fn(async document => { opened.push(document); return { uri: 'file:///project/main.py', capabilities }; }),
    change: vi.fn(async () => {}), close: vi.fn(), saved: vi.fn(), cancel: vi.fn(), restart: vi.fn(async () => {}), chooseClangd: vi.fn(async () => false),
    request: vi.fn(async () => null), onEvent: callback => { event = callback; return () => {}; },
  };
  const client = new LanguageClient(api, { port, prepare: async () => ({ tab, model }), open: async () => {}, status: vi.fn() });
  const change = (changes: Partial<M.editor.IModelContentChange>[]) => {
    version++;
    listener?.({ changes, versionId: version, isFlush: false, isEolChange: false } as M.editor.IModelContentChangedEvent);
  };
  return { client, api, model, tab, port, event: (value: LanguageEvent) => event(value), opened, change, hover, providers };
}
const token: M.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

test('retarget preserves the model and rejects diagnostics from the previous connection', async () => {
  const f = fixture();
  f.client.bind(f.tab, f.model);
  await vi.waitFor(() => expect(f.opened).toHaveLength(1));
  const previous = f.opened[0];
  f.tab.document = { ...f.tab.document, path: '/project/renamed.py' };
  f.client.bind(f.tab, f.model);
  await vi.waitFor(() => expect(f.opened).toHaveLength(2));
  expect(f.port.close).toHaveBeenCalledWith('tab-1');
  vi.mocked(f.api.editor.setModelMarkers).mockClear();
  f.event({ type: 'diagnostics', id: previous.id, generation: previous.generation, version: 1, diagnostics: [] });
  expect(f.api.editor.setModelMarkers).not.toHaveBeenCalled();
  f.event({ type: 'diagnostics', id: previous.id, generation: f.opened[1].generation, version: 1, diagnostics: [] });
  expect(f.api.editor.setModelMarkers).toHaveBeenCalledWith(f.model, 'setdown-language', []);
  f.client.dispose();
});

test('multi-cursor edits are sent in descending offsets before requests; late responses are ignored', async () => {
  const f = fixture();
  f.client.bind(f.tab, f.model);
  const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 2, endColumn: 2 };
  f.change([{ range, rangeOffset: 1, text: 'a' }, { range: { ...range, startColumn: 6, endColumn: 6 }, rangeOffset: 5, text: 'b' }]);
  await vi.waitFor(() => expect(f.port.change).toHaveBeenCalled());
  expect(vi.mocked(f.port.change).mock.calls[0][2].map(change => change.text)).toEqual(['b', 'a']);
  let resolve!: (value: unknown) => void;
  vi.mocked(f.port.request).mockImplementation(() => new Promise(done => { resolve = done; }));
  const pending = f.hover.current!.provideHover(f.model, { lineNumber: 1, column: 1 } as M.Position, token, { verbosityRequest: undefined });
  await vi.waitFor(() => expect(f.port.request).toHaveBeenCalled());
  f.change([{ range, rangeOffset: 1, text: 'new' }]);
  expect(f.port.cancel).toHaveBeenCalled();
  resolve({ contents: 'obsolete hover' });
  expect(await pending).toBeNull();
  f.client.dispose();
});

test('closing a document during restart cannot reopen it', async () => {
  const f = fixture();
  f.client.bind(f.tab, f.model);
  let finish!: () => void;
  vi.mocked(f.port.restart).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const restarting = f.client.restart();
  f.client.unbind(f.model);
  finish(); await restarting;
  expect(f.opened).toHaveLength(1);
  f.client.dispose();
});

test('saving and requesting while initialization fails leaves no rejected editor queue', async () => {
  const f = fixture();
  let reject!: (error: Error) => void;
  vi.mocked(f.port.open).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  f.client.bind(f.tab, f.model);
  f.client.saved(f.model);
  const pending = (f.client as any).request(f.model, 'textDocument/hover', {}, token);
  reject(new Error('Server failed to initialize.'));
  expect(await pending).toBeNull();
  expect(f.port.saved).not.toHaveBeenCalled();
  expect(f.port.request).not.toHaveBeenCalled();
  f.client.dispose();
});

test('UTF-16 ranges are lossless and server Markdown never grants HTML or command trust', () => {
  const range = { start: { line: 2, character: 5 }, end: { line: 4, character: 9 } };
  expect(toRange(fromRange(range))).toEqual(range);
  const rendered = markdown({ kind: 'markdown', value: '[run](command:malicious)<script>bad()</script>' });
  expect(rendered.isTrusted).toBe(false); expect(rendered.supportHtml).toBe(false);
  expect(markdown({ kind: 'plaintext', value: '**plain**' }).value).toBe('\\*\\*plain\\*\\*');
});


test('C++ providers use negotiated triggers, omit unsupported resolve and stay within their model', async () => {
  const f = fixture('/project/main.cpp', { completionProvider: { triggerCharacters: ['.', '>', ':'], resolveProvider: false }, hoverProvider: true });
  f.client.bind(f.tab, f.model);
  await vi.waitFor(() => expect(f.providers.has('registerCompletionItemProvider')).toBe(true));
  const completion = f.providers.get('registerCompletionItemProvider') as M.languages.CompletionItemProvider;
  expect(completion.triggerCharacters).toEqual(['.', '>', ':']);
  expect(completion.resolveCompletionItem).toBeUndefined();
  expect(f.providers.has('registerRenameProvider')).toBe(false);
  const other = { ...f.model };
  expect(await f.hover.current!.provideHover(other, { lineNumber: 1, column: 1 } as M.Position, token, { verbosityRequest: undefined })).toBeNull();
  expect(f.port.request).not.toHaveBeenCalled();
  await f.hover.current!.provideHover(f.model, { lineNumber: 1, column: 1 } as M.Position, token, { verbosityRequest: undefined });
  expect(f.port.request).toHaveBeenCalledOnce();
  f.client.dispose();
});
