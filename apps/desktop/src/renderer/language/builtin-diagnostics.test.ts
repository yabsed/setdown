import { afterEach, expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import type { Diagnostic } from 'vscode-languageserver-protocol';
import { builtinSupport, installBuiltinDiagnostics, ownLanguageDiagnostics } from './builtin-diagnostics';
import { diagnosticsFor } from './diagnostic-store';
import { scriptKindForResource } from './typescript-resource';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.useRealTimers(); });
const diagnostic = (message: string, code: number | string = 1): Diagnostic => ({ message, code, severity: 1,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } });
function fixture(languages: string[], validate: (model: M.editor.ITextModel) => Promise<Diagnostic[]>) {
  vi.useFakeTimers();
  const changes = new Set<() => void>();
  const defaults = () => ({ modeConfiguration: {}, setModeConfiguration: vi.fn(), setDiagnosticsOptions: vi.fn(),
    getCompilerOptions: () => ({}), setCompilerOptions: vi.fn(), onDidChange: (fn: () => void) => { changes.add(fn); return { dispose: () => changes.delete(fn) }; } });
  const models = languages.map((language, index) => {
    let version = 1, disposed = false;
    const listeners = new Set<() => void>(), disposing = new Set<() => void>();
    const model = { uri: { fsPath: `/test-${index}.${language}`, toString: () => `file:///test-${index}.${language}?tab` }, getLanguageId: () => language,
      getVersionId: () => version, isDisposed: () => disposed,
      onDidChangeContent: (fn: () => void) => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
      onWillDispose: (fn: () => void) => { disposing.add(fn); return { dispose: () => disposing.delete(fn) }; },
    } as unknown as M.editor.ITextModel;
    cleanup.push(() => { disposing.forEach(fn => fn()); disposed = true; });
    return { model, edit: () => { version++; listeners.forEach(fn => fn()); } };
  });
  const api = { editor: { onDidCreateModel: vi.fn(), getModels: () => models.map(m => m.model), onDidChangeModelLanguage: () => ({ dispose() {} }), setModelMarkers: vi.fn() },
    typescript: { typescriptDefaults: defaults(), javascriptDefaults: defaults(), JsxEmit: { Preserve: 1 } }, json: { jsonDefaults: defaults() },
    css: { cssDefaults: defaults(), scssDefaults: defaults(), lessDefaults: defaults() }, MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 }, MarkerTag: {},
  } as unknown as typeof M;
  installBuiltinDiagnostics(api, validate);
  return { api, models, entries: () => diagnosticsFor(api).entries(), configure: () => changes.forEach(fn => fn()) };
}

test('local validation is capability-based: HTML and grammar-only languages never claim code checks', async () => {
  const validate = vi.fn(async () => [diagnostic('Real syntax error')]);
  const f = fixture(['json', 'css', 'html', 'python', 'plaintext'], validate);
  await vi.advanceTimersByTimeAsync(180);
  expect(validate).toHaveBeenCalledTimes(2);
  expect(f.entries().map(entry => entry.item.message)).toEqual(['Real syntax error', 'Real syntax error']);
  expect(builtinSupport(f.models[2].model)).toMatchObject({ checks: 'none', features: ['Completion', 'Hover', 'Formatting'] });
  expect(builtinSupport(f.models[3].model)).toMatchObject({ checks: 'none', features: [] });
});

test('a formatter does not steal diagnostics; a known analysis provider owns only its document and release revalidates safely', async () => {
  const validate = vi.fn(async () => [diagnostic('Syntax error')]);
  const f = fixture(['json', 'json'], validate);
  await vi.advanceTimersByTimeAsync(180);
  const formatter = ownLanguageDiagnostics(f.api, f.models[0].model, 'my-formatter');
  expect(f.entries()).toHaveLength(2);
  const analysis = ownLanguageDiagnostics(f.api, f.models[0].model, 'json-lsp');
  expect(f.entries()).toHaveLength(1);
  expect(f.entries()[0].model).toBe(f.models[1].model);
  analysis.dispose(); formatter.dispose();
  await vi.advanceTimersByTimeAsync(180);
  expect(f.entries()).toHaveLength(2);
});

test('late results are rejected after edits and configuration changes even when the text version is unchanged', async () => {
  const pending: ((diagnostics: Diagnostic[]) => void)[] = [];
  const f = fixture(['css'], () => new Promise(resolve => pending.push(resolve)));
  await vi.advanceTimersByTimeAsync(180);
  f.models[0].edit(); await vi.advanceTimersByTimeAsync(180);
  pending[1]([diagnostic('Current error')]); await Promise.resolve();
  pending[0]([diagnostic('Stale error')]); await Promise.resolve();
  expect(f.entries().map(entry => entry.item.message)).toEqual(['Current error']);
  f.configure(); await vi.advanceTimersByTimeAsync(180);
  f.configure(); pending[2]([diagnostic('Old configuration')]); await Promise.resolve();
  expect(f.entries()).toEqual([]);
  await vi.advanceTimersByTimeAsync(180); pending[3]([diagnostic('New configuration')]); await Promise.resolve();
  expect(f.entries().map(entry => entry.item.message)).toEqual(['New configuration']);
});

test('JSON schema resolution failures become service state while genuine syntax/schema violations remain', async () => {
  const f = fixture(['json'], async () => [diagnostic('Unavailable schema', 768), diagnostic('Value expected', 516), diagnostic('Expected number', 0)]);
  await vi.advanceTimersByTimeAsync(180);
  expect(f.entries().map(entry => entry.item.message)).toEqual(['Value expected', 'Expected number']);
  expect(builtinSupport(f.models[0].model)).toMatchObject({ state: 'failed', message: 'Unavailable schema' });
});

test('query-bearing TSX/JSX resources retain their parser kind without changing model identity', () => {
  expect(scriptKindForResource('file:///project/main.tsx?tab-1')).toBe(4);
  expect(scriptKindForResource('file:///project/main.jsx?tab-2')).toBe(2);
  expect(scriptKindForResource('file:///project/main.mts?tab-1')).toBe(3);
  expect(scriptKindForResource('file:///project/main.cjs?tab-2')).toBe(1);
});
