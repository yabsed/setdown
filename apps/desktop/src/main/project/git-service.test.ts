import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { WindowState } from '../windows/window-state';
import { GitCli } from './engines/git-cli';
import { GitService, parseGitDiffHunks, parseGitStatus } from './git-service';
import { ProjectPaths } from './project-paths';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('Git status parser', () => {
  test('extracts exact changed ranges without including unified-diff context', () => {
    expect(parseGitDiffHunks([
      '@@ -2,5 +2,6 @@',
      ' same',
      '-old one',
      '-old two',
      '+new one',
      '+new two',
      '+new three',
      ' same again',
      '@@ -20 +21 @@',
      '-gone',
      '+here',
    ].join('\n'))).toEqual([
      { oldStart: 3, oldLines: 2, newStart: 3, newLines: 3 },
      { oldStart: 20, oldLines: 1, newStart: 21, newLines: 1 },
    ]);
  });

  test('keeps index and working-tree states independently', () => {
    const status = [
      '# branch.head feature/power',
      '# branch.upstream origin/feature/power',
      '# branch.ab +2 -3',
      '1 MM N... 100644 100644 100644 a b both.md',
      'u UU N... 100644 100644 100644 100644 a b c conflict.md',
      '2 R. N... 100644 100644 100644 a b R100 new.md',
      'old.md',
      '',
    ].join('\0');
    expect(parseGitStatus(status)).toMatchObject({
      branch: 'feature/power', upstream: 'origin/feature/power', ahead: 2, behind: 3,
      changes: [
      { path: 'both.md', indexStatus: 'M', workingTreeStatus: 'M', staged: true, unstaged: true },
      { path: 'conflict.md', conflict: true, status: '!' },
      { path: 'new.md', indexStatus: 'R', staged: true },
      ],
    });
  });

  test('uses the destination record for renames without parsing filename syntax', () => {
    const output = '2 R. N... 100644 100644 100644 a b R100 new file.md\0old file.md\0';
    expect(parseGitStatus(output).changes[0].path).toBe('new file.md');
  });

  test('preserves spaces and newlines in NUL-delimited untracked paths', () => {
    expect(parseGitStatus('? new file\ncontinued.md\0').changes[0]).toMatchObject({
      path: 'new file\ncontinued.md', indexStatus: '?', workingTreeStatus: '?', unstaged: true,
    });
  });

  test('initializes, stages, unstages, and safely trashes untracked files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-'));
    temporaryDirectories.push(root);
    const filePath = path.join(root, 'notes.md');
    const trashed: string[] = [];
    const service = new GitService(new ProjectPaths(), async (candidate) => {
      trashed.push(candidate);
      await rm(candidate);
    });
    const state = { projectRoot: root } as WindowState;

    expect((await service.initialize(state)).repository).toBe(true);
    await writeFile(filePath, '# Notes\n', 'utf8');
    expect((await service.status(state)).changes[0]).toMatchObject({ status: 'U', unstaged: true });
    expect((await service.stage(state, [filePath])).changes[0]).toMatchObject({
      status: 'A', staged: true, unstaged: false,
    });
    expect(await service.diff(state, filePath, true)).toMatchObject({
      originalText: '', modifiedText: '# Notes\n', originalLabel: 'HEAD', modifiedLabel: 'INDEX',
    });
    expect((await service.unstage(state, [filePath])).changes[0]).toMatchObject({
      status: 'U', staged: false, unstaged: true,
    });
    expect(await service.diff(state, filePath, false)).toMatchObject({
      originalText: '', modifiedText: '# Notes\n', originalLabel: 'EMPTY', modifiedLabel: 'WORKTREE',
    });
    expect((await service.discard(state, [filePath])).changes).toEqual([]);
    expect(trashed).toEqual([filePath]);
  });

  test('keeps repository-relative paths when an Explorer subfolder is open', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-subfolder-'));
    temporaryDirectories.push(root);
    const service = new GitService(new ProjectPaths());
    await service.initialize({ projectRoot: root } as WindowState);
    const folder = path.join(root, 'notes');
    const filePath = path.join(folder, 'chapter.md');
    await mkdir(folder);
    await writeFile(filePath, '# Chapter\n', 'utf8');

    const owner = { projectRoot: folder } as WindowState;
    expect(await service.status(owner)).toMatchObject({ repository: false, parentRepository: root });
    const snapshot = await service.select(owner, root);
    expect(snapshot.changes).toMatchObject([{ path: 'notes/chapter.md', filePath, status: 'U' }]);
  });

  test('sums pending resources across repositories without changing the selected changes', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-count-'));
    temporaryDirectories.push(workspace);
    const first = path.join(workspace, 'first'), second = path.join(workspace, 'second');
    for (const root of [first, second]) {
      await mkdir(root);
      await GitCli.run(root, ['init']);
      await GitCli.run(root, ['config', 'user.name', 'Setdown Test']);
      await GitCli.run(root, ['config', 'user.email', 'setdown@example.test']);
      await writeFile(path.join(root, 'note.md'), 'base');
      await GitCli.run(root, ['add', '.']);
      await GitCli.run(root, ['commit', '-m', 'base']);
    }
    await writeFile(path.join(second, 'note.md'), 'staged');
    await GitCli.run(second, ['add', '.']);
    await writeFile(path.join(second, 'note.md'), 'working tree');
    await writeFile(path.join(second, 'untracked.md'), 'new');
    await writeFile(path.join(second, '.gitignore'), 'ignored.md\n');
    await GitCli.run(second, ['add', '.gitignore']);
    await writeFile(path.join(second, 'ignored.md'), 'ignored');
    const service = new GitService(new ProjectPaths());
    const state = { projectRoot: workspace, gitRoot: first } as WindowState;
    expect(await service.status(state)).toMatchObject({ root: first, pendingChanges: 4, changes: [] });
    const selected = await service.select(state, second);
    expect(selected).toMatchObject({ root: second, pendingChanges: 4 });
    expect(selected.changes).toHaveLength(3);
    await GitCli.run(second, ['reset', 'HEAD', '--', 'note.md']);
    expect((await service.status(state)).pendingChanges).toBe(3);
  });

  test('compares unstaged changes with the staged Index, not HEAD', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-index-diff-'));
    temporaryDirectories.push(root);
    const service = new GitService(new ProjectPaths());
    const state = { projectRoot: root } as WindowState;
    const filePath = path.join(root, 'review.md');

    await service.initialize(state);
    await GitCli.run(root, ['config', 'user.email', 'setdown@example.test']);
    await GitCli.run(root, ['config', 'user.name', 'Setdown Test']);
    await writeFile(filePath, '# HEAD\n', 'utf8');
    await service.stage(state, [filePath]);
    await service.commit(state, 'base');
    await writeFile(filePath, '# Staged\n', 'utf8');
    await service.stage(state, [filePath]);
    await writeFile(filePath, '# Current document\n', 'utf8');

    expect(await service.diff(state, filePath, false)).toMatchObject({
      originalText: '# Staged\n',
      modifiedText: '# Current document\n',
      originalLabel: 'INDEX',
      modifiedLabel: 'WORKTREE',
    });
  });
});

test('one failed repository retains healthy lists, reports a partial count and recovers', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'setdown-partial-git-')); temporaryDirectories.push(workspace);
  const good = path.join(workspace, 'good'), bad = path.join(workspace, 'bad');
  for (const root of [good, bad]) { await mkdir(root); await GitCli.run(root, ['init']); await writeFile(path.join(root, 'new.md'), 'new'); }
  const run = GitCli.prototype.run;
  const failure = vi.spyOn(GitCli.prototype, 'run').mockImplementation(function(this: GitCli, args, timeout) {
    if (this.repositoryRoot === bad && args.includes('status')) return Promise.reject(Error('broken submodule path'));
    return run.call(this, args, timeout);
  });
  const service = new GitService(new ProjectPaths()), owner = { projectRoot: workspace, gitRoot: good } as WindowState;
  const snapshot = await service.status(owner);
  expect(snapshot).toMatchObject({ root: good, pendingChanges: 1, countIncomplete: true, selectedError: false,
    errors: [{ root: bad, command: expect.stringContaining('git status'), message: expect.stringContaining('broken submodule') }] });
  expect(snapshot.changes.map(change => change.path)).toEqual(['new.md']);
  expect(await service.select(owner, bad)).toMatchObject({ root: bad, selectedError: true, pendingChanges: 1, countIncomplete: true });
  failure.mockRestore();
  expect(await service.status(owner)).toMatchObject({ root: bad, selectedError: false, pendingChanges: 2, countIncomplete: false, errors: [] });
});

test('visible repositories, focused counts and settings use the same status snapshot', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-settings-')); temporaryDirectories.push(workspace);
  const roots = ['a', 'b'].map(name => path.join(workspace, name));
  for (const root of roots) { await mkdir(root); await GitCli.run(root, ['init']); await writeFile(path.join(root, 'new.md'), 'new'); }
  const service = new GitService(new ProjectPaths()), owner = { projectRoot: workspace, gitRoot: roots[0] } as WindowState;
  expect((await service.status(owner)).pendingChanges).toBe(2);
  for (const scmCountBadge of ['all', 'focused', 'off'] as const)
    for (const countBadge of ['all', 'tracked', 'off'] as const)
      for (const untrackedChanges of ['mixed', 'separate', 'hidden'] as const) {
        const result = await service.configure(owner, { settings: { scmCountBadge, countBadge, untrackedChanges } });
        expect(result.pendingChanges).toBe(scmCountBadge === 'off' || countBadge !== 'all' || untrackedChanges === 'hidden' ? 0 : scmCountBadge === 'focused' ? 1 : 2);
        expect(result.changes).toHaveLength(untrackedChanges === 'hidden' ? 0 : 1);
      }
  expect(await service.configure(owner, { settings: { scmCountBadge: 'all', countBadge: 'all', untrackedChanges: 'mixed' }, visibleRoots: [roots[0]] }))
    .toMatchObject({ pendingChanges: 1, visibleRoots: [roots[0]], roots });
  expect((await service.select(owner, roots[1])).pendingChanges).toBe(2);
});

test('default discovery excludes deep build copies; explicit depth and ignores control discovery', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-scan-')); temporaryDirectories.push(workspace);
  const nested = path.join(workspace, 'artifacts', 'baseline'); await mkdir(nested, { recursive: true });
  await GitCli.run(workspace, ['init']); await GitCli.run(nested, ['init']);
  const service = new GitService(new ProjectPaths()), owner = { projectRoot: workspace } as WindowState;
  expect((await service.status(owner)).roots).toEqual([workspace]);
  expect((await service.configure(owner, { settings: { repositoryScanMaxDepth: 2 } })).roots).toEqual([workspace, nested]);
  expect((await service.configure(owner, { settings: { repositoryScanIgnoredFolders: ['artifacts'] } })).roots).toEqual([workspace]);
});

test('VS Code status classifications omit directory placeholders and staged type-only resources', async () => {
  const { gitChangeGroups } = await import('../../core/project/git-change-groups');
  const ordinary = (xy: string) => `1 ${xy} N... 100644 100644 100644 a b file\0`;
  expect(gitChangeGroups(parseGitStatus(ordinary('T.')).changes).badge).toBe(0);
  expect(gitChangeGroups(parseGitStatus(ordinary('.T')).changes).badge).toBe(1);
  expect(parseGitStatus('? nested/\0? real.md\0').changes.map(change => change.path)).toEqual(['real.md']);
  for (const xy of ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']) {
    const parsed = parseGitStatus(`u ${xy} N... 100644 100644 100644 100644 a b c conflict.md\0`);
    expect(gitChangeGroups(parsed.changes).badge).toBe(1);
  }
});

test('submodule discovery honors its limit and skips symlink copies without losing the parent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-modules-')); temporaryDirectories.push(root);
  await GitCli.run(root, ['init']);
  const first = path.join(root, 'vendor', 'one'), second = path.join(root, 'vendor', 'two');
  for (const directory of [first, second]) { await mkdir(directory, { recursive: true }); await GitCli.run(directory, ['init']); }
  await symlink(first, path.join(root, 'vendor', 'linked'));
  await writeFile(path.join(root, '.gitmodules'), '[submodule "one"]\n path = vendor/one\n[submodule "linked"]\n path = vendor/linked\n[submodule "two"]\n path = vendor/two\n');
  const service = new GitService(new ProjectPaths()), owner = { projectRoot: root } as WindowState;
  expect((await service.status(owner)).roots).toEqual([root, first, second]);
  expect(await service.configure(owner, { settings: { detectSubmodulesLimit: 1 } })).toMatchObject({ roots: [root, first], discoveryLimited: true });
  expect((await service.configure(owner, { settings: { detectSubmodules: false } })).roots).toEqual([root]);
});

test('worktrees outside the folder are opt-in and visible count settings survive a fresh service', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-worktree-')); temporaryDirectories.push(directory);
  const root = path.join(directory, 'main'), worktree = path.join(directory, 'worktree'), preferences = path.join(directory, 'prefs.json');
  await mkdir(root); await GitCli.run(root, ['init']);
  await GitCli.run(root, ['-c', 'user.name=Setdown Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'base']);
  await GitCli.run(root, ['worktree', 'add', '-b', 'other', worktree]);
  await writeFile(path.join(worktree, 'new.md'), 'new');
  const service = new GitService(new ProjectPaths(), undefined, () => preferences), owner = { projectRoot: root } as WindowState;
  expect((await service.status(owner)).roots).toEqual([root]);
  expect(await service.configure(owner, { settings: { detectWorktrees: true } })).toMatchObject({ roots: [root, worktree], pendingChanges: 1 });
  await service.select(owner, worktree);
  expect((await service.stage(owner, [path.join(worktree, 'new.md')])).changes[0].staged).toBe(true);
  await service.configure(owner, { visibleRoots: [root], settings: { scmCountBadge: 'focused' } });
  const restarted = new GitService(new ProjectPaths(), undefined, () => preferences);
  expect(await restarted.status({ projectRoot: root } as WindowState)).toMatchObject({ visibleRoots: [root], pendingChanges: 0, settings: { detectWorktrees: true, scmCountBadge: 'focused' } });
});

test('changing a badge preference does not freeze unrelated workspace settings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-workspace-settings-')); temporaryDirectories.push(root);
  await GitCli.run(root, ['init']); await mkdir(path.join(root, '.vscode'));
  const file = path.join(root, '.vscode/settings.json');
  await writeFile(file, JSON.stringify({ 'git.repositoryScanMaxDepth': 1 }));
  const service = new GitService(new ProjectPaths()), owner = { projectRoot: root } as WindowState;
  await service.configure(owner, { settings: { countBadge: 'tracked' } });
  await writeFile(file, JSON.stringify({ 'git.repositoryScanMaxDepth': 3 }));
  expect((await service.status(owner)).settings).toMatchObject({ countBadge: 'tracked', repositoryScanMaxDepth: 3 });
});

test('truncated status explicitly marks counts incomplete and clears that state after raising the limit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-status-limit-')); temporaryDirectories.push(root);
  await GitCli.run(root, ['init']);
  for (const name of ['a', 'b', 'c']) await writeFile(path.join(root, name), 'new');
  const service = new GitService(new ProjectPaths()), owner = { projectRoot: root } as WindowState;
  const limited = await service.configure(owner, { settings: { statusLimit: 2 } });
  expect(limited).toMatchObject({ statusLimited: true, countIncomplete: true, pendingChanges: 2 });
  expect(limited.changes).toHaveLength(2);
  expect(await service.configure(owner, { settings: { statusLimit: 10 } })).toMatchObject({ countIncomplete: false, pendingChanges: 3 });
});
