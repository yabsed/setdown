import { expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import type * as L from 'vscode-languageserver-protocol';
import { installSemanticFeatures, semanticData } from './language-semantic-features';
import { installNavigationFeatures } from './language-navigation-features';
import { installEditFeatures } from './language-edit-features';
import type { LanguageCapabilities } from '../../protocol/language';
import { installPullDiagnostics } from './language-diagnostics';
import { completionDefaults } from './language-conversion';
import { noCancellation, type LanguageFeatureContext } from './language-feature-context';

function fixture(capabilities: LanguageCapabilities) {
  const providers: Record<string, any> = {}, listeners = new Map<string, Set<() => void>>(), disposables: M.IDisposable[] = [];
  let version = 1;
  const api = { languages: new Proxy({ FoldingRangeKind: { Comment: 'comment', Imports: 'imports', Region: 'region' } }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : (_selector: unknown, provider: unknown) => { providers[String(key)] = provider; return { dispose() {} }; },
  }), Uri: { parse: (value: string) => ({ scheme: value.split(':')[0] }) } } as unknown as typeof M;
  const model = { getVersionId: () => version, onDidChangeContent: (fn: () => void) => { const set = listeners.get('change') ?? new Set(); set.add(fn); listeners.set('change', set); return { dispose: () => { set.delete(fn); } }; } } as M.editor.ITextModel;
  const context: LanguageFeatureContext = { api, model, capabilities, selector: 'test', scoped: p => p,
    add: (...items) => disposables.push(...items), request: vi.fn(async () => null), uri: value => value as unknown as M.Uri,
    alive: v => v === version, onRefresh: (feature, fn) => { const set = listeners.get(feature) ?? new Set(); set.add(fn); listeners.set(feature, set); return { dispose: () => { set.delete(fn); } }; },
    diagnostics: () => [], snapshot: () => new Map([[model, version]]), edit: vi.fn(async () => ({ edits: [] })), apply: vi.fn(),
    command: vi.fn(() => ({ id: 'local-command', title: 'owned command' })), action: vi.fn(() => ({ id: 'local-action', title: 'owned action' })),
  };
  return { context, providers, request: vi.mocked(context.request), emit: (type: string) => { for (const fn of listeners.get(type) ?? []) fn(); },
    change: () => { version++; for (const fn of listeners.get('change') ?? []) fn(); }, dispose: () => disposables.forEach(d => d.dispose()) };
}

test('semantic full, delta, release and refresh use independent cached result IDs and Uint32Arrays', async () => {
  const f = fixture({ semanticTokensProvider: { legend: { tokenTypes: ['function'], tokenModifiers: [] }, full: { delta: true }, range: true } });
  installSemanticFeatures(f.context);
  const provider = f.providers.registerDocumentSemanticTokensProvider;
  f.request.mockResolvedValueOnce({ resultId: 'one', data: [0, 0, 3, 0, 0] });
  expect((await provider.provideDocumentSemanticTokens(f.context.model, null, noCancellation)).data).toEqual(new Uint32Array([0, 0, 3, 0, 0]));
  f.request.mockResolvedValueOnce({ resultId: 'two', edits: [{ start: 0, deleteCount: 5, data: [0, 1, 3, 0, 0] }] });
  expect((await provider.provideDocumentSemanticTokens(f.context.model, 'one', noCancellation)).edits[0].data).toBeInstanceOf(Uint32Array);
  expect(f.request).toHaveBeenLastCalledWith('textDocument/semanticTokens/full/delta', { previousResultId: 'one' }, noCancellation);
  f.emit('semanticTokens');
  await provider.provideDocumentSemanticTokens(f.context.model, 'two', noCancellation);
  expect(f.request).toHaveBeenLastCalledWith('textDocument/semanticTokens/full', {}, noCancellation);
  provider.releaseDocumentSemanticTokens('two');
  expect(() => semanticData([0, -1])).toThrow(/Invalid/);
  f.dispose();
});

test('navigation converts location links, highlight kinds, nested selections and blocks command URLs', async () => {
  const f = fixture({ implementationProvider: true, documentHighlightProvider: true, selectionRangeProvider: true, documentLinkProvider: { resolveProvider: true } });
  installNavigationFeatures(f.context);
  const range = { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } };
  f.request.mockResolvedValueOnce([{ range, kind: 3 }]);
  expect(await f.providers.registerDocumentHighlightProvider.provideDocumentHighlights(f.context.model, { lineNumber: 1, column: 3 }, noCancellation)).toEqual([{ range: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 6 }, kind: 2 }]);
  f.request.mockResolvedValueOnce([{ range, parent: { range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } } } }]);
  expect((await f.providers.registerSelectionRangeProvider.provideSelectionRanges(f.context.model, [{ lineNumber: 1, column: 3 }], noCancellation))[0]).toHaveLength(2);
  f.request.mockResolvedValueOnce([{ range, target: 'command:workbench.run' }]);
  expect((await f.providers.registerLinkProvider.provideLinks(f.context.model, noCancellation)).links[0].url).toBeUndefined();
});

test('an invalid semantic delta recovers with one full response instead of retaining its corrupt base', async () => {
  const f = fixture({ semanticTokensProvider: { legend: { tokenTypes: ['function'], tokenModifiers: [] }, full: { delta: true } } });
  installSemanticFeatures(f.context);
  const provider = f.providers.registerDocumentSemanticTokensProvider;
  f.request.mockResolvedValueOnce({ resultId: 'base', data: [0, 0, 3, 0, 0] });
  await provider.provideDocumentSemanticTokens(f.context.model, null, noCancellation);
  f.request.mockResolvedValueOnce({ resultId: 'broken', edits: [{ start: 6, deleteCount: 5 }] });
  f.request.mockResolvedValueOnce({ resultId: 'recovered', data: [0, 1, 3, 0, 0] });
  expect(await provider.provideDocumentSemanticTokens(f.context.model, 'base', noCancellation)).toEqual({ resultId: 'recovered', data: new Uint32Array([0, 1, 3, 0, 0]) });
  expect(f.request).toHaveBeenLastCalledWith('textDocument/semanticTokens/full', {}, noCancellation);
  f.dispose();
});

test('code actions preserve raw diagnostic data and apply edits before their provenance-bound command', async () => {
  const f = fixture({ codeActionProvider: { resolveProvider: true } });
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  const diagnostic: L.Diagnostic = { range, message: 'Fix me', data: { fixId: 9 } };
  f.context.diagnostics = () => [diagnostic];
  let run: () => Promise<void> = async () => {};
  f.context.action = (_title, callback) => { run = callback; return { id: 'owned', title: 'Fix' }; };
  installEditFeatures(f.context);
  f.request.mockResolvedValueOnce([{ title: 'Fix', data: { fixId: 9 } }]);
  await f.providers.registerCodeActionProvider.provideCodeActions(f.context.model, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }, { trigger: 1 }, noCancellation);
  expect(f.request.mock.calls[0][1]).toMatchObject({ context: { diagnostics: [diagnostic] } });
  const edit = { changes: { 'file:///project/a.ts': [{ range, newText: 'fixed' }] } }, command = { title: 'After', command: 'server.after' };
  f.request.mockResolvedValueOnce({ title: 'Fix', edit, command });
  await run();
  expect(f.context.edit).toHaveBeenCalledWith(edit, expect.any(Map), noCancellation);
  expect(f.context.apply).toHaveBeenCalledOnce();
  expect(f.request).toHaveBeenLastCalledWith('workspace/executeCommand', command, noCancellation);
});

test('pull diagnostics are debounced, reuse result IDs, refresh and never publish after disposal', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture({ diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false } }), publish = vi.fn();
    f.request.mockResolvedValueOnce({ kind: 'full', resultId: 'one', items: [{ message: 'initial' }] });
    installPullDiagnostics(f.context, publish);
    f.change(); f.change();
    await vi.advanceTimersByTimeAsync(250);
    expect(f.request).toHaveBeenCalledOnce(); expect(publish).toHaveBeenLastCalledWith([{ message: 'initial' }]);
    f.request.mockResolvedValueOnce({ kind: 'unchanged', resultId: 'two' });
    f.emit('diagnostic'); await vi.advanceTimersByTimeAsync(250);
    expect(f.request.mock.calls[1][1]).toMatchObject({ previousResultId: 'one' });
    f.emit('diagnostic'); f.dispose(); await vi.advanceTimersByTimeAsync(500);
    expect(f.request).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

test('completion list defaults preserve per-item overrides and insert/replace ranges', () => {
  const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } };
  expect(completionDefaults({ label: 'call', textEditText: 'call($1)', data: 'own' }, { insertTextFormat: 2, editRange: { insert: range, replace: range }, data: 'default' }))
    .toMatchObject({ data: 'own', insertTextFormat: 2, textEdit: { insert: range, replace: range, newText: 'call($1)' } });
});

test('diagnostic providers retain separate result IDs, aggregate unchanged results and retire only removed providers', async () => {
  vi.useFakeTimers();
  try {
    const providers = ['types', 'lint'].map(id => ({ id, options: { identifier: id, interFileDependencies: false, workspaceDiagnostics: false } }));
    const f = fixture({ diagnosticProviders: providers }), publish = vi.fn(), cache = new Map();
    f.request.mockImplementation(async (_method, params: any) => ({ kind: 'full', resultId: `${params.identifier}-1`, items: [{ message: params.identifier }] }));
    installPullDiagnostics(f.context, publish, cache);
    await vi.advanceTimersByTimeAsync(250);
    expect(publish).toHaveBeenLastCalledWith([{ message: 'types' }, { message: 'lint' }]);
    f.request.mockImplementation(async (_method, params: any) => ({ kind: 'unchanged', resultId: `${params.identifier}-2` }));
    f.change(); await vi.advanceTimersByTimeAsync(250);
    expect(f.request.mock.calls.slice(-2).map(call => call[1])).toEqual([
      { identifier: 'types', previousResultId: 'types-1' }, { identifier: 'lint', previousResultId: 'lint-1' },
    ]);
    expect(publish).toHaveBeenLastCalledWith([{ message: 'types' }, { message: 'lint' }]);
    f.dispose(); f.context.capabilities = { diagnosticProviders: [providers[1]] };
    installPullDiagnostics(f.context, publish, cache);
    expect(publish).toHaveBeenLastCalledWith([{ message: 'lint' }]);
    await vi.advanceTimersByTimeAsync(250);
    expect(f.request).toHaveBeenLastCalledWith('textDocument/diagnostic', { identifier: 'lint', previousResultId: 'lint-2' }, noCancellation);
    f.dispose();
  } finally { vi.useRealTimers(); }
});
