import { afterEach, expect, test, vi } from 'vitest';
import type { GitGraphPage } from '@web-git-graph/protocol';
import type { GitGraphProvider, WebGitGraphElement } from '@web-git-graph/web';
import { GitGraphRefresh, sameHistory } from './git-graph-refresh';

const page = (oid = 'first'): GitGraphPage => ({
  commits: [{ oid, message: oid, parents: [], kind: 'commit' }],
  refs: [{ name: 'refs/heads/main', target: oid, kind: 'current' }],
  head: oid, hasMore: false, repositoryId: 'current', repositoryName: 'project',
});
afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers();
  const graph = Object.assign(new EventTarget(), {
    data: page(), refs: ['refs/heads/main'], busy: false,
    getAttribute: () => String(graph.busy),
    refresh: () => {
      if (graph.dispatchEvent(new Event('gitgraph-refresh', { cancelable: true }))) redraw();
    },
  });
  const redraw = vi.fn(), reportError = vi.fn();
  const getHistory = vi.fn<GitGraphProvider['getHistory']>().mockResolvedValue(page());
  const refresh = new GitGraphRefresh(graph as unknown as WebGitGraphElement, { getHistory }, reportError);
  return { graph, redraw, getHistory, refresh, reportError };
}
const settle = () => vi.advanceTimersByTimeAsync(300);

test('no-op refresh retains the displayed page despite a new snapshot cursor', async () => {
  const f = fixture();
  f.getHistory.mockResolvedValue({ ...page(), cursor: 'new-snapshot' });
  f.graph.refresh(); f.graph.refresh(); f.graph.refresh();
  await settle();
  expect(f.getHistory).toHaveBeenCalledTimes(1);
  expect(f.redraw).not.toHaveBeenCalled();
  expect(f.graph.data.cursor).toBe('new-snapshot');
  f.refresh.dispose();
});

test('new commits, ref-only changes and detached HEAD changes are not suppressed', async () => {
  const f = fixture();
  for (const changed of [page('new'), { ...page(), refs: [] }, { ...page(), head: 'detached' }]) {
    f.getHistory.mockResolvedValue(changed);
    f.graph.refresh(); await settle();
  }
  expect(f.redraw).toHaveBeenCalledTimes(3);
  f.refresh.dispose();
});

test('additional loaded pages survive an unchanged first page', () => {
  const first = { ...page(), hasMore: true, cursor: 'new' };
  const loaded = { ...page(), commits: [...page().commits, ...page('older').commits] };
  expect(sameHistory(loaded, first)).toBe(true);
  expect(sameHistory(loaded, page())).toBe(false);
  expect(sameHistory(page(), first)).toBe(false);
  expect(sameHistory(page(), { ...page(), commits: [] })).toBe(false);
});

test('unchanged paging renews the cursor at the loaded depth without resetting the graph', async () => {
  const f = fixture();
  const older = page('older').commits;
  f.graph.data = { ...page(), commits: [...page().commits, ...older], hasMore: true, cursor: 'expired' };
  f.getHistory.mockResolvedValueOnce({ ...page(), hasMore: true, cursor: 'fresh-first' })
    .mockResolvedValueOnce({ ...page(), commits: older, hasMore: true, cursor: 'fresh-second' });
  f.refresh.request(); await settle();
  expect(f.getHistory).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'fresh-first' }));
  expect(f.graph.data.commits).toHaveLength(2);
  expect(f.graph.data.cursor).toBe('fresh-second');
  expect(f.redraw).not.toHaveBeenCalled();
  f.refresh.dispose();
});

test('a burst during an in-flight check retains one trailing read', async () => {
  const f = fixture();
  let finish!: (value: GitGraphPage) => void;
  f.getHistory.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  f.refresh.request(); await settle();
  f.refresh.request(); f.refresh.request(); await settle();
  expect(f.getHistory).toHaveBeenCalledTimes(1);
  finish(page()); await settle();
  expect(f.getHistory).toHaveBeenCalledTimes(2);
  expect(f.redraw).not.toHaveBeenCalled();
  f.refresh.dispose();
});

test('filter changes discard a stale check and recheck the new selection', async () => {
  const f = fixture();
  let finish!: (value: GitGraphPage) => void;
  f.getHistory.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  f.refresh.request(); await settle();
  f.graph.refs = ['refs/heads/topic'];
  finish(page('stale')); await settle();
  expect(f.redraw).not.toHaveBeenCalled();
  expect(f.getHistory).toHaveBeenLastCalledWith(expect.objectContaining({ refs: ['refs/heads/topic'] }));
  f.refresh.dispose();
});

test('initial loading and paging finish before checking for changes', async () => {
  const f = fixture();
  f.graph.busy = true;
  f.refresh.request(); await settle();
  expect(f.getHistory).not.toHaveBeenCalled();
  f.graph.busy = false; await settle();
  expect(f.getHistory).toHaveBeenCalledTimes(1);
  f.refresh.dispose();
});

test('a page replaced during a check is not overwritten by its stale result', async () => {
  const f = fixture();
  let finish!: (value: GitGraphPage) => void;
  f.getHistory.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  f.refresh.request(); await settle();
  f.graph.data = page('newer');
  f.getHistory.mockResolvedValue(page('newer'));
  finish(page('stale')); await settle();
  expect(f.redraw).not.toHaveBeenCalled();
  expect(f.getHistory).toHaveBeenCalledTimes(2);
  f.refresh.dispose();
});

test('closing the pane aborts pending work and ignores late replies', async () => {
  const f = fixture();
  let finish!: (value: GitGraphPage) => void;
  f.getHistory.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  f.refresh.request(); await settle();
  f.refresh.request(); f.refresh.dispose();
  expect(f.getHistory.mock.calls[0][0]?.signal?.aborted).toBe(true);
  finish(page('late')); await settle();
  expect(f.getHistory).toHaveBeenCalledTimes(1);
  expect(f.redraw).not.toHaveBeenCalled();
  expect(f.reportError).not.toHaveBeenCalled();
});

test('errors retain the graph and a later request can recover', async () => {
  const f = fixture();
  f.getHistory.mockRejectedValueOnce(new Error('Git unavailable'));
  f.refresh.request(); await settle();
  expect(f.reportError).toHaveBeenCalledOnce();
  expect(f.redraw).not.toHaveBeenCalled();
  f.getHistory.mockResolvedValue(page('recovered'));
  f.refresh.request(); await settle();
  expect(f.redraw).toHaveBeenCalledOnce();
  f.refresh.dispose();
});
