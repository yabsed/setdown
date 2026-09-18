import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { WindowState } from '../windows/window-state';
import { ExplorerService } from './explorer-service';
import { ProjectPaths } from './project-paths';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe('explorer service', () => {
  test('creates, renames, moves, and trashes entries inside the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-explorer-'));
    temporaryDirectories.push(root);
    const trashed: string[] = [];
    const service = new ExplorerService(new ProjectPaths(), async (candidate) => {
      trashed.push(candidate);
      await rm(candidate, { recursive: true });
    });
    const state = { projectRoot: root } as WindowState;

    const folder = await service.create(state, root, 'chapter', 'directory');
    const file = await service.create(state, root, 'draft.md', 'file');
    expect(file.kind).toBe('document');
    const renamed = await service.rename(state, file.path, 'notes.md');
    const moved = await service.move(state, renamed.to, folder.path);
    expect((await service.readDirectory(state, folder.path)).map((entry) => entry.name)).toEqual(['notes.md']);

    await service.trashEntry(state, moved.to);
    expect(trashed).toEqual([moved.to]);
    expect(await service.readDirectory(state, folder.path)).toEqual([]);
  });

  test('rejects traversal names and moves outside the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-explorer-'));
    temporaryDirectories.push(root);
    const service = new ExplorerService(new ProjectPaths(), async () => {});
    const state = { projectRoot: root } as WindowState;
    await mkdir(path.join(root, 'inside'));

    await expect(service.create(state, root, '../outside.md', 'file')).rejects.toThrow('valid');
    await expect(service.move(state, path.join(root, 'inside'), os.tmpdir())).rejects.toThrow('outside');
  });
});
