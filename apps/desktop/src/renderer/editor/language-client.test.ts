import { expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import type { LanguageApi, LanguageDocument, LanguageEvent } from '../../protocol/language';
import { createWorkspaceTab } from '../../core/workspace/workspace-state';
import { LanguageClient } from './language-client';
import { languageSupport, type LanguageRoute } from '../../core/document/language-support';
import { fromRange, markdown, toRange } from './language-conversion';

function fixture(file = '/project/main.py', capabilities: import('vscode-languageserver-protocol').ServerCapabilities = { hoverProvider: true, textDocumentSync: 2 }, routes?: LanguageRoute[]) {
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
  const port: LanguageApi = { changeNotebook: vi.fn(async () => ({})), editApplied: vi.fn(),
    open: vi.fn(async document => { opened.push(document); return { uri: 'file:///project/main.py', capabilities }; }),
    change: vi.fn(async () => {}), close: vi.fn(), saved: vi.fn(), cancel: vi.fn(), restart: vi.fn(async () => {}), configuration: vi.fn(async () => []), catalog: vi.fn(async () => ({ release: '', entries: [] })),
    rescan: vi.fn(async () => {}), useAutomatic: vi.fn(async () => {}), selectCandidate: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => {}), chooseExecutable: vi.fn(async () => false), configure: vi.fn(async () => {}),
    addConnection: vi.fn(async () => false), importDefinition: vi.fn(async () => false), remove: vi.fn(async () => {}), openHomepage: vi.fn(async () => {}),
    request: vi.fn(async () => null), onEvent: callback => { event = callback; return () => {}; },
  };
  const client = new LanguageClient(api, { port, route: file => languageSupport(file, routes), prepare: async () => ({ tab, model }), open: async () => {}, status: vi.fn() });
  const change = (changes: Partial<M.editor.IModelContentChange>[]) => {
    version++;
    listener?.({ changes, versionId: version, isFlush: false, isEolChange: false } as M.editor.IModelContentChangedEvent);
  };
  return { client, api, model, tab, port, event: (value: LanguageEvent) => event(value), opened, change, hover, providers };
}
const token: M.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

test('an absent automatic server leaves editing usable and rescanning connects the latest model once', async () => {
  const f = fixture();
  vi.mocked(f.port.open).mockResolvedValueOnce({ unavailable: 'missing' });
  f.client.bind(f.tab, f.model);
  await vi.waitFor(() => expect(f.port.open).toHaveBeenCalledOnce());
  await new Promise(resolve => setTimeout(resolve, 0));
  f.change([{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'new', rangeOffset: 0 }]);
  expect(f.port.change).not.toHaveBeenCalled();
  f.client.retryUnavailable();
  await vi.waitFor(() => expect(f.opened).toHaveLength(1));
  expect(f.opened[0].version).toBe(2);
  f.client.retryUnavailable();
  expect(f.port.open).toHaveBeenCalledTimes(2); // A healthy/in-flight connection survives another scan.
  f.client.invalidate(['clangd']); expect(f.port.close).toHaveBeenCalledTimes(1);
  f.client.invalidate(['pyright']); expect(f.port.close).toHaveBeenCalledTimes(2);
  f.client.dispose();
});

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

test('save preparation does not wait for pending server initialization', async () => {
  const f = fixture();
  let finish!: (value: Awaited<ReturnType<LanguageApi['open']>>) => void;
  vi.mocked(f.port.open).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  f.client.bind(f.tab, f.model);
  await f.client.beforeSave(f.model);
  expect(f.port.request).not.toHaveBeenCalled();
  finish({ unavailable: 'missing' });
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


test('a custom route uses negotiated Full sync for the exact revisions queued before and after initialization', async () => {
  const f = fixture('/project/file.custom', { textDocumentSync: { openClose: true, change: 1, save: { includeText: true } } },
    [{ server: 'unknown-to-core', languageId: 'custom', extensions: ['.custom'] }]);
  let text = 'initial'; f.model.getValue = () => text;
  f.client.bind(f.tab, f.model);
  const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 };
  text = 'revision two'; f.change([{ range, rangeOffset: 0, text: 'ignored partial' }]);
  text = 'revision three'; f.change([{ range, rangeOffset: 0, text: 'also partial' }]);
  await vi.waitFor(() => expect(f.port.change).toHaveBeenCalledTimes(2));
  expect(vi.mocked(f.port.change).mock.calls).toEqual([
    ['tab-1', 2, [{ text: 'revision two' }]], ['tab-1', 3, [{ text: 'revision three' }]],
  ]);
  text = 'revision four'; f.change([{ range, rangeOffset: 0, text: 'partial' }]);
  f.client.saved(f.model, 'actual saved snapshot');
  await vi.waitFor(() => expect(f.port.saved).toHaveBeenCalledWith('tab-1', 'actual saved snapshot'));
  expect(vi.mocked(f.port.change).mock.calls[2]).toEqual(['tab-1', 4, [{ text: 'revision four' }]]);
  f.client.dispose();
});

test('no-sync servers only advance local response fences; configuration events are not diagnostics', async () => {
  const f = fixture('/project/main.py', {}); f.client.bind(f.tab, f.model);
  f.change([{ range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 }, rangeOffset: 0, text: 'x' }]);
  await vi.waitFor(() => expect(f.port.change).toHaveBeenCalledWith('tab-1', 2, []));
  expect(() => f.event({ type: 'configuration' })).not.toThrow(); f.client.dispose();
});


test('document symbols accept both hierarchical and flat protocol results', async () => {
  const f = fixture('/project/main.py', { documentSymbolProvider: true });
  f.client.bind(f.tab, f.model);
  await vi.waitFor(() => expect(f.providers.has('registerDocumentSymbolProvider')).toBe(true));
  const range = { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } };
  vi.mocked(f.port.request).mockResolvedValue([
    { name: 'flat', kind: 12, containerName: 'module', location: { uri: 'file:///project/main.py', range } },
    { name: 'foreign', kind: 12, location: { uri: 'file:///project/other.py', range } },
    { name: 'tree', kind: 12, range, selectionRange: range, children: [{ name: 'child', kind: 13, range, selectionRange: range }] },
  ]);
  const symbols = await f.providers.get('registerDocumentSymbolProvider').provideDocumentSymbols(f.model, token);
  expect(symbols.map((symbol: M.languages.DocumentSymbol) => symbol.name)).toEqual(['flat', 'tree']);
  expect(symbols[0]).toMatchObject({ detail: 'module', range: fromRange(range), selectionRange: fromRange(range) });
  expect(symbols[1].children[0].name).toBe('child');
  f.client.dispose();
});

test('configuration invalidates the server actually selected by discovery rather than a missing route alternative', async () => {
  const f = fixture('/project/main.ts', { hoverProvider: true }, [{ server: 'missing-alternative', languageId: 'typescript', extensions: ['.ts'] }]);
  vi.mocked(f.port.open).mockResolvedValue({ uri: 'file:///project/main.ts', server: 'installed-primary', capabilities: { hoverProvider: true } });
  f.client.bind(f.tab, f.model);
  await vi.waitFor(() => expect(f.hover.current).toBeDefined());
  f.client.invalidate(['unrelated']); expect(f.port.close).not.toHaveBeenCalled();
  f.client.invalidate(['installed-primary']); expect(f.port.close).toHaveBeenCalledWith(f.tab.id);
  f.client.dispose();
});
