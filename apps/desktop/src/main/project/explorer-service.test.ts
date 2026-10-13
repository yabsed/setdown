import { mkdir, mkdtemp, rm, writeFile, readFile, symlink } from 'node:fs/promises';
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

  test('moves a selection once, including nested selections and same-folder no-ops', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-explorer-batch-'));
    temporaryDirectories.push(root);
    const service = new ExplorerService(new ProjectPaths());
    const state = { projectRoot: root } as WindowState;
    const folder = path.join(root, 'folder'), target = path.join(root, 'target');
    await mkdir(folder); await mkdir(target);
    const child = path.join(folder, 'child.txt'), file = path.join(root, 'file.txt');
    await writeFile(child, 'child'); await writeFile(file, 'file');
    const result = await service.moveMany(state, [child, file, folder, file], target);
    expect(result).toEqual({ moves: [{ from: file, to: path.join(target, 'file.txt') }, { from: folder, to: path.join(target, 'folder') }] });
    expect(await readFile(path.join(target, 'folder', 'child.txt'), 'utf8')).toBe('child');
    expect(await service.moveMany(state, [path.join(target, 'file.txt')], target)).toEqual({ moves: [] });
  });

  test('preflights all conflicts and invalid destinations before moving any selected file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-explorer-conflict-'));
    temporaryDirectories.push(root);
    const service = new ExplorerService(new ProjectPaths());
    const state = { projectRoot: root } as WindowState;
    const target = path.join(root, 'target'), folder = path.join(root, 'folder');
    await mkdir(target); await mkdir(folder);
    const first = path.join(root, 'first.txt'), second = path.join(root, 'second.txt');
    await writeFile(first, 'first'); await writeFile(second, 'second');
    await writeFile(path.join(target, 'second.txt'), 'existing');
    await expect(service.moveMany(state, [first, second], target)).rejects.toThrow('already exists');
    expect(await readFile(first, 'utf8')).toBe('first');
    expect(await readFile(second, 'utf8')).toBe('second');
    expect(await readFile(path.join(target, 'second.txt'), 'utf8')).toBe('existing');
    await writeFile(path.join(folder, 'first.txt'), 'duplicate');
    await expect(service.moveMany(state, [first, path.join(folder, 'first.txt')], target)).rejects.toThrow('more than once');
    await expect(service.moveMany(state, [second, folder], folder)).rejects.toThrow('itself');
    await expect(service.moveMany(state, [first, '/outside'], target)).rejects.toThrow('outside');
    await expect(service.moveMany(state, [first, root], target)).rejects.toThrow('itself cannot');
    await symlink(path.join(root, 'missing'), path.join(target, 'first.txt'));
    await expect(service.moveMany(state, [first], target)).rejects.toThrow('already exists');
    expect(await readFile(first, 'utf8')).toBe('first');
  });
});
