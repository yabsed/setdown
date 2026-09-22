import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LocalGitBackend } from '@web-git-graph/node';
import { GitGraphProtocolError, type GitGraphPage } from '@web-git-graph/protocol';
import type { WindowState } from '../windows/window-state';
import { GitCli } from './engines/git-cli';
import { GitHistoryService } from './git-history-service';

let root: string, state: WindowState, service: GitHistoryService;
const git = (...args: string[]) => GitCli.run(root, args);
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'setdown-graph-'));
  state = { projectRoot: root, window: new EventEmitter() } as unknown as WindowState;
  service = new GitHistoryService();
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Graph Test');
  await git('config', 'user.email', 'graph@example.test');
});
afterEach(async () => { vi.restoreAllMocks(); state.window.emit('closed'); await rm(root, { recursive: true, force: true }); });
async function commit(message: string) { await git('add', '-A'); await git('commit', '-m', message); return (await git('rev-parse', 'HEAD')).trim(); }
const history = (cursor?: string) => service.request(state, { id: crypto.randomUUID(), root, method: 'history', params: { limit: 1, cursor } }) as Promise<GitGraphPage>;

test('root, rename and deleted commit files open as immutable document comparisons', async () => {
  await writeFile(path.join(root, '한글 note.md'), '# Original\n');
  const first = await commit('initial');
  const initial = await service.diff(state, { root, head: first, path: '한글 note.md' });
  expect(initial.originalText).toBe('');
  expect(initial.modifiedText).toBe('# Original\n');
  expect(initial.history?.head).toBe(first);
  await git('mv', '한글 note.md', 'renamed.md');
  const renamed = await commit('rename');
  const renameDiff = await service.diff(state, { root, head: renamed, path: 'renamed.md' });
  expect(renameDiff.originalText).toBe('# Original\n');
  expect(renameDiff.modifiedText).toBe('# Original\n');
  await git('rm', 'renamed.md');
  const deleted = await commit('delete');
  const deletion = await service.diff(state, { root, head: deleted, path: 'renamed.md' });
  expect(deletion.originalText).toBe('# Original\n');
  expect(deletion.modifiedText).toBe('');
});

test('paging stays on pinned tips after a new commit; invalid roots and operations are rejected', async () => {
  await writeFile(path.join(root, 'note.md'), '# First\n');
  const first = await commit('first');
  await writeFile(path.join(root, 'note.md'), '# Second\n');
  const second = await commit('second');
  const page = await history();
  expect(page.commits.map((c) => c.oid)).toEqual([second]);
  expect(page.hasMore).toBe(true);
  await writeFile(path.join(root, 'note.md'), '# Third\n');
  await commit('third');
  expect((await history(page.cursor)).commits.map((c) => c.oid)).toEqual([first]);
  await expect(service.diff(state, { root, head: 'HEAD~1', path: 'note.md' })).rejects.toThrow('Invalid commit');
  await expect(service.diff(state, { root, head: first, path: '../note.md' })).rejects.toThrow('Invalid repository path');
  await expect(service.diff(state, { root: '/another', head: first, path: 'note.md' })).rejects.toThrow('repository changed');
  const diff = await service.diff(state, { root, head: second, base: first, path: 'note.md' });
  expect(diff.originalText).toBe('# First\n');
  expect(diff.modifiedText).toBe('# Second\n');
});

test('unborn repositories are empty and binary files are not passed to the Markdown renderer', async () => {
  expect((await history()).commits).toEqual([]);
  await writeFile(path.join(root, 'binary.md'), Buffer.from([0, 1, 2]));
  const head = await commit('binary');
  expect((await service.diff(state, { root, head, path: 'binary.md' })).modifiedText).toBeNull();
});

test('canceled Git processes resolve quietly while real Git failures still reject', async () => {
  await history(); // Resolve the real backend before controlling its next Git request.
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const backend = vi.spyOn(LocalGitBackend.prototype, 'getHistory').mockImplementationOnce((_id, _query, signal) => {
    return new Promise<GitGraphPage>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new GitGraphProtocolError('git_unavailable', 'Git command failed.')), { once: true });
      entered();
    });
  });
  const id = 'canceled-history';
  const pending = service.request(state, { id, root, method: 'history', params: {} });
  await started;
  service.cancel(state, id);
  expect(await pending).toBeNull();

  backend.mockRejectedValueOnce(new GitGraphProtocolError('git_unavailable', 'Actual Git failure.'));
  await expect(history()).rejects.toThrow('Actual Git failure.');
});

test('merged branches retain both parents and review uses the first-parent change list', async () => {
  await writeFile(path.join(root, 'base.md'), '# Base\n');
  await commit('base');
  await git('switch', '-c', 'feature');
  await writeFile(path.join(root, 'feature.md'), '# Feature\n');
  const feature = await commit('feature');
  await git('switch', 'main');
  await writeFile(path.join(root, 'main.md'), '# Main\n');
  const main = await commit('main');
  await git('merge', '--no-ff', 'feature', '-m', 'merge feature');
  const merged = (await git('rev-parse', 'HEAD')).trim();
  const page = await history();
  expect(page.commits[0].parents).toEqual([main, feature]);
  expect(page.refs.some((ref) => ref.target === feature)).toBe(true);
  const diff = await service.diff(state, { root, head: merged, path: 'feature.md' });
  expect(diff.originalText).toBe('');
  expect(diff.modifiedText).toBe('# Feature\n');
  await expect(service.request(state, { id: 'oversized', root, method: 'history', params: { limit: 10000 } })).rejects.toThrow('Invalid history query');
});
