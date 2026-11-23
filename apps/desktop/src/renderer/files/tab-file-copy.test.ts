// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createWorkspaceTab, type WorkspaceTab } from '../../core/workspace/workspace-state';
import type { DocumentSnapshot } from '../../core/document/document';
import { installTabFileCopy, tabFile } from './tab-file-copy';

const anchor = { sourceLine: 1, yRatio: .372, reason: 'empty-document', confidence: 'fallback' } as const;
const tab = (path: string, extra: Partial<DocumentSnapshot> = {}): WorkspaceTab => createWorkspaceTab(path, { path, name: path.split('/').at(-1)!,
  text: '', savedText: '', revision: 0, savedRevision: 0, diskVersion: { mtimeMs: 0, size: 0 }, isUntitled: false, ...extra }, 'viewer', anchor);
const image = tab('/photos/banana.jpg', { kind: 'image' });
let stop = () => {};
afterEach(() => { stop(); document.body.replaceChildren(); document.getSelection()?.removeAllRanges(); });
function install(active: WorkspaceTab | null) {
  const copy = vi.fn(async () => {}), failed = vi.fn();
  stop = installTabFileCopy({ tab: () => active, copy, failed });
  /** Dispatches like the browser does; answers whether the page took the event. */
  const fire = (type: 'beforecopy' | 'copy', target: EventTarget = document.body) => !target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, composed: true }));
  return { copy, failed, fire };
}

test('only a saved file shown as a whole is copied by Copy', () => {
  for (const kind of ['image', 'video', 'pdf', 'office'] as const) expect(tabFile(tab(`/files/a.${kind}`, { kind }))).toBe(`/files/a.${kind}`);
  expect(tabFile(tab('/notes/readme.md'))).toBeNull();
  expect(tabFile(tab('/drafts/Untitled.png', { kind: 'image', isUntitled: true }))).toBeNull();
  expect(tabFile({ kind: 'web', id: 'web', surface: 'web', page: { url: 'https://example.org/a.pdf' } as never })).toBeNull();
  expect(tabFile(null)).toBeNull();
});

test('Copy with nothing selected takes the file, and enables itself for the browser', () => {
  const f = install(image);
  expect(f.fire('beforecopy')).toBe(true);
  expect(f.fire('copy')).toBe(true);
  expect(f.copy).toHaveBeenCalledExactlyOnceWith('/photos/banana.jpg');
});

test('a viewer that answers Copy itself is not reached when the file is taken, and is when its text is selected', () => {
  const f = install(image), viewer = vi.fn((event: Event) => { event.preventDefault(); event.stopPropagation(); });
  document.body.innerHTML = '<div id="layer"><span id="text">page text</span></div>';
  const layer = document.getElementById('layer')!;
  layer.addEventListener('copy', viewer);
  expect(f.fire('copy', document.getElementById('text')!)).toBe(true);
  expect(viewer).not.toHaveBeenCalled();
  expect(f.copy).toHaveBeenCalledExactlyOnceWith('/photos/banana.jpg');
  document.getSelection()!.selectAllChildren(layer);
  f.fire('copy', document.getElementById('text')!);
  expect(viewer).toHaveBeenCalledOnce();
  expect(f.copy).toHaveBeenCalledOnce();
});

test('selected text, text fields and the side panel keep the text Copy', () => {
  const f = install(image);
  document.body.innerHTML = '<p id="text">caption</p><input id="field"><aside class="project-sidebar"><button id="row">row</button></aside>'
    + '<div id="editable" contenteditable="true" tabindex="0">x</div><div id="viewer"></div>';
  // A viewer's own field lives in its shadow tree.
  document.getElementById('viewer')!.attachShadow({ mode: 'open' }).innerHTML = '<input id="find">';
  const fields = [...['field', 'row', 'editable'].map(id => document.getElementById(id)!), document.getElementById('viewer')!.shadowRoot!.getElementById('find')!];
  for (const field of fields) {
    field.focus();
    expect(f.fire('beforecopy', field), field.id).toBe(false);
    expect(f.fire('copy', field), field.id).toBe(false);
  }
  // With nothing focused the browser may still aim the event at a field the caret was left beside: that is the file's.
  fields.at(-1)!.blur();
  expect(document.activeElement).toBe(document.body);
  expect(f.fire('copy', fields[0])).toBe(true);
  expect(f.copy).toHaveBeenCalledOnce(); f.copy.mockClear();
  document.getSelection()!.selectAllChildren(document.getElementById('text')!);
  expect(document.getSelection()!.toString()).toBe('caption');
  expect(f.fire('beforecopy')).toBe(false);
  expect(f.fire('copy')).toBe(false);
  expect(f.copy).not.toHaveBeenCalled();
});

test('a text document, and no tab, leave Copy alone; a refused copy is reported', async () => {
  for (const active of [tab('/notes/readme.md'), null]) {
    const f = install(active);
    expect(f.fire('beforecopy')).toBe(false); expect(f.fire('copy')).toBe(false); expect(f.copy).not.toHaveBeenCalled();
    stop();
  }
  const f = install(image), gone = Error('ENOENT');
  f.copy.mockRejectedValueOnce(gone);
  f.fire('copy');
  await vi.waitFor(() => expect(f.failed).toHaveBeenCalledExactlyOnceWith(gone));
  stop();
  expect(f.fire('copy')).toBe(false);
});
