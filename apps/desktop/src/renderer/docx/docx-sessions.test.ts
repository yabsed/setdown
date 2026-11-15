import { afterEach, expect, test, vi } from 'vitest';
import { createWorkspaceTab } from '../../core/workspace/workspace-state';
import type { SaveResult } from '../../protocol/desktop-api';
import type { DocxEngine, DocxMode } from './docx-engine';
import { docxSessions, NotWordDocumentError } from './docx-sessions';
import type { DocxSource } from '../../protocol/docx-edit';

afterEach(() => { vi.useRealTimers(); docxSessions.releaseAll(); });
function engine(mode: DocxMode) {
  const edits = new Set<() => void>();
  const fake = { mode, destroyed: false, serialized: 0, shown: false, mounted: () => fake.shown,
    onEdit: vi.fn((listener: () => void) => { edits.add(listener); return () => { edits.delete(listener); }; }),
    setMode: vi.fn((next: DocxMode) => { fake.mode = next; }), run: vi.fn(() => true),
    destroy: vi.fn(() => { fake.destroyed = true; }),
    // Like the engine, a save first commits input it was still holding, then captures the document.
    pendingInput: false,
    serialize: vi.fn(() => { if (fake.pendingInput) { fake.pendingInput = false; fake.edit(); } return Promise.resolve(new Uint8Array([++fake.serialized])); }),
    edit: () => { for (const listener of [...edits]) listener(); } };
  return fake;
}
function fixture(file = '/docs/report.docx') {
  const doc = { kind: 'office' as const, officeEditor: 'word' as const, path: file, name: 'report.docx', text: '', savedText: '',
    revision: 0, savedRevision: 0, diskVersion: { size: 10, mtimeMs: 1 }, isUntitled: false };
  const tab = createWorkspaceTab('word', doc, 'office', { sourceLine: 1, yRatio: .4, reason: 'empty-document', confidence: 'fallback' });
  const tabs = [tab], engines: ReturnType<typeof engine>[] = [];
  let finish!: (result: SaveResult) => void;
  const ports = { read: vi.fn(async (): Promise<DocxSource> => ({ bytes: new Uint8Array([1]), word: true })), changed: vi.fn(), tabs: () => tabs,
    save: vi.fn(() => new Promise<SaveResult>(resolve => { finish = resolve; })),
    runtime: vi.fn(async () => ({ openDocx: (_bytes: Uint8Array, options: { mode: DocxMode }) => {
      const created = engine(options.mode); engines.push(created); return created as unknown as DocxEngine;
    } })) };
  docxSessions.configure(ports);
  return { ports, tab, tabs, engines, finish: (result: SaveResult) => finish(result) };
}

test('only verified Word documents are owned, and the engine loads on first open against the tab\'s disk version', async () => {
  const f = fixture();
  expect(docxSessions.accepts(f.tab)).toBe(true);
  for (const path of ['/docs/report.doc', '/docs/budget.xlsx', '/docs/form.docm'])
    expect(docxSessions.accepts({ ...f.tab, document: { ...f.tab.document, path } })).toBe(false);
  expect(docxSessions.accepts({ ...f.tab, document: { ...f.tab.document, kind: undefined } })).toBe(false);
  // The name is not enough: main has to have found a Word document package behind it.
  expect(docxSessions.accepts({ ...f.tab, document: { ...f.tab.document, officeEditor: undefined } })).toBe(false);
  expect(f.ports.runtime).not.toHaveBeenCalled();
  const [first, second] = await Promise.all([docxSessions.open(f.tab.id), docxSessions.open(f.tab.id)]);
  expect(first).toBe(second);
  expect(f.ports.read).toHaveBeenCalledExactlyOnceWith('/docs/report.docx', { size: 10, mtimeMs: 1 });
  expect(f.engines).toHaveLength(1);
  expect(f.engines[0].mode).toBe('view');
  expect(docxSessions.dirty(f.tab)).toBe(false);
  expect(docxSessions.text()).toBe('');
});

test('an edit dirties the tab, a late save acknowledgment does not clear a newer edit, and failures keep the edits', async () => {
  const f = fixture(), session = await docxSessions.open(f.tab.id);
  f.engines[0].edit();
  expect(docxSessions.dirty(f.tab)).toBe(true);
  expect(f.tab.revision).toBe(1);
  expect(f.ports.changed).toHaveBeenCalled();
  const saving = docxSessions.save(f.tab);
  expect(session.busy).toBe(true);
  // A second save cannot start while the package is being written.
  expect(await docxSessions.save(f.tab)).toEqual({ canceled: true });
  await vi.waitFor(() => expect(f.ports.save).toHaveBeenCalledOnce());
  expect(f.ports.save).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, saveAs: false, bytes: new Uint8Array([1]) }));
  f.engines[0].edit();
  f.finish({ canceled: false, document: { ...f.tab.document, revision: 1, savedRevision: 1 } }); await saving;
  expect(docxSessions.dirty(f.tab)).toBe(true);
  expect(session.busy).toBe(false);

  const again = docxSessions.save(f.tab);
  await vi.waitFor(() => expect(f.ports.save).toHaveBeenCalledTimes(2));
  f.finish({ canceled: false, document: { ...f.tab.document, path: '/docs/copy.docx', revision: 2, savedRevision: 2 } }); await again;
  expect(docxSessions.dirty(f.tab)).toBe(false);
  expect(session.path).toBe('/docs/copy.docx');
  // A clean document saves nothing unless a new name is requested.
  expect(await docxSessions.save(f.tab)).toEqual({ canceled: true });
  expect(f.ports.save).toHaveBeenCalledTimes(2);

  // Input the engine commits as the save starts is part of the saved package, not a newer edit.
  f.engines[0].edit(); f.engines[0].pendingInput = true;
  const flushed = docxSessions.save(f.tab);
  await vi.waitFor(() => expect(f.ports.save).toHaveBeenCalledTimes(3));
  expect(f.ports.save).toHaveBeenLastCalledWith(expect.objectContaining({ revision: f.tab.revision }));
  f.finish({ canceled: false, document: { ...f.tab.document, revision: f.tab.revision, savedRevision: f.tab.revision } }); await flushed;
  expect(docxSessions.dirty(f.tab)).toBe(false);

  f.engines[0].edit();
  f.ports.save.mockRejectedValueOnce(Error('This document changed on disk.'));
  await expect(docxSessions.save(f.tab)).rejects.toThrow('changed on disk');
  expect(session.error).toBe('This document changed on disk.');
  expect(docxSessions.dirty(f.tab)).toBe(true);
  const canceled = docxSessions.save(f.tab, true);
  await vi.waitFor(() => expect(f.ports.save).toHaveBeenCalledTimes(5));
  f.finish({ canceled: true }); await canceled;
  expect(docxSessions.dirty(f.tab)).toBe(true);
  expect(session.error).toBeUndefined();
});

test('the editing mode, undo routing and recovery bytes belong to the session, not to a mounted surface', async () => {
  const f = fixture();
  docxSessions.setMode(f.tab.id, 'edit');
  const session = await docxSessions.open(f.tab.id);
  expect(f.engines[0].mode).toBe('edit');
  docxSessions.setMode(f.tab.id, 'view');
  expect(f.engines[0].setMode).toHaveBeenCalledExactlyOnceWith('view');
  docxSessions.history(f.tab.id, 'undo'); docxSessions.history(f.tab.id, 'redo');
  expect(f.engines[0].run.mock.calls).toEqual([['history.undo'], ['history.redo']]);
  expect(await docxSessions.backup(f.tab.id)).toEqual(new Uint8Array([1]));
  docxSessions.fail(f.tab.id, Error('disk full'));
  expect(session.error).toBe('disk full');
});

test('an unmounted surface keeps edited documents and frees unedited ones; reload and close always free the engine', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const first = await docxSessions.open(f.tab.id);
  docxSessions.setMode(f.tab.id, 'edit');
  // A replacement surface (Save As, a moved pane) mounted the engine again before the old one finished leaving.
  f.engines[0].shown = true;
  docxSessions.evict(f.tab.id); vi.runAllTimers();
  expect(f.engines[0].destroyed).toBe(false);
  f.engines[0].shown = false;
  docxSessions.evict(f.tab.id);
  expect(f.engines[0].destroyed).toBe(false);
  vi.runAllTimers();
  expect(f.engines[0].destroyed).toBe(true);
  expect(docxSessions.get(f.tab.id)).toBeUndefined();
  // The reader returns to the mode they left, read again from disk.
  const second = await docxSessions.open(f.tab.id);
  expect(second).not.toBe(first);
  expect(f.engines[1].mode).toBe('edit');
  f.engines[1].edit();
  docxSessions.evict(f.tab.id); vi.runAllTimers();
  expect(f.engines[1].destroyed).toBe(false);
  expect(docxSessions.get(f.tab.id)).toBe(second);

  // Reload from disk discards the edited state; subscribers hear about it after the caller assigned the new snapshot.
  const listener = vi.fn(); docxSessions.subscribe(listener);
  docxSessions.replace(f.tab);
  expect(f.engines[1].destroyed).toBe(true);
  expect(docxSessions.dirty(f.tab)).toBe(false);
  expect(listener).not.toHaveBeenCalled();
  f.tab.document = { ...f.tab.document, diskVersion: { size: 20, mtimeMs: 2 } };
  await Promise.resolve();
  expect(listener).toHaveBeenCalledOnce();
  await docxSessions.open(f.tab.id);
  expect(f.ports.read).toHaveBeenLastCalledWith('/docs/report.docx', { size: 20, mtimeMs: 2 });

  // Edits made in an engine that was replaced meanwhile never dirty the tab.
  const revision = f.tab.revision;
  f.engines[1].edit();
  expect(f.tab.revision).toBe(revision);
  docxSessions.release(f.tab.id);
  expect(f.engines[2].destroyed).toBe(true);
  expect(docxSessions.mode(f.tab.id)).toBe('view');
});

test('a document closed or reloaded while it opens never becomes a session', async () => {
  const f = fixture();
  let deliver!: (source: DocxSource) => void;
  f.ports.read.mockImplementationOnce(() => new Promise<DocxSource>(resolve => { deliver = resolve; }));
  const opening = docxSessions.open(f.tab.id);
  docxSessions.replace(f.tab);
  deliver({ bytes: new Uint8Array([1]), word: true });
  await expect(opening).rejects.toThrow('no longer open');
  expect(f.engines).toHaveLength(0);
  // Bytes that stopped being a Word package since the tab opened never reach the engine, which is not even loaded.
  const loads = f.ports.runtime.mock.calls.length;
  f.ports.read.mockResolvedValueOnce({ bytes: new Uint8Array([1]), word: false });
  await expect(docxSessions.open(f.tab.id)).rejects.toBeInstanceOf(NotWordDocumentError);
  expect(f.engines).toHaveLength(0);
  expect(f.ports.runtime).toHaveBeenCalledTimes(loads);
  expect(docxSessions.get(f.tab.id)).toBeUndefined();
  f.tabs.pop();
  await expect(docxSessions.open(f.tab.id)).rejects.toThrow('no longer open');
  await expect(docxSessions.backup(f.tab.id)).rejects.toThrow('recovery is unavailable');
});
