import { afterEach, expect, test, vi } from 'vitest';
import { createWorkspaceTab } from '../../core/workspace/workspace-state';
import type { SaveResult } from '../../protocol/desktop-api';
import type { PptxSource } from '../../protocol/pptx-edit';
import { docxSessions } from '../docx/docx-sessions';
import { lastOfficeEditAt, officeEditOwner, officeEditSession } from '../office-edit/office-editors';
import type { PptxEngine, PptxMode } from './pptx-engine';
import { NotPresentationError, pptxSessions } from './pptx-sessions';

// The session rules themselves are the Word editor's (`docx-sessions.test.ts`); these cover what differs for a presentation.
afterEach(() => { vi.useRealTimers(); pptxSessions.releaseAll(); docxSessions.releaseAll(); });
function engine(mode: PptxMode) {
  const edits = new Set<() => void>();
  const fake = { mode, destroyed: false, serialized: 0, damaged: false, mounted: () => false,
    onEdit: vi.fn((listener: () => void) => { edits.add(listener); return () => { edits.delete(listener); }; }),
    setMode: vi.fn((next: PptxMode) => { fake.mode = next; }), run: vi.fn(() => true), destroy: vi.fn(() => { fake.destroyed = true; }),
    // The engine refuses to write a deck with a slide it could not read.
    serialize: vi.fn(() => fake.damaged ? Promise.reject(Error('This presentation cannot be saved because one of its slides could not be read.'))
      : Promise.resolve(new Uint8Array([++fake.serialized]))),
    edit: () => { for (const listener of [...edits]) listener(); } };
  return fake;
}
function fixture(file = '/decks/talk.pptx') {
  const doc = { kind: 'office' as const, officeEditor: 'presentation' as const, path: file, name: 'talk.pptx', text: '', savedText: '',
    revision: 0, savedRevision: 0, diskVersion: { size: 10, mtimeMs: 1 }, isUntitled: false };
  const tab = createWorkspaceTab('deck', doc, 'office', { sourceLine: 1, yRatio: .4, reason: 'empty-document', confidence: 'fallback' });
  const tabs = [tab], engines: ReturnType<typeof engine>[] = [];
  let finish!: (result: SaveResult) => void;
  const ports = { read: vi.fn(async (): Promise<PptxSource> => ({ bytes: new Uint8Array([1]), presentation: true })), changed: vi.fn(), tabs: () => tabs,
    save: vi.fn(() => new Promise<SaveResult>(resolve => { finish = resolve; })),
    runtime: vi.fn(async () => ({ openPptx: (_bytes: Uint8Array, options: { mode: PptxMode }) => {
      const created = engine(options.mode); engines.push(created); return created as unknown as PptxEngine;
    } })) };
  pptxSessions.configure(ports);
  // Both editors are configured at startup; the Word editor sees the same tabs and must leave this one alone.
  docxSessions.configure({ tabs: () => tabs, changed: vi.fn(), read: vi.fn(async () => ({ bytes: new Uint8Array([1]), word: true })),
    save: vi.fn(async (): Promise<SaveResult> => ({ canceled: true })), runtime: vi.fn(async () => { throw Error('The Word engine must not load for a presentation.'); }) });
  return { ports, tab, tabs, engines, finish: (result: SaveResult) => finish(result) };
}

test('only presentations main verified are owned, and never by the Word editor', async () => {
  const f = fixture();
  expect(pptxSessions.accepts(f.tab)).toBe(true);
  expect(docxSessions.accepts(f.tab)).toBe(false);
  expect(officeEditOwner(f.tab)).toBe(pptxSessions);
  for (const path of ['/decks/talk.ppt', '/decks/talk.pptm', '/decks/talk.potx', '/decks/report.docx'])
    expect(pptxSessions.accepts({ ...f.tab, document: { ...f.tab.document, path } })).toBe(false);
  // Neither the name alone nor the other editor's mark is enough.
  expect(pptxSessions.accepts({ ...f.tab, document: { ...f.tab.document, officeEditor: undefined } })).toBe(false);
  expect(pptxSessions.accepts({ ...f.tab, document: { ...f.tab.document, officeEditor: 'word' } })).toBe(false);
  expect(officeEditOwner({ ...f.tab, document: { ...f.tab.document, officeEditor: undefined } })).toBeUndefined();
  expect(f.ports.runtime).not.toHaveBeenCalled();
  const session = await pptxSessions.open(f.tab.id);
  expect(f.ports.read).toHaveBeenCalledExactlyOnceWith('/decks/talk.pptx', { size: 10, mtimeMs: 1 });
  expect(f.engines[0].mode).toBe('view');
  expect(officeEditSession(f.tab.id)).toBe(session);
  expect(docxSessions.get(f.tab.id)).toBeUndefined();
});

test('bytes that stopped being a presentation are refused before the engine loads', async () => {
  const f = fixture();
  f.ports.read.mockResolvedValueOnce({ bytes: new Uint8Array([1]), presentation: false });
  await expect(pptxSessions.open(f.tab.id)).rejects.toBeInstanceOf(NotPresentationError);
  expect(f.ports.runtime).not.toHaveBeenCalled();
  expect(pptxSessions.get(f.tab.id)).toBeUndefined();
});

test('an edit dirties the tab and a save sends the whole package for the revision it captured', async () => {
  vi.useFakeTimers(); vi.setSystemTime(5000);
  const f = fixture(), session = await pptxSessions.open(f.tab.id);
  f.engines[0].edit();
  expect(pptxSessions.dirty(f.tab)).toBe(true);
  expect(f.tab.revision).toBe(1);
  expect(lastOfficeEditAt()).toBe(5000);
  const saving = pptxSessions.save(f.tab);
  await vi.waitFor(() => expect(f.ports.save).toHaveBeenCalled());
  expect(f.ports.save.mock.calls[0]).toEqual([{ document: f.tab.document, bytes: new Uint8Array([1]), revision: 1, saveAs: false }]);
  f.finish({ canceled: false, document: { ...f.tab.document, revision: 1, savedRevision: 1 } });
  await saving;
  expect(session.edits).toBe(session.savedEdits);
  expect(pptxSessions.dirty(f.tab)).toBe(false);
});

test('a deck the engine cannot write is not saved and keeps its edits', async () => {
  const f = fixture(), session = await pptxSessions.open(f.tab.id);
  f.engines[0].edit(); f.engines[0].damaged = true;
  await expect(pptxSessions.save(f.tab)).rejects.toThrow('cannot be saved');
  expect(f.ports.save).not.toHaveBeenCalled();
  expect(pptxSessions.dirty(f.tab)).toBe(true);
  expect(session.busy).toBe(false);
  // Recovery has nothing to store either, and says so instead of storing an empty file.
  await expect(pptxSessions.backup(f.tab.id)).rejects.toThrow('cannot be saved');
});
