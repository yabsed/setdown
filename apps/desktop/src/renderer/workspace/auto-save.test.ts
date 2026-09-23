import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { createWorkspaceTab, WorkspaceState } from '../../core/workspace/workspace-state';
import type { DocumentSnapshot } from '../../core/document/document';
import type { DesktopPort } from '../ports/desktop-port';
import { AUTO_SAVE_DELAY, AutoSaveController } from './auto-save';

const anchor = { sourceLine: 1, yRatio: .372, reason: 'empty-document', confidence: 'fallback' } as const;
const snapshot = (path: string, text = 'body', isUntitled = false): DocumentSnapshot => ({ path,
  name: path.split('/').at(-1)!, text, savedText: text, revision: 0, savedRevision: 0,
  diskVersion: { mtimeMs: 0, size: 0 }, isUntitled });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fixture() {
  const workspace = new WorkspaceState();
  const calls: string[] = [];
  let saveResult: (document: DocumentSnapshot, text: string, revision: number) =>
    { canceled: boolean; document?: DocumentSnapshot } = (document, text, revision) =>
    ({ canceled: false, document: { ...document, text, savedText: text, revision, savedRevision: revision } });
  const desktop = {
    saveTabDocument: vi.fn(async (document: DocumentSnapshot, text: string, revision: number, auto?: boolean) => {
      calls.push(`save:${document.path}:${String(auto)}`);
      return saveResult(document, text, revision);
    }),
  };
  const controller = new AutoSaveController({
    desktop: desktop as unknown as DesktopPort,
    tabs: workspace.tabs,
    activeId: () => workspace.activeId,
    text: (tab) => tab.text,
    dirty: (tab) => tab.text !== tab.document.savedText,
    acceptSaved: async (tab, document) => {
      calls.push(`accept:${document.path}`);
      tab.document = document; tab.text = document.text;
    },
    saved: (document) => { calls.push(`saved:${document.path}`); },
  });
  const add = (path: string, text = 'body', isUntitled = false) => {
    const tab = createWorkspaceTab(path, snapshot(path, text, isUntitled), 'editor', anchor);
    workspace.add(tab);
    return tab;
  };
  const settle = () => vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY);
  return { workspace, controller, desktop, calls, add, settle,
    setSaveResult: (result: typeof saveResult) => { saveResult = result; } };
}

test('an edit saves the active dirty tab after the debounce delay', async () => {
  const f = fixture();
  const tab = f.add('/project/note.md');
  f.workspace.activeId = tab.id;
  f.controller.setEnabled(true);
  tab.text = 'changed';
  f.controller.schedule(tab);
  await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY - 1);
  assert.equal(f.desktop.saveTabDocument.mock.calls.length, 0);
  await vi.advanceTimersByTimeAsync(1);
  assert.deepEqual(f.calls, ['save:/project/note.md:true', 'accept:/project/note.md', 'saved:/project/note.md']);
  assert.equal(tab.text, tab.document.savedText);
});

test('each new edit restarts the debounce', async () => {
  const f = fixture();
  const tab = f.add('/project/note.md');
  f.workspace.activeId = tab.id;
  f.controller.setEnabled(true);
  tab.text = 'one';
  f.controller.schedule(tab);
  await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY - 1);
  tab.text = 'two';
  f.controller.schedule(tab);
  await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY - 1);
  assert.equal(f.desktop.saveTabDocument.mock.calls.length, 0);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(f.desktop.saveTabDocument.mock.calls.length, 1);
  assert.equal(f.desktop.saveTabDocument.mock.calls[0][1], 'two');
});

test('disabled, untitled, non-text and background tabs never schedule', async () => {
  const f = fixture();
  const active = f.add('/project/note.md');
  f.workspace.activeId = active.id;
  active.text = 'changed';
  f.controller.schedule(active);
  await f.settle();
  assert.equal(f.desktop.saveTabDocument.mock.calls.length, 0);

  f.controller.setEnabled(true);
  active.text = active.document.savedText;
  const untitled = f.add('/drafts/Untitled.md', 'body', true);
  f.workspace.activeId = untitled.id;
  untitled.text = 'changed';
  f.controller.schedule(untitled);
  const pdf = f.add('/project/book.pdf');
  pdf.document = { ...pdf.document, kind: 'pdf' };
  f.workspace.activeId = pdf.id;
  f.controller.schedule(pdf);
  f.workspace.activeId = active.id;
  f.controller.schedule(untitled);
  await f.settle();
  assert.equal(f.desktop.saveTabDocument.mock.calls.length, 0);
});

test('the fire re-checks existence, dirtiness and active tab', async () => {
  const f = fixture();
  const tab = f.add('/project/note.md');
  const other = f.add('/project/other.md');
  f.workspace.activeId = tab.id;
  f.controller.setEnabled(true);

  tab.text = 'changed';
  f.controller.schedule(tab);
  tab.text = tab.document.savedText;
  await f.settle();
  assert.equal(f.desktop.saveTabDocument.mock.calls.length, 0);

  tab.text = 'changed';
  f.controller.schedule(tab);
  f.workspace.activeId = other.id;
  await f.settle();
  assert.equal(f.desktop.saveTabDocument.mock.calls.length, 0);

  f.workspace.activeId = tab.id;
  f.controller.schedule(tab);
  f.workspace.remove(tab.id);
  await f.settle();
  assert.equal(f.desktop.saveTabDocument.mock.calls.length, 0);
});

test('a canceled conflict save stays dirty and quiet', async () => {
  const f = fixture();
  f.setSaveResult(() => ({ canceled: true }));
  const tab = f.add('/project/note.md');
  f.workspace.activeId = tab.id;
  f.controller.setEnabled(true);
  tab.text = 'changed';
  f.controller.schedule(tab);
  await f.settle();
  assert.deepEqual(f.calls, ['save:/project/note.md:true']);
  assert.equal(tab.text, 'changed');
});

test('enabling saves every dirty file-backed tab immediately', async () => {
  const f = fixture();
  const first = f.add('/project/a.md');
  const clean = f.add('/project/b.md');
  const untitled = f.add('/drafts/Untitled.md', 'body', true);
  f.workspace.activeId = first.id;
  first.text = 'dirty a';
  untitled.text = 'dirty untitled';
  f.controller.setEnabled(true);
  await f.settle();
  assert.deepEqual(f.calls, ['save:/project/a.md:true', 'accept:/project/a.md', 'saved:/project/a.md']);
  assert.equal(clean.document.savedText, 'body');
});

test('cancel drops a pending save for the matching tab only', async () => {
  const f = fixture();
  const tab = f.add('/project/note.md');
  f.workspace.activeId = tab.id;
  f.controller.setEnabled(true);
  tab.text = 'changed';
  f.controller.schedule(tab);
  f.controller.cancel('/project/other.md');
  await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY - 1);
  f.controller.cancel(tab.id);
  await f.settle();
  assert.equal(f.desktop.saveTabDocument.mock.calls.length, 0);
});

test('disabling drops a pending save', async () => {
  const f = fixture();
  const tab = f.add('/project/note.md');
  f.workspace.activeId = tab.id;
  f.controller.setEnabled(true);
  tab.text = 'changed';
  f.controller.schedule(tab);
  f.controller.setEnabled(false);
  await f.settle();
  assert.equal(f.desktop.saveTabDocument.mock.calls.length, 0);
});
