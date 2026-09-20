import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type * as Monaco from 'monaco-editor';
import type { WorkspaceTab } from '../../core/workspace/workspace-state';
import { MonacoEditor } from './monaco-editor';
import { liveDocumentModels } from '../editor/live-document-model';

vi.mock('../theme', () => ({ monacoThemeName: () => 'test', registerMonacoThemes() {} }));
vi.mock('../editor/markdown-editor-actions', () => ({ installMarkdownEditorActions() {} }));
vi.mock('../editor/editor-viewport', () => ({ readEditorViewport() {} }));

// Test the production adapter's ownership/wiring. Native Monaco history semantics
// are covered separately by shared-document-history.spec.ts, not this fake.
class Model {
  private text: string;
  private past: string[] = [];
  private future: string[] = [];
  private listeners = new Set<() => void>();
  disposed = false;
  language: string;
  eol = '\n';
  constructor(text: string, language: string) { this.text = text; this.language = language; }
  getValue() { return this.text; }
  getEOL() { return this.eol; }
  getLanguageId() { return this.language; }
  getLineContent(n: number) { return this.text.split(/\r?\n/)[n - 1] ?? ''; }
  getFullModelRange() { return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: this.text.length + 1 }; }
  setEOL(value: number) { this.eol = value === 1 ? '\r\n' : '\n'; }
  pushEOL(value: number) { this.setEOL(value); }
  pushStackElement() {}
  onDidChangeContent(listener: () => void) { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }
  private changed() { for (const listener of this.listeners) listener(); }
  pushEditOperations(_before: unknown, edits: Array<{ text: string }>) {
    this.past.push(this.text); this.future = []; this.text = edits[0].text; this.changed();
  }
  undo() { const text = this.past.pop(); if (text === undefined) return; this.future.push(this.text); this.text = text; this.changed(); }
  redo() { const text = this.future.pop(); if (text === undefined) return; this.past.push(this.text); this.text = text; this.changed(); }
  setValue(): never { throw new Error('Destructive setValue must not be used'); }
  applyEdits(): never { throw new Error('Non-undoable mirroring must not be used'); }
  dispose() { assert.equal(this.disposed, false); this.disposed = true; this.listeners.clear(); }
}
function fixture() {
  const tab = { id: 'document', document: { path: '/project/note.md', eol: 'lf', text: 'base', savedText: 'base' },
    text: 'base', revision: 0, surface: 'editor' } as WorkspaceTab;
  const tabs = [tab]; let changes = 0;
  const api = { languages: { getLanguages: () => [] }, Uri: { file: (path: string) => ({ with: () => ({ path }) }) },
    editor: { createModel: (text: string, language: string) => new Model(text, language),
      setModelLanguage: (model: Model, language: string) => { model.language = language; },
      EndOfLineSequence: { LF: 0, CRLF: 1 } } } as unknown as typeof Monaco;
  const adapter = new MonacoEditor({ tabs: () => tabs, active: () => tab,
    changed: (owner, text) => { changes++; owner.text = text; owner.revision++; },
  } as ConstructorParameters<typeof MonacoEditor>[0]);
  const borrow = (path = tab.document.path) => liveDocumentModels.acquire(path, api)!;
  const lease = borrow();
  const live = lease.model as unknown as Model;
  let shown: Model | null = null;
  const editor = { getModel: () => shown, setModel: (model: Model | null) => { shown = model; },
    restoreViewState() {}, dispose() {} };
  (adapter as unknown as { editorValue: unknown }).editorValue = editor;
  adapter.activate(tab);
  return { adapter, tab, tabs, lease, live, borrow, editor, changes: () => changes,
    dispose: () => { lease.release(); adapter.disposeWorkspace(); } };
}

test('ordinary editor and Working Tree use the same object and one change callback', () => {
  const f = fixture();
  try {
    assert.strictEqual(f.editor.getModel(), f.lease.model);
    f.adapter.setText(f.tab, 'ordinary edit');
    assert.equal(f.changes(), 1); assert.equal(f.tab.revision, 1);
    f.live.undo(); assert.equal(f.adapter.text(f.tab), 'base'); assert.equal(f.changes(), 2);
  } finally { f.dispose(); }
});
test('review edit is undoable and redoable from the ordinary model without copying stacks', () => {
  const f = fixture();
  try {
    f.live.pushEditOperations(null, [{ text: 'review edit' }]);
    f.editor.getModel()!.undo(); assert.equal(f.live.getValue(), 'base');
    f.editor.getModel()!.redo(); assert.equal(f.live.getValue(), 'review edit');
    assert.equal(f.changes(), 3);
  } finally { f.dispose(); }
});
test('closing and reopening a borrowed review retains redo and identity', () => {
  const f = fixture();
  try {
    f.adapter.setText(f.tab, 'A'); f.live.undo(); f.lease.release();
    const next = f.borrow(); assert.strictEqual(next.model, f.live);
    f.live.redo(); assert.equal(f.adapter.text(f.tab), 'A'); next.release();
  } finally { f.dispose(); }
});
test('reload changes the existing model as an undoable transaction, not a disposal', () => {
  const f = fixture();
  try {
    f.adapter.setText(f.tab, 'A');
    f.adapter.replace(f.tab, { ...f.tab.document, text: 'disk', revision: 7 });
    assert.strictEqual(f.editor.getModel(), f.live); assert.equal(f.live.disposed, false);
    assert.equal(f.tab.revision, 7); assert.equal(f.changes(), 1);
    f.live.undo(); assert.equal(f.adapter.text(f.tab), 'A'); assert.equal(f.tab.revision, 8);
  } finally { f.dispose(); }
});
test('retargeting keeps the model and history and removes the old path lookup', () => {
  const f = fixture();
  try {
    f.adapter.setText(f.tab, 'A'); f.tab.document = { ...f.tab.document, path: '/project/note.txt' };
    f.adapter.retarget(f.tab);
    const next = f.borrow(); assert.strictEqual(next.model, f.live); next.release();
    assert.equal(f.borrow('/project/note.md'), null);
    f.live.undo(); assert.equal(f.live.getValue(), 'base');
  } finally { f.dispose(); }
});
test('another document never borrows the first document history', () => {
  const f = fixture();
  try {
    const second = { ...f.tab, id: 'other', document: { ...f.tab.document, path: '/other.txt' } };
    f.tabs.push(second);
    const lease = f.borrow('/other.txt');
    assert.notStrictEqual(lease.model, f.live);
    f.live.pushEditOperations(null, [{ text: 'A' }]); assert.equal(lease.model.getValue(), 'base');
    lease.release();
  } finally { f.dispose(); }
});
test('document disposal waits for the mounted review and unregisters the provider', () => {
  const f = fixture();
  f.adapter.disposeWorkspace();
  assert.equal(f.live.disposed, false);
  f.lease.release(); assert.equal(f.live.disposed, true);
  assert.equal(f.borrow(), null);
});
test('self-echo is a no-op, not another undo record or document revision', () => {
  const f = fixture();
  try {
    f.adapter.setText(f.tab, 'A');
    f.adapter.setText(f.tab, 'A'); assert.equal(f.changes(), 1);
    f.live.undo(); assert.equal(f.live.getValue(), 'base');
  } finally { f.dispose(); }
});
