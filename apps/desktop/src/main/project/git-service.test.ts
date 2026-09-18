import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { WindowState } from '../windows/window-state';
import { GitService, parseGitDiffHunks, parseGitStatus } from './git-service';
import { ProjectPaths } from './project-paths';

const temporaryDirectories: string[] = [];

afterEach(async () => {
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

  test('maps repository-relative porcelain paths back into an open subfolder', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-git-subfolder-'));
    temporaryDirectories.push(root);
    const service = new GitService(new ProjectPaths());
    await service.initialize({ projectRoot: root } as WindowState);
    const folder = path.join(root, 'notes');
    const filePath = path.join(folder, 'chapter.md');
    await mkdir(folder);
    await writeFile(filePath, '# Chapter\n', 'utf8');

    const snapshot = await service.status({ projectRoot: folder } as WindowState);
    expect(snapshot.changes).toMatchObject([{ path: 'chapter.md', filePath, status: 'U' }]);
  });
});
