import { expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import type { LanguageApi, LanguageEvent } from '../../protocol/language';
import { NotebookEntry } from './notebook-store';
import { emptyNotebook } from '../../core/notebook/notebook-document';
import { NotebookLanguage } from './notebook-language';

function fixture() {
  const providers = new Map<string, any>();
  const api = {
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    languages: new Proxy({}, { get: (_target, key) => key === 'CompletionItemKind' ? { Method: 1, Text: 0 }
      : (_selector: unknown, provider: unknown) => { providers.set(String(key), provider); return { dispose() {} }; } }),
    editor: { registerEditorOpener: () => ({ dispose() {} }), setModelMarkers: vi.fn() },
  } as unknown as typeof M;
  const entry = new NotebookEntry('nb', emptyNotebook(), emptyNotebook()), a = entry.document.add('code'), b = entry.document.add('code');
  entry.document.setSource(a, 'numbers = [1, 2, 3]'); entry.document.setSource(b, 'numbers.');
  const model = { isDisposed: () => false, getValue: () => entry.document.cells[1].source,
    getWordUntilPosition: () => ({ startColumn: 9, endColumn: 9, word: '' }), dispose() {} } as unknown as M.editor.ITextModel;
  entry.models.set(b, model);
  let event: (event: LanguageEvent) => void = () => {};
  const port = { open: vi.fn(async () => ({ uri: 'file:///project/notebook.ipynb', cells: { [a]: 'vscode-notebook-cell:/project/notebook.ipynb#a', [b]: 'vscode-notebook-cell:/project/notebook.ipynb#b' }, capabilities: {
    renameProvider: true, codeActionProvider: true, completionProvider: { triggerCharacters: ['.', ':'], resolveProvider: true }, hoverProvider: true, textDocumentSync: 1 }, server: 'notebook-python' })),
    change: vi.fn(async () => {}), changeNotebook: vi.fn(async () => ({ [a]: 'vscode-notebook-cell:/project/notebook.ipynb#a', [b]: 'vscode-notebook-cell:/project/notebook.ipynb#b' })), close: vi.fn(), releaseItems: vi.fn(), cancel: vi.fn(), request: vi.fn(async (): Promise<unknown> => []),
    onEvent: (listener: typeof event) => { event = listener; return () => {}; } } as unknown as LanguageApi;
  const client = new NotebookLanguage(api, port, entry, '/project/notebook.ipynb', () => {}, async () => {}, async () => {});
  const token: M.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const complete = (triggerKind = 1) => providers.get('registerCompletionItemProvider').provideCompletionItems(model, { lineNumber: 1, column: 9 }, { triggerKind, triggerCharacter: ':' }, token);
  return { api, entry, a, b, port, client, complete, providers, token, event: (value: LanguageEvent) => event(value) };
}
test('notebook completion flushes native cells and preserves local coordinates after earlier edits', async () => {
  const f = fixture(); await vi.waitFor(() => expect(f.port.open).toHaveBeenCalledOnce()); await Promise.resolve();
  f.entry.document.setSource(f.a, '\nnumbers = [1, 2, 3]');
  vi.mocked(f.port.request).mockResolvedValue([{ label: 'append', kind: 2, textEdit: { range: {
    start: { line: 0, character: 8 }, end: { line: 0, character: 8 } }, newText: 'append' } }]);
  const result = await f.complete();
  expect(f.port.changeNotebook).toHaveBeenCalledWith(expect.any(String), 2, [
    { id: f.a, version: f.entry.document.cells[0].version, text: '\nnumbers = [1, 2, 3]' },
    { id: f.b, version: f.entry.document.cells[1].version, text: 'numbers.' },
  ]);
  expect(f.port.request).toHaveBeenCalledWith(expect.any(String), 2, expect.any(String), 'textDocument/completion',
    expect.objectContaining({ cell: f.b, position: { line: 0, character: 8 } }));
  expect(result.suggestions[0].label).toBe('append');
  expect(result.suggestions[0].range).toEqual({ startLineNumber: 1, startColumn: 9, endLineNumber: 1, endColumn: 9 });
  f.client.dispose(); f.entry.dispose();
});
test('kernel output does not invalidate Python requests and rescanning preserves a healthy connection', async () => {
  const f = fixture(); await Promise.resolve(); await Promise.resolve();
  f.entry.document.setExecution(f.a, [{ output_type: 'stream', name: 'stdout', text: 'value' }], 1, 'numbers = [1, 2, 3]');
  f.event({ type: 'discovery' }); await f.complete();
  expect(f.port.open).toHaveBeenCalledOnce(); expect(f.port.changeNotebook).not.toHaveBeenCalled();
  f.event({ type: 'configuration', servers: ['clangd'] }); expect(f.port.open).toHaveBeenCalledOnce();
  f.client.dispose(); f.entry.dispose();
});
test('an edit in an earlier cell invalidates a late response and cross-cell edits are rejected', async () => {
  const f = fixture(); await Promise.resolve(); await Promise.resolve();
  let finish!: (value: unknown) => void;
  vi.mocked(f.port.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.complete(); await vi.waitFor(() => expect(f.port.request).toHaveBeenCalledOnce());
  f.entry.document.setSource(f.a, '# new line\nnumbers = []'); finish([{ label: 'stale' }]);
  expect(await pending).toBeUndefined();
  vi.mocked(f.port.request).mockResolvedValue([{ label: 'cross-cell edit', textEdit: { range: {
    start: { line: 0, character: 0 }, end: { line: 4, character: 1 } }, newText: 'destroy cells' } }]);
  expect((await f.complete()).suggestions).toEqual([]); f.client.dispose(); f.entry.dispose();
});

test('cell-local UTF-16 diagnostics never survive a dependency revision or failed connection', async () => {
  const f = fixture(); await Promise.resolve(); await Promise.resolve();
  f.entry.document.setSource(f.b, 'label = "🙂"'); await f.complete();
  const { id, generation } = vi.mocked(f.port.open).mock.calls[0][0];
  const cell = f.entry.document.cells.find(cell => cell.id === f.b)!;
  const event: LanguageEvent = { type: 'diagnostics', id, generation, version: 2, cell: f.b, cellVersion: cell.version,
    diagnostics: [{ range: { start: { line: 0, character: 9 }, end: { line: 0, character: 11 } }, severity: 1, message: 'test marker' }] };
  f.event(event);
  expect(f.api.editor.setModelMarkers).toHaveBeenLastCalledWith(f.entry.models.get(f.b), 'notebook-language', [expect.objectContaining({ startColumn: 10, endColumn: 12 })]);
  f.entry.document.setSource(f.a, 'numbers = []'); f.event(event);
  expect(f.api.editor.setModelMarkers).toHaveBeenLastCalledWith(f.entry.models.get(f.b), 'notebook-language', []);
  f.event({ ...event, version: 3 }); expect(vi.mocked(f.api.editor.setModelMarkers).mock.calls.at(-1)![2]).toHaveLength(1);
  f.event({ type: 'status', documents: [{ id, generation }], state: 'failed' });
  expect(f.api.editor.setModelMarkers).toHaveBeenLastCalledWith(f.entry.models.get(f.b), 'notebook-language', []);
  f.client.dispose(); f.entry.dispose();
});

test('rename applies cell-local edits atomically and a code action expires after another source edit', async () => {
  const f = fixture(); await Promise.resolve(); await Promise.resolve();
  const changes = { 'vscode-notebook-cell:/project/notebook.ipynb#a': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } }, newText: 'values' }],
    'vscode-notebook-cell:/project/notebook.ipynb#b': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } }, newText: 'values' }] };
  vi.mocked(f.port.request).mockResolvedValue({ changes }); await f.client.rename(f.b, 2, 'values');
  expect(f.entry.document.cells.map(cell => cell.source)).toEqual(['values = [1, 2, 3]', 'values.']);
  f.entry.document.undo(); expect(f.entry.document.cells[0].source).toBe('numbers = [1, 2, 3]');
  vi.mocked(f.port.request).mockResolvedValue([{ title: 'Safe edit', edit: { changes } }, { title: 'Unsafe command', command: { command: 'execute', title: 'execute' } }]);
  const actions = await f.client.actions(f.b, 2); expect(actions).toHaveLength(1);
  f.entry.document.setSource(f.a, 'numbers = []'); expect(() => actions[0].apply()).toThrow(/changed/); expect(f.entry.document.cells[1].source).toBe('numbers.');
  f.client.dispose(); f.entry.dispose();
});

test('notebook completion negotiates triggers, translates all trigger kinds and resolves server items', async () => {
  const f = fixture(); await Promise.resolve(); await Promise.resolve();
  const provider = f.providers.get('registerCompletionItemProvider');
  expect(provider.triggerCharacters).toEqual(['.', ':']);
  const raw = { label: 'append', data: { opaque: 7 }, $setdownItem: 'list-handle' };
  vi.mocked(f.port.request).mockResolvedValue([raw]);
  for (const kind of [0, 1, 2]) {
    const result = await f.complete(kind);
    expect(f.port.request).toHaveBeenLastCalledWith(expect.any(String), 1, expect.any(String), 'textDocument/completion',
      expect.objectContaining({ context: { triggerKind: kind + 1, triggerCharacter: ':' } }));
    result.dispose();
  }
  const result = await f.complete();
  vi.mocked(f.port.request).mockResolvedValue({ ...raw, detail: 'resolved documentation', $setdownItem: 'resolved-handle', additionalTextEdits: [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '# import\n' },
  ] });
  const resolved = await provider.resolveCompletionItem(result.suggestions[0], f.token);
  expect(f.port.request).toHaveBeenLastCalledWith(expect.any(String), 1, expect.any(String), 'completionItem/resolve', { ...raw, cell: f.b });
  expect(resolved.detail).toBe('resolved documentation'); expect(resolved.additionalTextEdits).toHaveLength(1);
  result.dispose(); expect(f.port.releaseItems).toHaveBeenLastCalledWith(expect.any(String), ['list-handle', 'resolved-handle']);
  f.client.dispose(); f.entry.dispose();
});

test('notebook resolve refuses stale results, cross-cell edits, commands and disposed-list responses', async () => {
  const f = fixture(); await Promise.resolve(); await Promise.resolve();
  const provider = f.providers.get('registerCompletionItemProvider');
  vi.mocked(f.port.request).mockResolvedValue([{ label: 'append', $setdownItem: 'initial' }]);
  const result = await f.complete(), item = result.suggestions[0];
  vi.mocked(f.port.request).mockResolvedValue({ label: 'append', additionalTextEdits: [
    { range: { start: { line: 4, character: 0 }, end: { line: 4, character: 0 } }, newText: 'outside' },
  ] });
  expect((await provider.resolveCompletionItem(item, f.token)).additionalTextEdits ?? []).toEqual([]);
  vi.mocked(f.port.request).mockResolvedValue({ label: 'unsafe', command: { command: 'run', title: 'Run' } });
  expect((await provider.resolveCompletionItem(item, f.token)).label).toBe('append');
  let finish!: (value: unknown) => void;
  vi.mocked(f.port.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = provider.resolveCompletionItem(item, f.token);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  result.dispose(); finish({ label: 'late', $setdownItem: 'late' });
  expect((await pending).label).toBe('append');
  expect(f.port.releaseItems).toHaveBeenLastCalledWith(expect.any(String), ['late']);
  const calls = vi.mocked(f.port.request).mock.calls.length;
  f.entry.document.setSource(f.a, '# dependency changed');
  expect((await provider.resolveCompletionItem(item, f.token)).additionalTextEdits).toBeUndefined();
  expect(f.port.request).toHaveBeenCalledTimes(calls);
  f.client.dispose(); f.entry.dispose();
});
