import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
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
  test('deleting Git metadata clears cached discovery and keeps surviving nested repositories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-removed-')), nested = path.join(root, 'nested');
    temporaryDirectories.push(root); await mkdir(nested);
    await GitCli.run(root, ['init', '-b', 'main']); await GitCli.run(nested, ['init', '-b', 'child']);
    const service = new GitService(new ProjectPaths()), state = { projectRoot: root } as WindowState;
    expect((await service.status(state)).roots).toEqual(expect.arrayContaining([root, nested]));
    await rm(path.join(root, '.git'), { recursive: true });
    expect(await service.status(state)).toMatchObject({ repository: true, roots: [nested], branch: 'child', errors: [] });
    await rm(path.join(nested, '.git'), { recursive: true });
    expect(await service.status(state)).toMatchObject({ repository: false, roots: [], changes: [], errors: [], pendingChanges: 0 });
    expect(state.gitRepositories).toEqual([]);
    await GitCli.run(root, ['init', '-b', 'restored']);
    expect(await service.status(state)).toMatchObject({ repository: true, branch: 'restored', unborn: true, errors: [] });
  });

  test('image comparisons read HEAD, Index and Worktree independently, including rename and deletion', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-images-')), file = path.join(root, 'picture.png');
    temporaryDirectories.push(root);
    const service = new GitService(new ProjectPaths()), state = { projectRoot: root } as WindowState;
    await service.initialize(state);
    const bytes = (value: import('../../protocol/desktop-api').GitImageVersion | undefined) =>
      value && 'bytes' in value ? Buffer.from(value.bytes).toString() : value;
    await writeFile(file, 'original image');
    const added = await service.diff(state, file, false);
    expect(added.images?.original).toBeNull(); expect(bytes(added.images?.modified)).toBe('original image');
    await service.stage(state, [file]);
    await GitCli.run(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'base']);
    await writeFile(file, 'staged image'); await service.stage(state, [file]);
    await writeFile(file, 'working image');
    const staged = await service.diff(state, file, true), working = await service.diff(state, file, false);
    expect(bytes(staged.images?.original)).toBe('original image'); expect(bytes(staged.images?.modified)).toBe('staged image');
    expect(bytes(working.images?.original)).toBe('staged image'); expect(bytes(working.images?.modified)).toBe('working image');
    expect(working.readOnly).toBe(true);
    await GitCli.run(root, ['reset', '--hard', 'HEAD']);
    const renamed = path.join(root, 'renamed.png'); await GitCli.run(root, ['mv', 'picture.png', 'renamed.png']);
    const rename = await service.diff(state, renamed, true);
    expect(bytes(rename.images?.original)).toBe('original image'); expect(bytes(rename.images?.modified)).toBe('original image');
    await rm(renamed); const deleted = await service.diff(state, renamed, false);
    expect(bytes(deleted.images?.original)).toBe('original image'); expect(deleted.images?.modified).toBeNull();
  });

  test('image blobs use image bounds and report oversize files as errors, not absent versions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-image-bounds-')), file = path.join(root, 'large.png');
    temporaryDirectories.push(root);
    const service = new GitService(new ProjectPaths()), state = { projectRoot: root } as WindowState;
    await service.initialize(state); await writeFile(file, 'image'); await truncate(file, 17 * 1024 * 1024);
    await service.stage(state, [file]);
    const valid = (await service.diff(state, file, true)).images?.modified;
    expect(valid && 'bytes' in valid && valid.bytes.byteLength).toBe(17 * 1024 * 1024);
    await truncate(file, 64 * 1024 * 1024 + 1);
    expect((await service.diff(state, file, false)).images?.modified).toEqual({ error: 'Images must be 64 MiB or smaller.' });
    await service.stage(state, [file]);
    expect((await service.diff(state, file, true)).images?.modified).toEqual({ error: 'Images must be 64 MiB or smaller.' });
  });

  test('Stage accepts a large literal path list without command-line limits', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-stage-'));
    temporaryDirectories.push(root);
    const service = new GitService(new ProjectPaths()), state = { projectRoot: root } as WindowState;
    await service.initialize(state);
    const names = Array.from({ length: 1200 }, (_, index) => `${index}-${'image'.repeat(30)}.txt`);
    names.push('한글 space.txt', '-option.txt', '[literal]*.txt', 'line\nbreak.txt');
    for (let offset = 0; offset < names.length; offset += 32)
      await Promise.all(names.slice(offset, offset + 32).map(name => writeFile(path.join(root, name), 'content')));
    await writeFile(path.join(root, 'untouched.txt'), 'keep unstaged');
    await service.stage(state, names.map(name => path.join(root, name)));
    const staged = (await GitCli.run(root, ['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean).sort();
    expect(staged).toEqual([...names].sort());
  }, 20_000);

  test('Stage waits for clean filters beyond the status-read timeout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-slow-stage-'));
    temporaryDirectories.push(root);
    const service = new GitService(new ProjectPaths()), state = { projectRoot: root } as WindowState;
    await service.initialize(state);
    // Real Git holds the index while a deterministic filter takes >10 seconds.
    // This reproduces large-file staging without writing gigabytes of fixtures.
    await writeFile(path.join(root, '.git', 'slow-clean.cjs'),
      "process.stdin.resume(); process.stdin.on('end', () => setTimeout(() => process.stdout.write('filtered'), 11000));");
    const node = `'${process.execPath.replaceAll("'", "'\\''")}'`;
    await GitCli.run(root, ['config', 'filter.slow.clean', `${node} .git/slow-clean.cjs`]);
    await GitCli.run(root, ['config', 'filter.slow.required', 'true']);
    await writeFile(path.join(root, '.gitattributes'), '*.slow filter=slow\n');
    const file = path.join(root, 'image.slow'); await writeFile(file, 'original');
    await service.stage(state, [file]);
    expect(await GitCli.run(root, ['show', ':image.slow'])).toBe('filtered');
  }, 30_000);

  test('Git timeouts omit command arguments and real stderr remains actionable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-errors-'));
    temporaryDirectories.push(root);
    await GitCli.run(root, ['init']);
    await expect(GitCli.run(root, ['hash-object', '--stdin', '--path=a-private-filename'], 100))
      .rejects.toThrow('Git hash-object did not finish within 0.1 seconds.');
    const repository = (await GitCli.connect(root))!;
    await expect(repository.stage(['missing.txt'])).rejects.toThrow(/pathspec.*missing.txt.*did not match/);
  });

  test('distinguishes an unborn branch from local history without an upstream', () => {
    expect(parseGitStatus('# branch.oid (initial)\0# branch.head master\0')).toMatchObject({
      branch: 'master', unborn: true, upstream: '', changes: [],
    });
    const local = parseGitStatus(`# branch.oid ${'a'.repeat(40)}\0# branch.head master\0`);
    expect(local.unborn).not.toBe(true);
    expect(local.upstream).toBe('');
  });

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
    await rm(path.join(root, '.git'), { recursive: true });
    expect(await service.status(owner)).toMatchObject({ repository: false, roots: [], changes: [], errors: [] });
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

test('Explorer decorations cover unselected repositories and disappear when clean or hidden', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-decoration-repos-')); temporaryDirectories.push(root);
  const roots = ['one', 'two'].map(name => path.join(root, name));
  for (const repository of roots) {
    await mkdir(repository); await GitCli.run(repository, ['init']);
    await writeFile(path.join(repository, 'file.md'), 'new');
  }
  const service = new GitService(new ProjectPaths()), state = { projectRoot: root, gitRoot: roots[0] } as WindowState;
  expect((await service.status(state)).decorations?.map(value => value.path).sort()).toEqual(roots.map(root => path.join(root, 'file.md')));
  await rm(path.join(roots[1], 'file.md'));
  expect((await service.status(state)).decorations).toHaveLength(1);
  expect((await service.configure(state, { visibleRoots: [roots[1]] })).decorations).toEqual([]);
});

test('ignore batches use Git rules, negations, global excludes, tracked entries and NUL paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-decoration-ignore-')); temporaryDirectories.push(root);
  const repo = path.join(root, 'repo'); await mkdir(repo);
  await GitCli.run(repo, ['init']);
  const service = new GitService(new ProjectPaths()), state = { projectRoot: repo } as WindowState;
  await writeFile(path.join(repo, 'tracked.log'), 'tracked'); await GitCli.run(repo, ['add', 'tracked.log']);
  await mkdir(path.join(repo, 'cache')); await mkdir(path.join(repo, 'build'));
  await writeFile(path.join(repo, '.gitignore'), '*.log\nbuild/\n!keep.log\n');
  await writeFile(path.join(repo, 'cache/.gitignore'), '!nested.log\n');
  await writeFile(path.join(repo, '.git/info/exclude'), 'local.txt\n');
  await writeFile(path.join(root, 'global-ignore'), 'global.txt\n');
  await GitCli.run(repo, ['config', 'core.excludesFile', path.join(root, 'global-ignore')]);
  const names = ['tracked.log', 'keep.log', 'cache/nested.log', 'build', 'local.txt', 'global.txt', '한 글\nnew.log', '-dash.log'];
  for (const name of names.filter(name => name !== 'build')) await writeFile(path.join(repo, name), 'content');
  const paths = names.map(name => path.join(repo, name));
  expect((await service.ignoredPaths(state, paths)).sort()).toEqual(paths.slice(3).sort());
  await writeFile(path.join(repo, '.gitignore'), '');
  expect(await service.ignoredPaths(state, [path.join(repo, '-dash.log')])).toEqual([]);
  await expect(service.ignoredPaths(state, [path.join(root, 'global-ignore')])).rejects.toThrow('outside');
  await expect(service.ignoredPaths(state, ['relative.log'])).rejects.toThrow('Invalid');
  let resolve!: (paths: string[]) => void;
  const pending = new Promise<string[]>(done => { resolve = done; });
  vi.spyOn(GitCli.prototype, 'checkIgnore').mockReturnValue(pending);
  const request = service.ignoredPaths(state, [paths[0]]);
  await vi.waitFor(() => expect(GitCli.prototype.checkIgnore).toHaveBeenCalled());
  state.projectRoot = null; resolve([paths[0]]);
  expect(await request).toEqual([]);
});
