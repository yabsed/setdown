import { afterEach, expect, test, vi } from 'vitest';
import { imageSessions } from './image-edit-sessions';
import { createWorkspaceTab } from '../../core/workspace/workspace-state';
import { rotateRecipe } from '../../core/image/image-recipe';
import type { SaveResult } from '../../protocol/desktop-api';

afterEach(() => imageSessions.releaseAll());
function fixture() {
  const doc = { kind: 'image' as const, path: '/test.png', name: 'test.png', text: '', savedText: '',
    revision: 0, savedRevision: 0, diskVersion: { size: 10, mtimeMs: 1 }, isUntitled: false };
  const tab = createWorkspaceTab('image', doc, 'image', { sourceLine: 1, yRatio: .4, reason: 'empty-document', confidence: 'fallback' });
  const tabs = [tab];
  let finish!: (result: SaveResult) => void;
  const api = { open: vi.fn(async () => ({ id: 'source', width: 80, height: 40, format: 'png' as const, preview: new Uint8Array() })),
    render: vi.fn(async () => new Uint8Array()), release: vi.fn(), save: vi.fn(() => new Promise<SaveResult>(resolve => { finish = resolve; })) };
  imageSessions.configure(api, () => tabs, () => {});
  return { api, tab, tabs, finish: (result: SaveResult) => finish(result) };
}
test('view disposal keeps session/history; a late save does not clear a newer edit', async () => {
  const f = fixture(), s = await imageSessions.open(f.tab.id);
  const unsubscribe = imageSessions.subscribe(() => {}); unsubscribe();
  imageSessions.edit(f.tab.id, rotateRecipe(s.history.current, 80, 40));
  const saving = imageSessions.save(f.tab);
  imageSessions.edit(f.tab.id, rotateRecipe(s.history.current, 80, 40));
  f.finish({ canceled: false, document: { ...f.tab.document, revision: 1, savedRevision: 1 } }); await saving;
  expect(imageSessions.dirty(f.tab)).toBe(true); expect(s.history.current.turns).toBe(2);
  imageSessions.undo(f.tab.id); expect(imageSessions.dirty(f.tab)).toBe(false);
  expect(await imageSessions.open(f.tab.id)).toBe(s); expect(f.api.open).toHaveBeenCalledTimes(1);
  f.tabs.pop(); imageSessions.release(f.tab.id); expect(f.api.release).toHaveBeenCalledOnce();
});
test('failed/canceled saves retain edits and reload releases the immutable source', async () => {
  const f = fixture(), s = await imageSessions.open(f.tab.id);
  imageSessions.edit(f.tab.id, { ...s.history.current, contrast: .4 });
  const saving = imageSessions.save(f.tab); f.finish({ canceled: true }); await saving;
  expect(s.history.dirty).toBe(true); expect(s.busy).toBe(false);
  imageSessions.replace(f.tab); expect(imageSessions.get(f.tab.id)).toBeUndefined(); expect(f.api.release).toHaveBeenCalledWith('source');
});
