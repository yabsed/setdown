import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { WindowState } from '../windows/window-state';
import { GitService, parseGitStatus } from './git-service';
import { ProjectPaths } from './project-paths';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('Git status parser', () => {
  test('keeps index and working-tree states independently', () => {
    expect(parseGitStatus('MM both.md\nUU conflict.md\nR  old.md -> new.md\n')).toMatchObject([
      { path: 'both.md', indexStatus: 'M', workingTreeStatus: 'M', staged: true, unstaged: true },
      { path: 'conflict.md', conflict: true, status: '!' },
      { path: 'new.md', indexStatus: 'R', staged: true },
    ]);
  });

  test('decodes quoted rename paths before selecting the destination', () => {
    expect(parseGitStatus('R  "old file.md -> new file.md"\n')[0].path).toBe('new file.md');
  });

  test('preserves unquoted spaces in untracked paths', () => {
    expect(parseGitStatus('?? new file.md\n')[0]).toMatchObject({
      path: 'new file.md', indexStatus: '?', workingTreeStatus: '?', unstaged: true,
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
    expect((await service.diff(state, filePath, true)).patch).toContain('+# Notes');
    expect((await service.unstage(state, [filePath])).changes[0]).toMatchObject({
      status: 'U', staged: false, unstaged: true,
    });
    expect((await service.diff(state, filePath, false)).patch).toContain('--- /dev/null');
    expect((await service.discard(state, [filePath])).changes).toEqual([]);
    expect(trashed).toEqual([filePath]);
  });
});
