import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import { ExplorerService } from './explorer-service';
import { ProjectPaths } from './project-paths';
import { copyExclusive, copyName, moveExclusive } from './file-transfer';
import type { WindowState } from '../windows/window-state';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-transfer-')); roots.push(root);
  const service = new ExplorerService(new ProjectPaths());
  const state = { projectRoot: root } as WindowState;
  const target = path.join(root, 'target'); await fs.mkdir(target);
  return { root, target, service, state };
}

test('copies directories, binary bytes, empty folders and links without traversing their targets', async () => {
  const { root, target, service, state } = await fixture();
  const source = path.join(root, 'source'); await fs.mkdir(source); await fs.mkdir(path.join(source, 'empty'));
  const bytes = Buffer.from([0, 255, 1, 254]);
  await fs.writeFile(path.join(source, 'data.bin'), bytes, { mode: 0o640 });
  await fs.symlink('../missing', path.join(source, 'dangling'));
  await fs.symlink('.', path.join(source, 'cycle'));
  const result = await service.transfer(state, { kind: 'copy', paths: [source, path.join(source, 'data.bin'), source], target });
  expect(result.items).toEqual([{ from: source, to: path.join(target, 'source'), status: 'completed' }]);
  expect(await fs.readFile(path.join(target, 'source/data.bin'))).toEqual(bytes);
  expect((await fs.stat(path.join(target, 'source/data.bin'))).mode & 0o777).toBe(0o640);
  expect(await fs.readdir(path.join(target, 'source/empty'))).toEqual([]);
  expect(await fs.readlink(path.join(target, 'source/dangling'))).toBe('../missing');
  expect(await fs.readlink(path.join(target, 'source/cycle'))).toBe('.');
  expect(await fs.readFile(path.join(source, 'data.bin'))).toEqual(bytes);
});

test('same-folder paste and duplicate reserve unique suffixes even for concurrent requests', async () => {
  const { root, service, state } = await fixture();
  const from = path.join(root, 'notes.md'); await fs.writeFile(from, 'disk text');
  const results = await Promise.all([service.transfer(state, { kind: 'copy', paths: [from], target: root }),
    service.transfer(state, { kind: 'duplicate', paths: [from] })]);
  expect(results.map(result => path.basename(result.items[0].to))).toEqual(['notes copy.md', 'notes copy 2.md']);
  expect(await fs.readFile(path.join(root, 'notes copy.md'), 'utf8')).toBe('disk text');
  expect(copyName('.gitignore', false, 1)).toBe('.gitignore copy');
  expect(copyName('bundle.tar.gz', false, 2)).toBe('bundle copy 2.tar.gz');
  expect(copyName('folder.v2', true, 1)).toBe('folder.v2 copy');
});

test('cross-volume moves publish a complete copy before removing their source', async () => {
  const { root, target } = await fixture(), source = path.join(root, 'data.txt'), destination = path.join(target, 'data.txt');
  await fs.writeFile(source, 'cross-volume content');
  const link = fs.link.bind(fs);
  vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
    if (from === source) throw Object.assign(Error('cross-volume'), { code: 'EXDEV' });
    return link(from, to);
  });
  await moveExclusive(source, destination);
  expect(await fs.readFile(destination, 'utf8')).toBe('cross-volume content');
  await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('canceling a copy before publication removes staging and keeps the source', async () => {
  const { root, target } = await fixture(), source = path.join(root, 'data.txt'), destination = path.join(target, 'data.txt');
  await fs.writeFile(source, 'source'); const controller = new AbortController(), copy = fs.copyFile.bind(fs);
  vi.spyOn(fs, 'copyFile').mockImplementation(async (...args) => { await copy(...args); controller.abort(Error('Canceled')); });
  await expect(copyExclusive(source, destination, controller.signal)).rejects.toThrow('Canceled');
  expect(await fs.readdir(target)).toEqual([]); expect(await fs.readFile(source, 'utf8')).toBe('source');
});

test('completed receipts survive a post-commit notification failure', async () => {
  const { root, target, service, state } = await fixture(), source = path.join(root, 'a.txt');
  await fs.writeFile(source, 'original'); vi.spyOn(console, 'warn').mockImplementation(() => {});
  service.languageOperation = async (_owner, _operation, phase) => { if (phase === 'did') throw Error('Server closed'); };
  const result = await service.transfer(state, { kind: 'move', paths: [source], target });
  expect(result.items).toEqual([{ from: source, to: path.join(target, 'a.txt'), status: 'completed' }]);
  expect(result.undoable).toBe(true); expect(await fs.readFile(path.join(target, 'a.txt'), 'utf8')).toBe('original');
});

test('failure to record undo never hides an already-completed operation', async () => {
  const { root, target, service, state } = await fixture(), source = path.join(root, 'a.txt'); await fs.writeFile(source, 'original');
  service.languageOperation = async (_owner, operation, phase) => {
    if (phase === 'did') await fs.unlink(operation.files[0].path);
  };
  const result = await service.transfer(state, { kind: 'copy', paths: [source], target });
  expect(result.items[0].status).toBe('completed'); expect(result.undoable).toBe(false); expect(result.warning).toContain('Undo');
});

test('batch preflight rejects collisions without copying earlier entries; explicit policies preserve existing content', async () => {
  const { root, target, service, state } = await fixture();
  const paths = ['a.txt', 'b.txt'].map(name => path.join(root, name));
  for (const source of paths) await fs.writeFile(source, 'source');
  await fs.writeFile(path.join(target, 'b.txt'), 'original');
  await expect(service.transfer(state, { kind: 'copy', paths, target })).rejects.toThrow('already exists');
  expect(await fs.readdir(target)).toEqual(['b.txt']);
  const skipped = await service.transfer(state, { kind: 'copy', paths, target, conflict: 'skip' });
  expect(skipped.items.map(item => item.status)).toEqual(['completed', 'skipped']);
  const both = await service.transfer(state, { kind: 'copy', paths, target, conflict: 'keep-both' });
  expect(both.items.map(item => path.basename(item.to))).toEqual(['a copy.txt', 'b copy.txt']);
  expect(await fs.readFile(path.join(target, 'b.txt'), 'utf8')).toBe('original');
});

test('partial copy failure reports completed, failed and unstarted entries and removes staging files', async () => {
  const { root, target, service, state } = await fixture();
  const paths = ['a', 'b', 'c'].map(name => path.join(root, name));
  for (const source of paths) await fs.writeFile(source, source);
  const copy = fs.copyFile.bind(fs);
  vi.spyOn(fs, 'copyFile').mockImplementation(async (from, to, flags) => {
    if (String(from) === paths[1]) throw new Error('Simulated full disk');
    await copy(from, to, flags);
  });
  const result = await service.transfer(state, { kind: 'copy', paths, target });
  expect(result.items.map(item => item.status)).toEqual(['completed', 'failed', 'not-started']);
  expect(result.items[1].error).toContain('full disk');
  expect(await fs.readdir(target)).toEqual(['a']);
  for (const source of paths) expect(await fs.readFile(source, 'utf8')).toBe(source);
});

test('an entry appearing after preflight is never overwritten by file or folder publication', async () => {
  const { root, target } = await fixture();
  const source = path.join(root, 'source'), destination = path.join(target, 'source');
  await fs.mkdir(source); await fs.writeFile(path.join(source, 'a'), 'source');
  const copy = fs.copyFile.bind(fs);
  vi.spyOn(fs, 'copyFile').mockImplementation(async (from, to, flags) => {
    await copy(from, to, flags);
    await fs.mkdir(destination); await fs.writeFile(path.join(destination, 'mine'), 'keep me');
  });
  await expect(copyExclusive(source, destination)).rejects.toThrow();
  expect(await fs.readdir(target)).toEqual(['source']);
  expect(await fs.readFile(path.join(destination, 'mine'), 'utf8')).toBe('keep me');
  await expect(moveExclusive(path.join(source, 'a'), path.join(destination, 'mine'))).rejects.toThrow();
  expect(await fs.readFile(path.join(source, 'a'), 'utf8')).toBe('source');
});

test('copy rejects self descendants, root changes, outside sources and symlink ancestors outside root', async () => {
  const { root, target, service, state } = await fixture();
  await expect(service.transfer(state, { kind: 'copy', paths: [root], target })).rejects.toThrow('itself');
  await expect(service.transfer(state, { kind: 'copy', paths: [target], target })).rejects.toThrow('itself');
  await expect(service.transfer(state, { kind: 'copy', paths: ['/outside'], target })).rejects.toThrow('outside');
  await fs.symlink(os.tmpdir(), path.join(root, 'escape'));
  await expect(service.create(state, path.join(root, 'escape'), 'outside', 'file')).rejects.toThrow('outside');
  const allowed = await service.create(state, root, '..notes', 'file');
  expect(allowed.path).toBe(path.join(root, '..notes'));
});

test('move keeps source on publication failure and manipulates symbolic links themselves', async () => {
  const { root, target, service, state } = await fixture();
  const from = path.join(root, 'link'); await fs.symlink('/outside', from);
  const result = await service.transfer(state, { kind: 'move', paths: [from], target });
  expect(result.items[0].status).toBe('completed');
  expect(await fs.readlink(path.join(target, 'link'))).toBe('/outside');
  await expect(fs.lstat(from)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await service.transfer(state, { kind: 'move', paths: [path.join(target, 'link')], target })).items[0].status).toBe('skipped');
});
