import { mkdir, mkdtemp, readdir, rm, writeFile, readFile, symlink } from 'node:fs/promises';
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

test('language will/did operations bracket the actual mutation, and rejected edits leave files untouched', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-explorer-language-')); temporaryDirectories.push(root);
  const service = new ExplorerService(new ProjectPaths(), async file => { await rm(file); });
  const state = { projectRoot: root } as WindowState;
  const from = path.join(root, 'before.py'), to = path.join(root, 'after.py');
  await writeFile(from, 'value = 1\n');
  const events: string[] = [];
  service.languageOperation = async (_state, operation, phase) => {
    events.push(`${phase}:${operation.kind}`);
    if (phase === 'will') { expect(await readFile(from, 'utf8')).toBe('value = 1\n'); await expect(readFile(to)).rejects.toThrow(); }
    else { expect(await readFile(to, 'utf8')).toBe('value = 1\n'); await expect(readFile(from)).rejects.toThrow(); }
  };
  await service.rename(state, from, 'after.py');
  expect(events).toEqual(['will:rename', 'did:rename']);
  service.languageOperation = async () => { throw Error('Document changed during import edits.'); };
  await expect(service.trashEntry(state, to)).rejects.toThrow(/Document changed/);
  expect(await readFile(to, 'utf8')).toBe('value = 1\n');
});

test('new file data takes a free name, never replaces a file, stays inside the folder, and Undo trashes it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-explorer-data-')); temporaryDirectories.push(root);
  const trashed: string[] = [];
  const service = new ExplorerService(new ProjectPaths(), async file => { trashed.push(file); await rm(file); });
  const state = { projectRoot: root, webContentsId: 1 } as WindowState;
  const events: string[] = [];
  service.languageOperation = async (_state, operation, phase) => { events.push(`${phase}:${operation.kind}:${path.basename(operation.files[0].path)}`); };
  const bytes = Uint8Array.of(1, 2, 3);
  await writeFile(path.join(root, 'Pasted image 2.png'), 'KEEP');

  const first = await service.createFile(state, root, 'Pasted image.png', bytes);
  expect(first).toEqual({ kind: 'import', undoable: true, items: [{ from: path.join(root, 'Pasted image.png'), to: path.join(root, 'Pasted image.png'), status: 'completed' }] });
  const second = await service.createFile(state, root, 'Pasted image.png', Uint8Array.of(4));
  expect(second.items[0].to).toBe(path.join(root, 'Pasted image 3.png'));
  expect(await readFile(path.join(root, 'Pasted image.png'))).toEqual(Buffer.from(bytes));
  expect(await readFile(path.join(root, 'Pasted image 2.png'), 'utf8')).toBe('KEEP');
  expect(events).toEqual(['will:create:Pasted image.png', 'did:create:Pasted image.png', 'will:create:Pasted image 3.png', 'did:create:Pasted image 3.png']);
  // No staging directory or partial file is left beside the result.
  expect((await readdir(root)).sort()).toEqual(['Pasted image 2.png', 'Pasted image 3.png', 'Pasted image.png']);

  await expect(service.createFile(state, root, '../escape.png', bytes)).rejects.toThrow('valid file or folder name');
  await expect(service.createFile(state, os.tmpdir(), 'outside.png', bytes)).rejects.toThrow('outside');
  await expect(service.createFile(state, path.join(root, 'Pasted image.png'), 'inside-a-file.png', bytes)).rejects.toThrow('not a folder');

  expect((await service.transfer(state, { kind: 'undo', paths: [] })).items[0]).toMatchObject({ from: path.join(root, 'Pasted image 3.png'), status: 'completed' });
  expect(trashed).toEqual([path.join(root, 'Pasted image 3.png')]);
  expect(await readFile(path.join(root, 'Pasted image.png'))).toEqual(Buffer.from(bytes));
});
