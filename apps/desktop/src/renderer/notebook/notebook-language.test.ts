import { expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import type { LanguageApi, LanguageEvent } from '../../protocol/language';
import { NotebookEntry } from './notebook-store';
import { emptyNotebook } from '../../core/notebook/notebook-document';
import { NotebookLanguage } from './notebook-language';

function fixture() {
  const providers = new Map<string, any>();
  const api = {
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
  const port = { open: vi.fn(async () => ({ uri: 'file:///project/.projection.py', capabilities: {
    completionProvider: { triggerCharacters: ['.'] }, hoverProvider: true, textDocumentSync: 1 }, server: 'pyright' })),
    change: vi.fn(async () => {}), close: vi.fn(), cancel: vi.fn(), request: vi.fn(async (): Promise<unknown> => []),
    onEvent: (listener: typeof event) => { event = listener; return () => {}; } } as unknown as LanguageApi;
  const client = new NotebookLanguage(api, port, entry, '/project/notebook.ipynb', () => {}, async () => {}, async () => {});
  const token: M.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const complete = () => providers.get('registerCompletionItemProvider').provideCompletionItems(model, { lineNumber: 1, column: 9 }, { triggerKind: 1 }, token);
  return { api, entry, a, b, port, client, complete, event: (value: LanguageEvent) => event(value) };
}
test('notebook completion flushes the full Python projection and maps edits back to the cell', async () => {
  const f = fixture(); await vi.waitFor(() => expect(f.port.open).toHaveBeenCalledOnce()); await Promise.resolve();
  f.entry.document.setSource(f.a, '\nnumbers = [1, 2, 3]');
  vi.mocked(f.port.request).mockResolvedValue([{ label: 'append', kind: 2, textEdit: { range: {
    start: { line: 4, character: 8 }, end: { line: 4, character: 8 } }, newText: 'append' } }]);
  const result = await f.complete();
  expect(f.port.change).toHaveBeenCalledWith(expect.any(String), 2, [{ text: '\nnumbers = [1, 2, 3]\n\n\nnumbers.' }]);
  expect(f.port.request).toHaveBeenCalledWith(expect.any(String), 2, expect.any(String), 'textDocument/completion',
    expect.objectContaining({ position: { line: 4, character: 8 } }));
  expect(result.suggestions[0].label).toBe('append');
  expect(result.suggestions[0].range).toEqual({ startLineNumber: 1, startColumn: 9, endLineNumber: 1, endColumn: 9 });
  f.client.dispose(); f.entry.dispose();
});
test('kernel output does not invalidate Python requests and rescanning preserves a healthy connection', async () => {
  const f = fixture(); await Promise.resolve(); await Promise.resolve();
  f.entry.document.setExecution(f.a, [{ output_type: 'stream', name: 'stdout', text: 'value' }], 1, 'numbers = [1, 2, 3]');
  f.event({ type: 'discovery' }); await f.complete();
  expect(f.port.open).toHaveBeenCalledOnce(); expect(f.port.change).not.toHaveBeenCalled();
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
