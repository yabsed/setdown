import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import type { LanguageAutoInsert } from '../../protocol/language';
import { autoInsertDelay, autoInsertKind, installAutoInsertion } from './language-auto-insert';
import type { LanguageFeatureContext } from './language-feature-context';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

type Cursor = { positionLineNumber: number; positionColumn: number };
function fixture(settings: LanguageAutoInsert, options: { focused?: boolean; editors?: number } = {}) {
  let version = 1, cursors: Cursor[] = [];
  const listeners = new Set<(event: M.editor.IModelContentChangedEvent) => void>(), disposables: M.IDisposable[] = [];
  const inserted: { text: string; at: [number, number][] }[] = [];
  const model = { getVersionId: () => version, onDidChangeContent: (listener: (event: M.editor.IModelContentChangedEvent) => void) => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; } } as unknown as M.editor.ITextModel;
  const editor = (focused: boolean) => ({ getModel: () => model, hasTextFocus: () => focused, getSelections: () => cursors,
    setSelections: (next: Cursor[]) => { cursors = next; },
    getContribution: (id: string) => id === 'snippetController2' ? { insert: (text: string) => inserted.push({ text, at: cursors.map(cursor => [cursor.positionLineNumber, cursor.positionColumn]) }) } : null });
  const editors = Array.from({ length: options.editors ?? 1 }, (_, index) => editor(index === 0 && options.focused !== false));
  const api = { editor: { getEditors: () => editors },
    Selection: class { positionLineNumber: number; positionColumn: number; constructor(_line: number, _column: number, line: number, column: number) { this.positionLineNumber = line; this.positionColumn = column; } } } as unknown as typeof M;
  const request = vi.fn(async (): Promise<string | null> => null);
  const context = { api, model, capabilities: {}, selector: 'test', scoped: (provider: object) => provider, add: (...items: M.IDisposable[]) => disposables.push(...items),
    request, alive: (expected: number) => expected === version } as unknown as LanguageFeatureContext;
  installAutoInsertion(context, settings);
  /** One keystroke at `line:column` (1-based, as the editor counts), with the cursor left behind it. */
  const type = (text: string, line = 1, column = 5, extra: Partial<M.editor.IModelContentChangedEvent> & { rangeLength?: number } = {}) => {
    version++; cursors = [{ positionLineNumber: line, positionColumn: column + text.length }];
    const { rangeLength = 0, ...flags } = extra;
    const event = { changes: [{ range: { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column }, rangeLength, rangeOffset: 0, text }],
      isUndoing: false, isRedoing: false, isFlush: false, ...flags } as unknown as M.editor.IModelContentChangedEvent;
    for (const listener of listeners) listener(event);
  };
  return { request, inserted, type, listeners, setCursors: (next: [number, number][]) => { cursors = next.map(([line, column]) => ({ positionLineNumber: line, positionColumn: column })); },
    edit: () => { version++; }, dispose: () => disposables.forEach(item => item.dispose()) };
}
const html: LanguageAutoInsert = { method: 'html/autoInsert', close: true, quote: true };
const settle = async () => { await vi.advanceTimersByTimeAsync(autoInsertDelay); };

test('which keystrokes ask the tool, and for what', () => {
  expect(autoInsertKind({ rangeLength: 0, text: '>' }, html)).toBe('autoClose');
  expect(autoInsertKind({ rangeLength: 0, text: '/' }, html)).toBe('autoClose');
  expect(autoInsertKind({ rangeLength: 0, text: '=' }, html)).toBe('autoQuote');
  expect(autoInsertKind({ rangeLength: 0, text: 'class=' }, html)).toBe('autoQuote');
  expect(autoInsertKind({ rangeLength: 0, text: 'a' }, html)).toBeUndefined();
  expect(autoInsertKind({ rangeLength: 1, text: '>' }, html)).toBeUndefined();
  expect(autoInsertKind({ rangeLength: 0, text: '<p>\n' }, html)).toBeUndefined();
  expect(autoInsertKind({ rangeLength: 0, text: '=' }, { close: true, quote: false })).toBeUndefined();
  expect(autoInsertKind({ rangeLength: 0, text: '>' }, { close: false, quote: true })).toBeUndefined();
});

test('after ">" the HTML tool is asked once, 100 ms later, and its answer is written at the cursor', async () => {
  const f = fixture(html);
  f.type('>', 3, 6);
  expect(f.request).not.toHaveBeenCalled();
  f.request.mockResolvedValueOnce('$0</div>');
  await settle();
  expect(f.request).toHaveBeenCalledWith('html/autoInsert', { kind: 'autoClose', position: { line: 2, character: 6 } }, expect.anything());
  expect(f.inserted).toEqual([{ text: '$0</div>', at: [[3, 7]] }]);
});

test('after "=" the quotes are asked for, and the Svelte tool is asked with the position alone', async () => {
  const f = fixture(html);
  f.request.mockResolvedValueOnce('"$1"');
  f.type('='); await settle();
  expect(f.request).toHaveBeenCalledWith('html/autoInsert', { kind: 'autoQuote', position: { line: 0, character: 5 } }, expect.anything());
  expect(f.inserted[0].text).toBe('"$1"');
  const svelte = fixture({ method: 'html/tag', close: true, quote: false });
  svelte.type('='); await settle();
  expect(svelte.request).not.toHaveBeenCalled();
  svelte.request.mockResolvedValueOnce('$0</Button>');
  svelte.type('>'); await settle();
  expect(svelte.request).toHaveBeenCalledWith('html/tag', { position: { line: 0, character: 5 } }, expect.anything());
  expect(svelte.inserted).toEqual([{ text: '$0</Button>', at: [[1, 6]] }]);
});

test('undo, redo, a replaced document and a keystroke the person typed over are left alone', async () => {
  const f = fixture(html);
  f.type('>', 1, 5, { isUndoing: true }); f.type('>', 1, 5, { isRedoing: true }); f.type('>', 1, 5, { isFlush: true }); f.type('>', 1, 5, { rangeLength: 2 });
  await settle();
  expect(f.request).not.toHaveBeenCalled();
});

test('typing on within the pause asks only for the last keystroke, and nothing when the text moved on', async () => {
  const f = fixture(html);
  f.request.mockResolvedValue('$0</b>');
  f.type('>', 1, 5); await vi.advanceTimersByTimeAsync(50); f.type('>', 1, 9);
  await settle();
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request).toHaveBeenLastCalledWith('html/autoInsert', { kind: 'autoClose', position: { line: 0, character: 9 } }, expect.anything());
  f.request.mockClear(); f.inserted.length = 0;
  f.type('>', 1, 5); f.type('x', 1, 6);
  await settle();
  expect(f.request).not.toHaveBeenCalled();
  // The document changed while the tool was answering: the answer is dropped.
  let answer!: (text: string) => void;
  f.request.mockImplementationOnce(() => new Promise<string>(resolve => { answer = resolve; }));
  f.type('>', 1, 5); await settle(); f.edit(); answer('$0</b>'); await vi.advanceTimersByTimeAsync(0);
  expect(f.inserted).toEqual([]);
});

test('every cursor at the keystroke gets the text; with the cursor elsewhere only that place does', async () => {
  const f = fixture(html);
  f.request.mockResolvedValue('$0</i>');
  f.type('>', 2, 4); f.setCursors([[2, 5], [7, 9]]);
  await settle();
  expect(f.inserted).toEqual([{ text: '$0</i>', at: [[2, 5], [7, 9]] }]);
  f.inserted.length = 0;
  f.type('>', 2, 4); f.setCursors([[9, 1]]);
  await settle();
  expect(f.inserted).toEqual([{ text: '$0</i>', at: [[2, 5]] }]);
});

test('a document that no focused editor shows, and a tool with both kinds off, ask nothing', async () => {
  const unfocused = fixture(html, { focused: false, editors: 2 });
  unfocused.type('>'); await settle();
  expect(unfocused.request).not.toHaveBeenCalled();
  const off = fixture({ method: 'html/autoInsert', close: false, quote: false });
  expect(off.listeners.size).toBe(0);
  const f = fixture(html);
  f.type('>'); f.dispose(); await settle();
  expect(f.request).not.toHaveBeenCalled();
});

test('the pause and the conditions are those of the two extensions', () => {
  const vendor = path.resolve(__dirname, '../../../../../vendor');
  for (const file of ['vscode/extensions/html-language-features/client/src/autoInsertion.ts', 'svelte-language-tools/packages/svelte-vscode/src/html/autoClose.ts']) {
    const source = readFileSync(path.join(vendor, file), 'utf8');
    expect(source).toContain(`}, ${autoInsertDelay});`);
    expect(source).toMatch(/lastCharacter === '>' \|\| lastCharacter === '\/'|lastCharacter !== '>' && lastCharacter !== '\/'/);
    expect(source).toContain('activeDocument.version === version');
  }
  const html = readFileSync(path.join(vendor, 'vscode/extensions/html-language-features/client/src/autoInsertion.ts'), 'utf8');
  expect(html).toContain("isEnabled.autoQuote && lastCharacter === '='");
  expect(html).toContain('reason === TextDocumentChangeReason.Undo || reason === TextDocumentChangeReason.Redo');
  expect(html).toContain('lastChange.rangeLength === 0 && isSingleLine(lastChange.text)');
});
