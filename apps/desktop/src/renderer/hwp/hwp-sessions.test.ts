import { expect, test, vi } from 'vitest';
import { HwpSessions } from './hwp-sessions';
import type { HwpApi, HwpState } from '../../protocol/hwp';
import { createWorkspaceTab } from '../../core/workspace/workspace-state';
function fixture() {
  const tab = createWorkspaceTab('hwp-1', { kind: 'hwp', path: '/a.hwp', name: 'a.hwp', text: '', savedText: '',
    revision: 0, savedRevision: 0, diskVersion: { size: 100, mtimeMs: 1 }, isUntitled: false }, 'hwp',
  { sourceLine: 1, yRatio: .5, reason: 'empty-document', confidence: 'fallback' });
  let publish!: (state: HwpState) => void;
  const state: HwpState = { id: tab.id, path: tab.document.path, generation: 'one', ready: true, revision: 0, savedRevision: 0 };
  const api = { onState: vi.fn(listener => { publish = listener; return () => {}; }), open: vi.fn(async () => state),
    save: vi.fn(async () => ({ canceled: false, document: tab.document })), release: vi.fn() } as unknown as HwpApi;
  const sessions = new HwpSessions(); sessions.configure(api, () => [tab], vi.fn());
  return { tab, sessions, api, state, publish: (value: Partial<HwpState>) => publish({ ...state, ...value }) };
}
test('an exported revision clears only that revision; saved callbacks and late opens cannot erase newer edits', async () => {
  const { tab, sessions, api, publish } = fixture();
  await sessions.ensure(tab); publish({ revision: 2 }); expect(sessions.dirty(tab)).toBe(true);
  publish({ revision: 3, savedRevision: 2 }); sessions.saved(); expect(sessions.dirty(tab)).toBe(true);
  publish({ revision: 0, ready: false }); expect(tab.revision).toBe(3); expect(sessions.dirty(tab)).toBe(true);
  publish({ revision: 3, savedRevision: 3 }); expect(sessions.dirty(tab)).toBe(false);
  expect(sessions.text()).toBe(''); await sessions.save(tab, true); expect(api.save).toHaveBeenCalledWith(tab.id, true);
  sessions.release(tab.id); expect(api.release).toHaveBeenCalledWith(tab.id);
});
test('a newly adopted dirty runtime remains dirty before its asynchronous open reply', async () => {
  const { tab, sessions } = fixture(); tab.revision = 7; tab.document.savedRevision = 3;
  expect(sessions.dirty(tab)).toBe(true);
});
test('a replaced path ignores stale runtime events for the previous document in the same tab', async () => {
  const { tab, sessions, publish } = fixture(); await sessions.ensure(tab); sessions.release(tab.id);
  tab.document = { ...tab.document, path: '/replacement.hwpx' };
  publish({ revision: 100 }); expect(sessions.state(tab.id)).toBeUndefined();
});
