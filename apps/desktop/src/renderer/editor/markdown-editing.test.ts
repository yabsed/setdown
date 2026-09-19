import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type * as Monaco from 'monaco-editor';
import type { DesktopPort } from '../ports/desktop-port';
import { createEditorInsertions } from './editor-insertions';
import { installEditorImagePaste } from './editor-image-paste';
import { insertion, emptyTable } from './insertion-state.svelte';
import { CompositionGuard } from './composition-guard';
import { type MarkdownEditingTarget } from './markdown-editing-target';
import { MarkdownEditorPort, isMarkdownPath } from './markdown-editor-port';
import { installMarkdownEditorActions } from './markdown-editor-actions';

vi.mock('./insertion-state.svelte', () => ({
  emptyTable: () => ({ headers: ['Column 1', 'Column 2', 'Column 3'],
    rows: [['', '', ''], ['', '', '']], alignments: ['none', 'none', 'none'] }),
  insertion: { tableOpen: false, tableError: '', linkOpen: false, linkLabel: '',
    linkDestination: '', linkTitle: '', linkError: '', table: {} },
}));

class TestNode extends EventTarget {
  constructor(readonly name = '') { super(); }
  contains(node: unknown) { return node === this; }
}
class Range {
  constructor(readonly startLineNumber: number, readonly startColumn: number,
    readonly endLineNumber: number, readonly endColumn: number) {}
  getStartPosition() { return { lineNumber: this.startLineNumber, column: this.startColumn }; }
  getEndPosition() { return { lineNumber: this.endLineNumber, column: this.endColumn }; }
  isEmpty() { return this.startLineNumber === this.endLineNumber && this.startColumn === this.endColumn; }
  static lift(range: Range) { return range; }
  static fromPositions(a: { lineNumber: number; column: number }, b = a) {
    return new Range(a.lineNumber, a.column, b.lineNumber, b.column);
  }
}
const monaco = { Range, Selection: Range, KeyMod: { CtrlCmd: 2048 }, KeyCode: { KeyK: 41 },
  editor: { EditorOption: { readOnly: 1 } } } as unknown as typeof Monaco;
const disposers: (() => void)[] = [];
const alerts: string[] = [];
beforeEach(() => {
  alerts.length = 0;
  vi.stubGlobal('Node', TestNode);
  vi.stubGlobal('window', { alert: (message: string) => alerts.push(message) });
  vi.stubGlobal('DOMParser', class {
    parseFromString(html: string) { return { querySelector: () => {
      const src = /<img[^>]*src="([^"]+)"/.exec(html)?.[1];
      return src ? { getAttribute: () => src } : null;
    } }; }
  });
  Object.assign(insertion, { tableOpen: false, tableError: '', table: emptyTable(),
    linkOpen: false, linkLabel: '', linkDestination: '', linkTitle: '', linkError: '' });
});
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); vi.unstubAllGlobals(); });

function fixture(value = 'hello', identity = 'review:r') {
  const host = new TestNode('shell');
  const node = new TestNode('modified');
  let text = value;
  let version = 1;
  let dead = false;
  let readOnly = false;
  let selection = new Range(1, 1, 1, value.split(/\r\n|\r|\n/)[0].length + 1);
  let focused = 0;
  const edits: { source: string; text: string }[] = [];
  const calls: string[] = [];
  const offset = ({ lineNumber, column }: { lineNumber: number; column: number }) => {
    const lines = [...text.matchAll(/.*(?:\r\n|\n|\r|$)/g)].filter((line) => line[0]);
    return (lines[lineNumber - 1]?.index ?? text.length) + column - 1;
  };
  const model = { getValue: () => text, getVersionId: () => version, isDisposed: () => dead,
    getOffsetAt: offset,
    getPositionAt(at: number) {
      const prefix = text.slice(0, at).split(/\r\n|\n|\r/);
      return { lineNumber: prefix.length, column: prefix.at(-1)!.length + 1 };
    },
    getValueInRange(range: Range) { return text.slice(offset(range.getStartPosition()), offset(range.getEndPosition())); },
  };
  const editor = { getModel: () => model, getOption: () => readOnly, getSelection: () => selection,
    getDomNode: () => node, pushUndoStop() { calls.push('undo-stop'); }, focus() { focused++; },
    executeEdits(source: string, changes: { range: Range; text: string }[]) {
      const change = changes[0];
      text = text.slice(0, offset(change.range.getStartPosition())) + change.text + text.slice(offset(change.range.getEndPosition()));
      version++; edits.push({ source, text }); calls.push(source); return true;
    },
    setPosition(position: { lineNumber: number; column: number }) { selection = Range.fromPositions(position); },
    setSelection(next: Range) { selection = next; },
  };
  const target = { identity, editor, model, monaco,
    document: { path: '/p/notes.md', isUntitled: false } } as unknown as MarkdownEditingTarget;
  let current: MarkdownEditingTarget | null = target;
  let image = async () => ({ canceled: false, markdown: '![Image](<notes.assets/image.png>)' });
  let pick = async (_path: string) => ({ canceled: false, destination: './other.md', label: 'other.md' });
  const native: string[] = [];
  const context = { host: host as unknown as HTMLElement, target: () => current,
    desktop: { pasteClipboardImage: () => { native.push('image'); return image(); },
      pickLinkTarget: (path: string) => { native.push(path); return pick(path); } } as unknown as DesktopPort,
    save: async () => false,
  };
  const insertions = createEditorInsertions(context);
  const removeImage = installEditorImagePaste(context);
  disposers.push(() => { insertions.dispose(); removeImage(); });
  function paste(plain = '', data: { html?: string; types?: string[]; items?: unknown[]; target?: TestNode; prevented?: boolean } = {}) {
    const event = new Event('paste', { cancelable: true });
    Object.defineProperty(event, 'target', { value: data.target ?? node });
    Object.defineProperty(event, 'clipboardData', { value: {
      getData: (format: string) => format === 'text/plain' ? plain : data.html ?? '',
      types: data.types ?? ['text/plain'], items: data.items ?? [],
    } });
    if (data.prevented) event.preventDefault();
    host.dispatchEvent(event);
    return event;
  }
  return { target, context, insertions, model, editor, edits, calls, native, paste,
    get text() { return text; }, get focused() { return focused; },
    current: (next: MarkdownEditingTarget | null) => { current = next; },
    selection: (next: Range) => { selection = next; },
    readonly: () => { readOnly = true; }, disposeModel: () => { dead = true; },
    type(next: string) { text = next; version++; },
    image: (next: typeof image) => { image = next; }, pick: (next: typeof pick) => { pick = next; },
  };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

for (const identity of ['document:d', 'review:r']) {
  test(`${identity}: selected text becomes a link through the shared dialog`, () => {
    const f = fixture('한국어 [제목]', identity); f.insertions.openLink();
    insertion.linkDestination = 'https://example.com'; f.insertions.submitLink();
    assert.equal(f.text, '[한국어 \\[제목\\]](<https://example.com/>)');
    assert.deepEqual(f.calls, ['undo-stop', 'insert-link', 'undo-stop']);
    assert.equal(insertion.linkOpen, false); assert.ok(f.focused);
  });
  test(`${identity}: table insertion retains TSV and CRLF behavior`, () => {
    const f = fixture('A\tB\r\nx\ty', identity); f.selection(new Range(1, 1, 2, 4));
    f.insertions.openTable(); assert.deepEqual(insertion.table.headers, ['A', 'B']);
    assert.deepEqual(insertion.table.rows, [['x', 'y']]); f.insertions.submitTable();
    assert.equal(f.text, '| A | B |\r\n| --- | --- |\r\n| x | y |');
    assert.deepEqual(f.calls, ['undo-stop', 'insert-table', 'undo-stop']);
  });
}
test('plain URL over selected text is a link, including image URLs (not a second image insertion)', async () => {
  const f = fixture(); const event = f.paste('https://example.com/image.png'); await flush();
  assert.equal(event.defaultPrevented, true); assert.equal(f.edits.length, 1);
  assert.equal(f.text, '[hello](<https://example.com/image.png>)'); assert.deepEqual(f.native, []);
});
test('ordinary text and unselected non-image URLs remain native Monaco paste', () => {
  const f = fixture(); assert.equal(f.paste('plain text').defaultPrevented, false);
  f.selection(new Range(1, 1, 1, 1)); assert.equal(f.paste('https://example.com').defaultPrevented, false);
  assert.equal(f.edits.length, 0);
});
for (const plain of ['https://example.com/image.png', 'https://example.com/image.webp?q=1']) {
  test(`remote image reference: ${plain}`, async () => {
    const f = fixture(); f.selection(new Range(1, 1, 1, 1)); f.paste(plain); await flush();
    assert.equal(f.text, `![Remote image](<${plain}>)hello`); assert.deepEqual(f.native, []);
  });
}
test('copied browser image HTML inserts an image reference without downloading', async () => {
  const f = fixture(); f.selection(new Range(1, 1, 1, 1));
  f.paste('', { html: '<img src="https://example.com/picture">', types: ['text/html'] }); await flush();
  assert.equal(f.text, '![Remote image](<https://example.com/picture>)hello');
});
for (const clipboard of [
  { items: [{ kind: 'file', type: 'image/png' }], types: ['Files'] },
  { types: ['text/uri-list'] }, { types: ['x-special/gnome-copied-files'] },
]) test(`native image paste ${clipboard.types[0]}`, async () => {
  const f = fixture(); f.paste('', clipboard); await flush();
  assert.deepEqual(f.native, ['image']); assert.equal(f.text, '![Image](<notes.assets/image.png>)');
  assert.deepEqual(f.calls, ['undo-stop', 'paste-image', 'undo-stop']);
});
test('local file image URL uses existing clipboard asset storage', async () => {
  const f = fixture(); f.paste('file:///tmp/picture.png'); await flush(); assert.deepEqual(f.native, ['image']);
});
for (const mode of ['readonly', 'inactive', 'disposed', 'composing'] as const) {
  test(`no mutation or clipboard IPC while ${mode}`, async () => {
    const f = fixture();
    if (mode === 'readonly') f.readonly();
    if (mode === 'inactive') f.current(null);
    if (mode === 'disposed') f.disposeModel();
    if (mode === 'composing') { const guard = new CompositionGuard(() => {}); guard.start(); disposers.push(() => guard.dispose()); }
    f.insertions.openTable(); f.insertions.openLink();
    assert.equal(f.paste('', { types: ['Files'] }).defaultPrevented, false); await flush();
    assert.equal(insertion.tableOpen || insertion.linkOpen, false); assert.deepEqual(f.edits, []); assert.deepEqual(f.native, []);
  });
}
for (const name of ['original', 'link-destination', 'commit-message', 'hidden-document']) {
  test(`paste in ${name} does not target Working Tree`, () => {
    const f = fixture(); assert.equal(f.paste('https://example.com', { target: new TestNode(name) }).defaultPrevented, false);
    assert.equal(f.edits.length, 0);
  });
}
test('a previously consumed clipboard event is not processed twice', () => {
  const f = fixture(); f.paste('https://example.com', { prevented: true }); assert.equal(f.edits.length, 0);
});
for (const invalid of ['tab', 'version', 'model', 'path'] as const) {
  test(`dialog submit rejects a changed ${invalid}`, () => {
    const f = fixture(); f.insertions.openLink(); insertion.linkDestination = 'https://example.com';
    if (invalid === 'tab') f.current({ ...f.target, identity: 'review:other' });
    if (invalid === 'version') f.type('new text');
    if (invalid === 'model') f.current({ ...f.target, model: {} as Monaco.editor.ITextModel });
    if (invalid === 'path') f.current({ ...f.target, document: { ...f.target.document, path: '/other.md' } });
    f.insertions.submitLink(); assert.equal(f.edits.length, 0); assert.match(insertion.linkError, /document changed/);
  });
}
test('stale table target reports an error instead of modifying the new document', () => {
  const f = fixture(); f.insertions.openTable(); f.current(null); f.insertions.submitTable();
  assert.equal(f.edits.length, 0); assert.match(insertion.tableError, /document changed/);
});
test('async image return cannot edit or focus a different active surface', async () => {
  const f = fixture(); let finish!: (value: { canceled: boolean; markdown: string }) => void;
  f.image(() => new Promise((resolve) => { finish = resolve; }));
  f.paste('', { types: ['Files'] }); f.current({ ...f.target, identity: 'document:elsewhere' });
  finish({ canceled: false, markdown: '![Image](x.png)' }); await flush();
  assert.equal(f.edits.length, 0); assert.equal(f.focused, 0); assert.match(alerts[0], /document changed/);
});
test('async image does not replace newly typed content at a stale selection', async () => {
  const f = fixture(); let finish!: (value: { canceled: boolean; markdown: string }) => void;
  f.image(() => new Promise((resolve) => { finish = resolve; })); f.paste('', { types: ['Files'] });
  f.type('typed while saving image'); finish({ canceled: false, markdown: '![Image](x.png)' }); await flush();
  assert.equal(f.text, 'typed while saving image'); assert.equal(f.edits.length, 0);
});
test('local file picker uses the captured document path', async () => {
  const f = fixture(''); f.insertions.openLink(); await f.insertions.pickLinkFile(); f.insertions.submitLink();
  assert.deepEqual(f.native, ['/p/notes.md']); assert.equal(f.text, '[other.md](<./other.md>)');
});
test('late file picker result cannot reopen or overwrite a newer dialog', async () => {
  const f = fixture(); let finish!: (value: { canceled: boolean; destination: string; label: string }) => void;
  f.pick(() => new Promise((resolve) => { finish = resolve; }));
  f.insertions.openLink(); const task = f.insertions.pickLinkFile(); f.insertions.closeLink(); f.insertions.openLink();
  insertion.linkDestination = 'new-dialog'; finish({ canceled: false, destination: 'old.md', label: 'old' }); await task;
  assert.equal(insertion.linkDestination, 'new-dialog');
});
test('closing a dialog after tab switch never focuses the hidden editor', () => {
  const f = fixture(); f.insertions.openLink(); f.current(null); f.insertions.closeLink(); assert.equal(f.focused, 0);
});
for (const first of ['dom', 'native'] as const) test(`dialog Escape consumes both routes (${first} first), not the next key`, () => {
  const f = fixture(); f.insertions.openLink(); assert.equal(f.insertions.dismissOnEscape(first), true);
  assert.equal(f.insertions.dismissOnEscape(first === 'dom' ? 'native' : 'dom'), true);
  assert.equal(insertion.linkOpen, false); assert.equal(f.insertions.dismissOnEscape(first), false);
});
test('port lifecycle and Markdown eligibility', () => {
  const port = new MarkdownEditorPort(); const f = fixture();
  const one = port.register(() => ({ ...f.target, filePath: '/p/notes.md' }));
  const two = port.register(() => ({ ...f.target, identity: 'new', filePath: '/p/notes.md' }));
  one(); assert.equal(port.read()?.identity, 'new'); two(); assert.equal(port.read(), null);
  for (const path of ['a.md', 'a.MARKDOWN', 'a.qmd', 'a.mdx']) assert.ok(isMarkdownPath(path));
  for (const path of ['a.png', 'a.ts', 'a.txt', 'a.md.png']) assert.equal(isMarkdownPath(path), false);
});
test('shared editor actions preserve IDs, shortcut, readonly and composition preconditions', () => {
  const descriptors: Monaco.editor.IActionDescriptor[] = []; let links = 0; let tables = 0; let allowed = false; let removed = 0;
  const editor = { addAction(action: Monaco.editor.IActionDescriptor) { descriptors.push(action); return { dispose() { removed++; } }; } } as unknown as Monaco.editor.IStandaloneCodeEditor;
  const handle = installMarkdownEditorActions(monaco, editor, { insertLink() { links++; }, insertTable() { tables++; } }, () => allowed);
  assert.deepEqual(descriptors.map((action) => action.id), ['setdown.insertLink', 'setdown.insertTable']);
  assert.equal(descriptors[0].keybindings?.[0], 2048 | 41);
  assert.ok(descriptors.every((action) => action.precondition?.includes('!editorReadonly')));
  descriptors[0].run(editor); assert.equal(links, 0); allowed = true;
  descriptors[0].run(editor); descriptors[1].run(editor); assert.equal(links, 1); assert.equal(tables, 1);
  handle.dispose(); assert.equal(removed, 2);
});

test('canceled clipboard work leaves the model and selection untouched', async () => {
  const f = fixture(); f.image(async () => ({ canceled: true, markdown: '' }));
  f.paste('', { types: ['Files'] }); await flush(); assert.equal(f.text, 'hello'); assert.equal(f.focused, 0);
});
test('dispose removes paste listeners and invalidates pending clipboard work', async () => {
  const f = fixture(); let finish!: (value: { canceled: boolean; markdown: string }) => void;
  f.image(() => new Promise((resolve) => { finish = resolve; })); f.paste('', { types: ['Files'] });
  disposers.splice(0).forEach((dispose) => dispose());
  finish({ canceled: false, markdown: '![Image](x.png)' }); await flush();
  assert.equal(f.edits.length, 0); assert.equal(f.paste('https://example.com').defaultPrevented, false);
});
test('untitled Save As keeps the same document identity and selection when choosing a file', async () => {
  const f = fixture('label', 'document:untitled');
  f.target.document = { ...f.target.document, isUntitled: true };
  f.context.save = async () => {
    f.target.document = { ...f.target.document, isUntitled: false, path: '/saved/notes.md' };
    return true;
  };
  f.insertions.openLink(); await f.insertions.pickLinkFile(); f.insertions.submitLink();
  assert.deepEqual(f.native, ['/saved/notes.md']); assert.equal(f.text, '[label](<./other.md>)');
});
