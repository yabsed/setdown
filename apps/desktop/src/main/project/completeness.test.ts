import { mkdtemp, mkdir, writeFile, readFile, rm, rename, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { GitCli } from './engines/git-cli';
import { GitService } from './git-service';
import { ProjectPaths } from './project-paths';
import { ExplorerService } from './explorer-service';
import { RipgrepFiles } from './engines/ripgrep-files';
import { diskVersion, sameDiskVersion } from '../documents/file-system';
import { DocumentManager } from '../documents/document-manager';
import type { WindowState } from '../windows/window-state';
import { EventEmitter } from 'node:events';
import { GitMetadataWatcher } from './engines/git-metadata-watcher';

const roots: string[] = [], cleanup: Array<() => void> = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) fn(); vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function folder() { const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-complete-')); roots.push(root); return root; }
const state = (root: string) => ({ projectRoot: root, rendererTabs: [], currentDocument: null, window: { webContents: { send: vi.fn() } } } as unknown as WindowState);
async function repository() {
  const root = await folder(); await GitCli.run(root, ['init']);
  await GitCli.run(root, ['config', 'user.name', 'Tests']); await GitCli.run(root, ['config', 'user.email', 'tests@example.invalid']);
  return { root, git: new GitService(new ProjectPaths()), owner: state(root) };
}

test('a subfolder shows every staged file that the subsequent commit contains', async () => {
  const { root, git } = await repository(); const opened = path.join(root, 'opened'); await mkdir(opened);
  const a = path.join(opened, 'a.txt'), b = path.join(root, 'b.txt'); await writeFile(a, 'a'); await writeFile(b, 'b');
  const owner = state(opened); await git.stage(owner, [a, b]);
  expect((await git.status(owner)).changes.map(change => change.path).sort()).toEqual(['b.txt', 'opened/a.txt']);
  await git.commit(owner, 'both'); expect((await GitCli.run(root, ['show', '--pretty=', '--name-only', 'HEAD'])).trim().split('\n')).toEqual(['b.txt', 'opened/a.txt']);
});
test('unstaging a staged rename removes both the old deletion and new addition', async () => {
  const { root, git, owner } = await repository(); const old = path.join(root, 'old.md'), next = path.join(root, 'new.md');
  await writeFile(old, '# unchanged'); await git.stage(owner, [old]); await git.commit(owner, 'base');
  await rename(old, next); await git.stage(owner, [old, next]);
  expect((await git.status(owner)).changes[0].previousPath).toBe('old.md');
  expect((await git.unstage(owner, [next])).changes.every(change => !change.staged)).toBe(true);
});
test('unmerged review reads ours, theirs and the common ancestor from distinct index stages', async () => {
  const { root, git, owner } = await repository(); const file = path.join(root, 'note.txt');
  await writeFile(file, 'base\n'); await git.stage(owner, [file]); await git.commit(owner, 'base');
  const branch = (await GitCli.run(root, ['branch', '--show-current'])).trim(); await GitCli.run(root, ['checkout', '-qb', 'other']);
  await writeFile(file, 'theirs\n'); await git.stage(owner, [file]); await git.commit(owner, 'theirs');
  await GitCli.run(root, ['checkout', branch]); await writeFile(file, 'ours\n'); await git.stage(owner, [file]); await git.commit(owner, 'ours');
  await expect(GitCli.run(root, ['merge', 'other'])).rejects.toThrow();
  expect(await git.diff(owner, file, false)).toMatchObject({ originalText: 'ours\n', conflict: { base: 'base\n', ours: 'ours\n', theirs: 'theirs\n' } });
});
test('an index lock error never falls back to removing tracked entries', async () => {
  const { root, git, owner } = await repository(); const file = path.join(root, 'note.txt');
  await writeFile(file, 'base'); await git.stage(owner, [file]); await git.commit(owner, 'base');
  await writeFile(file, 'next'); await git.stage(owner, [file]); await writeFile(path.join(root, '.git/index.lock'), 'lock');
  await expect(git.unstage(owner, [file])).rejects.toThrow('index.lock');
  expect((await git.status(owner)).changes[0].indexStatus).toBe('M');
});
test('external import copies all sources and preserves destination scope and source bytes', async () => {
  const root = await folder(), external = await folder(), owner = state(root), service = new ExplorerService(new ProjectPaths());
  const file = path.join(external, 'outside.txt'); await writeFile(file, 'outside');
  await expect(service.transfer(owner, { kind: 'copy', paths: [file], target: root })).rejects.toThrow('outside');
  const result = await service.transfer(owner, { kind: 'import', paths: [file], target: root });
  expect(result.items[0].status).toBe('completed'); expect(await readFile(file, 'utf8')).toBe('outside');
  expect(await readFile(path.join(root, 'outside.txt'), 'utf8')).toBe('outside');
  await expect(service.transfer(owner, { kind: 'import', paths: [file], target: external })).rejects.toThrow('outside');
});
test('undo restores a move but refuses a destination changed after copying', async () => {
  const root = await folder(), owner = state(root), service = new ExplorerService(new ProjectPaths(), file => rm(file, { recursive: true }));
  const file = path.join(root, 'note.txt'), target = path.join(root, 'target'); await mkdir(target); await writeFile(file, 'original');
  expect((await service.transfer(owner, { kind: 'move', paths: [file], target })).undoable).toBe(true);
  await service.transfer(owner, { kind: 'undo', paths: [] }); expect(await readFile(file, 'utf8')).toBe('original');
  await service.transfer(owner, { kind: 'copy', paths: [file], target }); await writeFile(path.join(target, 'note.txt'), 'external');
  await expect(service.transfer(owner, { kind: 'undo', paths: [] })).rejects.toThrow('changed');
  expect(await readFile(path.join(target, 'note.txt'), 'utf8')).toBe('external');
});
test('empty folders have an empty ripgrep listing', async () => { expect(await new RipgrepFiles().text(await folder())).toEqual([]); });
test('nested repositories are selected explicitly and deleted-parent diffs still resolve', async () => {
  const { root, git, owner } = await repository();
  const nested = path.join(root, 'nested'); await mkdir(nested); await GitCli.run(nested, ['init']);
  const file = path.join(nested, 'removed', 'note.txt'); await mkdir(path.dirname(file)); await writeFile(file, 'original');
  await GitCli.run(nested, ['add', '.']);
  await GitCli.run(nested, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base']);
  expect((await git.status(owner)).roots).toEqual([root, nested]);
  expect((await git.select(owner, nested)).root).toBe(nested);
  await rm(path.dirname(file), { recursive: true });
  expect(await git.diff(owner, file, false)).toMatchObject({ originalText: 'original', modifiedText: '' });
  await git.stage(owner, [file]);
  expect((await GitCli.run(nested, ['diff', '--cached', '--name-only'])).trim()).toBe('removed/note.txt');
  expect((await GitCli.run(root, ['diff', '--cached', '--name-only'])).trim()).toBe('');
});

test('linked-worktree index changes outside an opened subfolder publish a refresh', async () => {
  const { root, git, owner } = await repository();
  await mkdir(path.join(root, 'sub')); await writeFile(path.join(root, 'sub/note.txt'), 'base');
  await git.stage(owner, []); await git.commit(owner, 'base');
  const worktree = path.join(await folder(), 'worktree');
  await GitCli.run(root, ['worktree', 'add', '-b', 'linked', worktree]);
  await writeFile(path.join(worktree, 'sub/note.txt'), 'modified before subscribing');
  const send = vi.fn(), window = Object.assign(new EventEmitter(), { webContents: { send }, isDestroyed: () => false });
  const target = { ...state(path.join(worktree, 'sub')), webContentsId: 12345, window } as unknown as WindowState;
  const watcher = new GitMetadataWatcher(); cleanup.push(() => watcher.dispose());
  await watcher.watch(target, (await GitCli.connect(worktree))!);
  await GitCli.run(worktree, ['add', 'sub/note.txt']);
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith('project:files-changed', { root: target.projectRoot, paths: [] }), { timeout: 2500 });
  watcher.unwatch(target.webContentsId); expect(window.listenerCount('focus')).toBe(0); expect(window.listenerCount('closed')).toBe(0);
});
test('disk versions distinguish equal-length edits with a restored mtime', async () => {
  const root = await folder(), file = path.join(root, 'note.txt'); await writeFile(file, 'old');
  const before = diskVersion(file), previous = await stat(file); await writeFile(file, 'new'); await utimes(file, previous.atime, previous.mtime);
  expect(sameDiskVersion(before, diskVersion(file))).toBe(false);
});
test('native watches include background documents and survive another owner closing and atomic replacement', async () => {
  const root = await folder(), a = path.join(root, 'a.txt'), b = path.join(root, 'b.txt'); await writeFile(a, 'a'); await writeFile(b, 'b');
  const manager = new DocumentManager(() => {}), first = state(root), second = state(root);
  first.currentDocument = await manager.read(a); second.currentDocument = await manager.read(b);
  first.rendererTabs = [first.currentDocument, second.currentDocument].map(doc => ({ name: doc.name, path: doc.path, diskVersion: doc.diskVersion, dirty: false, isUntitled: false }));
  manager.watch(first); manager.watch(second); cleanup.push(() => { manager.stopWatching(first); manager.stopWatching(second); });
  manager.stopWatching(second); await writeFile(`${b}.tmp`, 'replacement'); await rename(`${b}.tmp`, b);
  await vi.waitFor(() => expect(first.window.webContents.send).toHaveBeenCalledWith('document:external-change', expect.objectContaining({ path: b, unavailable: false })), { timeout: 1500 });
  expect(second.window.webContents.send).not.toHaveBeenCalled();
});
