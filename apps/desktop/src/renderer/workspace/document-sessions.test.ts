import { afterEach, expect, test, vi } from 'vitest';
import { createWorkspaceTab, WorkspaceState } from '../../core/workspace/workspace-state';
import type { DocumentTab } from '../../core/workspace/workspace-state';
import { imageSessions } from '../image/image-edit-sessions';
import { notebookContent, notebookViews } from '../notebook/document-content';
import { DocumentSessions } from './document-sessions';

afterEach(() => { notebookContent.releaseAll(); imageSessions.releaseAll(); });
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

test('reload replaces notebook content while preserving the session until the tab closes', () => {
  const { tab, workspace, editor, sessions, entry } = fixture();
  const releaseOld = vi.spyOn(entry, 'dispose');
  const snapshot = { ...tab.document, text: tab.text.replace('original', 'reloaded'), revision: 2 };
  sessions.replace(tab, snapshot);
  expect(releaseOld).not.toHaveBeenCalled();
  expect(editor.replace).not.toHaveBeenCalled();
  const current = notebookViews(workspace, () => {})[0].entry;
  expect(current).toBe(entry);
  expect(sessions.text(tab)).toContain('reloaded');
  const releaseCurrent = vi.spyOn(current, 'dispose');
  sessions.release(tab.id); sessions.releaseAll();
  expect(releaseCurrent).toHaveBeenCalledTimes(1);
  expect(editor.dispose).toHaveBeenCalledWith(tab.id);
});

test('a tab that takes over a released notebook tab’s ID gets its own session', () => {
  const { tab, workspace, editor, entry } = fixture();
  const next = createWorkspaceTab('notebook', { ...tab.document, path: '/project/next.ipynb', name: 'next.ipynb',
    text: tab.text.replace('original', 'next'), savedText: tab.text.replace('original', 'next') },
  'notebook', { sourceLine: 1, yRatio: .4, reason: 'empty-document', confidence: 'fallback' });
  // The workspace's wiring: every owner hears every release, and an image session
  // change republishes the chrome, which asks each listed tab whether it is dirty.
  const sessions: DocumentSessions = new DocumentSessions(editor, [notebookContent, imageSessions]);
  const chrome = vi.fn(() => { for (const listed of workspace.documents) sessions.dirty(listed); });
  imageSessions.configure({ open: vi.fn(), render: vi.fn(), release: vi.fn(), save: vi.fn() }, () => workspace.documents, chrome);
  const dispose = vi.spyOn(entry, 'dispose');
  expect(sessions.dirty(next)).toBe(false);
  // Explorer preview: the new document takes the slot and the ID of the one it replaces,
  // whose tab is still listed while its content is released.
  next.id = tab.id;
  sessions.release(tab.id);
  expect(chrome).not.toHaveBeenCalled();
  expect(sessions.dirty(tab)).toBe(false);
  expect(sessions.text(tab)).toContain('original = 1');
  workspace.tabs[workspace.tabs.indexOf(tab)] = next;
  const current = notebookViews(workspace, () => {})[0].entry;
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(current).not.toBe(entry);
  expect(current.document.cells.map(cell => cell.source)).toEqual(['next = 1\n']);
  expect(sessions.text(next)).toContain('next = 1');
  expect(sessions.dirty(next)).toBe(false);
});

function largeFixture() {
  const tab = createWorkspaceTab('large', { path: '/logs/session.jsonl', name: 'session.jsonl', text: '', savedText: '',
    revision: 3, savedRevision: 0, diskVersion: { mtimeMs: 1, size: 30 }, isUntitled: false, large: { bytes: 30, lines: 3 } },
  'editor', { sourceLine: 1, yRatio: .4, reason: 'empty-document', confidence: 'fallback' });
  let modified = false;
  const runs = ['{"a":1}\n', '{"b":2}\n'];
  const editor = { text: vi.fn(() => ''), beforeSave: vi.fn(async () => {}), saved: vi.fn(), replace: vi.fn(), retarget: vi.fn(), saveView: vi.fn(), dispose: vi.fn(),
    modified: vi.fn(() => modified),
    capture: vi.fn((): { read(): string | null } | null => { let next = 0; return { read: () => next < runs.length ? runs[next++] : null }; }) };
  const written: string[] = [];
  const desktop = { saveDocumentAs: vi.fn(), saveTabDocument: vi.fn(),
    largeText: { open: vi.fn(), read: vi.fn(), close: vi.fn(), save: vi.fn(async () => 'save'),
      write: vi.fn(async (_id: string, text: string) => { written.push(text); return true; }),
      finish: vi.fn(async () => ({ canceled: false })) } };
  const sessions = new DocumentSessions(editor, [notebookContent], desktop as never);
  return { tab, editor, desktop, sessions, written, setModified: (value: boolean) => { modified = value; } };
}

test('a large document is unsaved by what its editor says, never by its empty text field', () => {
  const { tab, sessions, setModified } = largeFixture();
  expect(sessions.dirty(tab)).toBe(false);
  setModified(true);
  expect(sessions.dirty(tab)).toBe(true);
  expect(sessions.text(tab)).toBe('');
});

test('a large document is saved from its editor in pieces, on every kind of save', async () => {
  const { tab, sessions, desktop, written } = largeFixture();
  await sessions.save(tab);
  expect(desktop.largeText.save).toHaveBeenLastCalledWith({ document: tab.document, revision: 3, auto: false, saveAs: false });
  expect(written.join('')).toBe('{"a":1}\n{"b":2}\n');
  await sessions.save(tab, true);
  expect(desktop.largeText.save).toHaveBeenLastCalledWith({ document: tab.document, revision: 3, auto: false, saveAs: true });
  await sessions.save(tab, false, true);
  expect(desktop.largeText.save).toHaveBeenLastCalledWith({ document: tab.document, revision: 3, auto: true, saveAs: false });
  // The whole-text saves would write the empty text field over the file.
  expect(desktop.saveTabDocument).not.toHaveBeenCalled();
  expect(desktop.saveDocumentAs).not.toHaveBeenCalled();
});

test('a large document without its editor model is not saved at all', () => {
  const { tab, sessions, editor, desktop } = largeFixture();
  editor.capture.mockReturnValueOnce(null);
  expect(() => sessions.save(tab)).toThrow('not loaded in an editor');
  expect(desktop.largeText.save).not.toHaveBeenCalled();
  expect(desktop.saveTabDocument).not.toHaveBeenCalled();
});
