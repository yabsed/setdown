import { afterEach, expect, test, vi } from 'vitest';
import { WorkspaceState, createWorkspaceTab } from '../../../core/workspace/workspace-state';
import { PreviewLayoutCoordinator } from '../../reader/preview-layout-coordinator';
import { ReviewWorkspaceController } from './review-workspace';
import type { DesktopPort } from '../../ports/desktop-port';
import type { DocumentSnapshot, GitDiff } from '../../../protocol/desktop-api';
import { project } from '../project-state.svelte';

vi.mock('../project-state.svelte', () => ({ project: { folder: { path: '/p', name: 'p' }, gitDiffTabs: [], error: '' } }));
vi.mock('./review-state.svelte', async () => {
  const { project } = await import('../project-state.svelte');
  const defaults = () => ({ gitDiffTabs: [], activeGitDiffId: null, gitDiff: null, gitDiffTarget: null, gitDiffActive: false,
    gitDiffLoading: false, gitDiffMode: 'source', gitDiffPreviewLoading: false, gitDiffPreviewReady: false,
    gitDiffFrozen: false, gitDiffSnapshot: '', gitDiffLine: 1 });
  return { reviewDefaults: defaults, projectionKeys: Object.keys(defaults()).filter(key => key !== 'gitDiffTabs'), reviewViews: { entries: [] },
    createReviewState: () => new Proxy(defaults(), { get: (target, key) => Reflect.get(key in target ? target : project, key),
      set: (target, key, value) => Reflect.set(key in target ? target : project, key, value) }) };
});
afterEach(() => vi.unstubAllGlobals());
const snapshot: DocumentSnapshot = { path: '/p/a.txt', name: 'a.txt', text: 'disk', savedText: 'disk', revision: 0, savedRevision: 0,
  isUntitled: false, diskVersion: { mtimeMs: 1, size: 4 } };
function fixture() {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  Object.assign(project, { folder: { path: '/p', name: 'p' }, gitDiffTabs: [], error: '', gitBusy: false });
  const workspace = new WorkspaceState(), release = vi.fn(async () => true);
  const desktop = { readDocumentLocation: vi.fn(async () => snapshot),
    getGitDiff: async (filePath: string, staged: boolean): Promise<GitDiff> => ({ filePath, path: 'a.txt', staged,
      originalText: 'base', modifiedText: 'disk', originalLabel: 'INDEX', modifiedLabel: 'WORKTREE', patch: '', hunks: [] }),
    showPreview() {}, updateGitReviewState: vi.fn(), getGitReviewState: vi.fn(async () => null), destroyPreview() {},
  } as unknown as DesktopPort;
  const manager = new ReviewWorkspaceController({ workspace, desktop, layouts: new PreviewLayoutCoordinator(desktop),
    render() {}, confirmRelease: release,
    openWorkingTree: async () => { throw Error('Must not open an ordinary tab'); }, activateWorkingTree: () => false,
    workingTreeBuffer: path => workspace.documentStore.find(path)?.text ?? null, workingTreeChanged() {}, reviewChanged() {},
    activate: async id => { workspace.activeId = id; await manager.activateDiff(id); },
  });
  return { workspace, manager, desktop, release };
}
test('Working Tree first open owns content without an ordinary tab; same-group requests coalesce', async () => {
  const f = fixture();
  await Promise.all([f.manager.review('/p/a.txt', false), f.manager.review('/p/a.txt', false)]);
  expect(f.workspace.tabs).toHaveLength(1); expect(f.workspace.tabs[0].kind).toBe('diff');
  expect(f.workspace.documents).toHaveLength(0); expect(f.workspace.contents).toHaveLength(1);
  expect(f.workspace.activeContent?.text).toBe('disk');
  await f.manager.review('/p/a.txt', false); expect(f.workspace.tabs).toHaveLength(1);
  await f.manager.closeDiff(); expect(f.workspace.contents).toHaveLength(0);
});
test('ordinary and two Working Tree views retain one dirty content through independent closes', async () => {
  const f = fixture(); await f.manager.review('/p/a.txt', false);
  const first = f.workspace.active!; f.workspace.activeContent!.text = 'unsaved';
  await f.manager.copyToGroup(first.id, f.workspace.groups.focusedId, 'right');
  const second = f.workspace.active!;
  expect(f.workspace.groups.groups).toHaveLength(2); expect(f.workspace.contents).toHaveLength(1);
  expect(f.workspace.activeContent?.text).toBe('unsaved');
  const ordinary = createWorkspaceTab('file-view', snapshot, 'editor', { sourceLine: 1, yRatio: .5, reason: 'empty-document', confidence: 'fallback' });
  f.workspace.add(ordinary); expect(ordinary.text).toBe('unsaved');
  await f.manager.closeDiff(first.id); await f.manager.closeDiff(second.id);
  expect(f.release).not.toHaveBeenCalled(); expect(f.workspace.contents).toHaveLength(1);
  expect(ordinary.text).toBe('unsaved');
});
test('last review close honors cancellation and Index never owns a mutable document', async () => {
  const f = fixture(); await f.manager.review('/p/a.txt', false);
  const id = f.workspace.activeId!; f.release.mockResolvedValue(false);
  await f.manager.closeDiff(id); expect(f.workspace.find(id)).not.toBeNull();
  await f.manager.review('/p/a.txt', true);
  expect(f.workspace.activeContent).toBeNull(); expect(f.workspace.contents).toHaveLength(1);
  await f.manager.closeDiff(); expect(f.workspace.find(id)).not.toBeNull();
  f.release.mockResolvedValue(true); await f.manager.closeDiff(id); expect(f.workspace.contents).toHaveLength(0);
});

test('side opens reuse the right group and its comparison without moving the original', async () => {
  const f = fixture(); await f.manager.review('/p/a.txt', false);
  const left = f.workspace.groups.focusedId, first = f.workspace.activeId;
  await f.manager.review('/p/a.txt', false, { groupId: left, side: true });
  const right = f.workspace.groups.focusedId, second = f.workspace.activeId;
  expect(right).not.toBe(left); expect(second).not.toBe(first);
  await f.manager.review('/p/a.txt', false, { groupId: left, side: true });
  expect(f.workspace.activeId).toBe(second); expect(f.workspace.groups.groups).toHaveLength(2);
  expect(f.workspace.groups.owner(first!)?.id).toBe(left); expect(f.workspace.contents).toHaveLength(1);
});

test('a late comparison read cannot replace a newer request in the same group', async () => {
  const f = fixture(); let complete!: (document: DocumentSnapshot) => void;
  vi.mocked(f.desktop.readDocumentLocation).mockImplementationOnce(() => new Promise(resolve => complete = resolve));
  const slow = f.manager.review('/p/slow.txt', false);
  await f.manager.review('/p/a.txt', false); const current = f.workspace.activeId;
  complete({ ...snapshot, path: '/p/slow.txt', name: 'slow.txt' }); await slow;
  expect(f.workspace.activeId).toBe(current); expect(f.workspace.tabs).toHaveLength(1);
  expect(f.workspace.documentStore.find('/p/slow.txt')).toBeUndefined();
});

test('a late background comparison keeps the group focused by the user', async () => {
  const f = fixture(); await f.manager.review('/p/a.txt', false);
  const left = f.workspace.groups.focusedId, right = f.workspace.groups.split(left, 'right');
  const ordinary = createWorkspaceTab('right-file', { ...snapshot, path: '/p/b.txt', name: 'b.txt' }, 'editor', { sourceLine: 1, yRatio: .5, reason: 'empty-document', confidence: 'fallback' });
  f.workspace.add(ordinary, true, right.id);
  let complete!: (document: DocumentSnapshot) => void;
  vi.mocked(f.desktop.readDocumentLocation).mockImplementationOnce(() => new Promise(resolve => complete = resolve));
  const pending = f.manager.review('/p/slow.txt', false);
  f.workspace.activeId = ordinary.id;
  complete({ ...snapshot, path: '/p/slow.txt', name: 'slow.txt' }); await pending;
  expect(f.workspace.groups.focusedId).toBe(right.id); expect(f.workspace.activeId).toBe(ordinary.id);
  const selected = f.workspace.find(f.workspace.groups.groups.find(group => group.id === left)!.activeId!);
  expect(selected?.kind === 'diff' && selected.filePath).toBe('/p/slow.txt');
});


test('renderer Reload restores the native window checkpoint without a fake ordinary tab', async () => {
  const f = fixture();
  vi.mocked(f.desktop.getGitReviewState).mockResolvedValue({ name: 'a.txt (Working Tree)', path: '/p/a.txt', dirty: false, isUntitled: false, staged: false, active: true, mode: 'source', line: 3 });
  await f.manager.restore(); expect(f.workspace.tabs).toHaveLength(1); expect(f.workspace.documents).toHaveLength(0);
  expect(f.workspace.active?.kind).toBe('diff');
  const ordinary = createWorkspaceTab('ordinary', snapshot, 'editor', { sourceLine: 1, yRatio: .5, reason: 'empty-document', confidence: 'fallback' });
  f.workspace.add(ordinary); f.workspace.activeId = ordinary.id; f.manager.sync();
  expect(vi.mocked(f.desktop.updateGitReviewState).mock.lastCall?.[0]?.active).toBe(false);
});
