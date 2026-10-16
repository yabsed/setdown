import { afterEach, expect, test, vi } from 'vitest';
import { createWorkspaceTab, WorkspaceState } from '../../core/workspace/workspace-state';
import type { DocumentTab } from '../../core/workspace/workspace-state';
import { notebookContent, notebookViews } from '../notebook/document-content';
import { DocumentSessions } from './document-sessions';

afterEach(() => notebookContent.releaseAll());
function fixture() {
  const text = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
    { id: 'cell', cell_type: 'code', source: ['original = 1\n'], metadata: {}, execution_count: null, outputs: [] },
  ] });
  const tab = createWorkspaceTab('notebook', { path: '/project/example.ipynb', name: 'example.ipynb',
    text, savedText: text, revision: 0, savedRevision: 0, diskVersion: { mtimeMs: 1, size: text.length }, isUntitled: false },
  'notebook', { sourceLine: 1, yRatio: .4, reason: 'empty-document', confidence: 'fallback' });
  const workspace = new WorkspaceState(); workspace.add(tab);
  const editor = { text: vi.fn((tab: DocumentTab) => tab.text), beforeSave: vi.fn(async () => {}),
    saved: vi.fn(), replace: vi.fn(), retarget: vi.fn(), saveView: vi.fn(), dispose: vi.fn() };
  const sessions = new DocumentSessions(editor, [notebookContent]);
  const entry = notebookViews(workspace, () => {})[0].entry;
  return { tab, workspace, editor, sessions, entry };
}

test('notebook content survives view publication and a save acknowledgment cannot clear newer edits', () => {
  const { tab, workspace, editor, sessions, entry } = fixture();
  entry.document.setSource('cell', 'changed = 2\n');
  expect(sessions.dirty(tab)).toBe(true);
  const saved = sessions.text(tab);
  expect(saved).toContain('changed = 2');
  expect(notebookViews(workspace, () => {})[0].entry).toBe(entry);
  expect(editor.text).not.toHaveBeenCalled();
  entry.document.setSource('cell', 'newer = 3\n');
  tab.document.savedText = saved;
  sessions.saved(tab);
  expect(sessions.dirty(tab)).toBe(true);
  expect(sessions.text(tab)).toContain('newer = 3');
  expect(editor.saved).not.toHaveBeenCalled();
});

test('retarget releases the outgoing notebook owner after its current content is materialized', () => {
  const { tab, editor, sessions, entry } = fixture();
  const release = vi.spyOn(entry, 'dispose');
  entry.document.setSource('cell', 'retained = 4\n');
  sessions.saveView(tab);
  tab.document = { ...tab.document, path: '/project/example.txt' };
  sessions.retarget(tab);
  expect(release).toHaveBeenCalledTimes(1);
  expect(sessions.text(tab)).toContain('retained = 4');
  expect(editor.retarget).toHaveBeenCalledWith(tab);
  expect(sessions.dirty(tab)).toBe(true);
});

test('reload replaces the notebook session while tab release disposes the current owner once', () => {
  const { tab, workspace, editor, sessions, entry } = fixture();
  const releaseOld = vi.spyOn(entry, 'dispose');
  const snapshot = { ...tab.document, text: tab.text.replace('original', 'reloaded'), revision: 2 };
  sessions.replace(tab, snapshot);
  expect(releaseOld).toHaveBeenCalledTimes(1);
  expect(editor.replace).not.toHaveBeenCalled();
  const current = notebookViews(workspace, () => {})[0].entry;
  expect(current).not.toBe(entry);
  expect(sessions.text(tab)).toContain('reloaded');
  const releaseCurrent = vi.spyOn(current, 'dispose');
  sessions.release(tab.id); sessions.releaseAll();
  expect(releaseCurrent).toHaveBeenCalledTimes(1);
  expect(editor.dispose).toHaveBeenCalledWith(tab.id);
});
