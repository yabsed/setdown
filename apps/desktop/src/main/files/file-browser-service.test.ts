import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { WindowState } from '../windows/window-state';
import type { ExplorerClipboardStore } from '../project/explorer-clipboard';
import { FileBrowserService } from './file-browser-service';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function temporary() { const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-folder-')); roots.push(root); return root; }
const clipboard = { write: async (paths: string[], cut: boolean) => ({ paths, cut }) } as unknown as ExplorerClipboardStore;
const window = { webContents: { send() {} }, once() {} };
const state = (projectRoot: string | null = null) => ({ projectRoot, webContentsId: 1, rendererTabs: [], window } as unknown as WindowState);

describe('folder tab backend', () => {
  test('lists links, hidden names and metadata without following the folder boundary', async () => {
    const root = await temporary();
    await mkdir(path.join(root, 'docs'));
    await writeFile(path.join(root, 'notes.md'), '# Notes');
    await writeFile(path.join(root, '.env'), 'A=1');
    await writeFile(path.join(root, 'draft.txt~'), 'old');
    await writeFile(path.join(root, 'secret.bin'), Buffer.alloc(3));
    await writeFile(path.join(root, '.hidden'), 'secret.bin\n');
    await symlink(path.join(root, 'docs'), path.join(root, 'docs-link'));
    await symlink(path.join(root, 'missing'), path.join(root, 'broken'));
    const service = new FileBrowserService({ clipboard, beforeMutation() {} });
    const listing = await service.list(root);
    const byName = Object.fromEntries(listing.entries.map(entry => [entry.name, entry]));
    expect(listing.writable).toBe(true);
    expect(byName['notes.md']).toMatchObject({ kind: 'document', hidden: false, size: 7 });
    expect(byName['.env'].hidden).toBe(true);
    expect(byName['draft.txt~'].hidden).toBe(true);
    expect(byName['secret.bin']).toMatchObject({ kind: 'file', hidden: true });
    expect(byName['docs-link']).toMatchObject({ kind: 'directory', link: { broken: false } });
    expect(byName.broken).toMatchObject({ kind: 'file', link: { broken: true } });
  });

  test('resolves folders, files, home paths and the nearest existing parent of a missing path', async () => {
    const root = await temporary();
    await mkdir(path.join(root, 'a'));
    await writeFile(path.join(root, 'a', 'b.md'), '');
    const service = new FileBrowserService({ clipboard, beforeMutation() {}, home: () => root });
    expect(await service.resolve('~/a')).toEqual({ kind: 'folder', path: path.join(root, 'a') });
    expect(await service.resolve(`file://${path.join(root, 'a', 'b.md')}`)).toEqual({ kind: 'file', path: path.join(root, 'a', 'b.md') });
    expect(await service.resolve(path.join(root, 'a', 'x', 'y.md'))).toEqual({ kind: 'missing', path: path.join(root, 'a', 'x', 'y.md'), parent: path.join(root, 'a') });
    await expect(service.resolve('relative/path')).rejects.toThrow(/absolute/);
  });

  test('completes typed paths shell-style: folders first, dotfiles only when typed', async () => {
    const root = await temporary();
    await mkdir(path.join(root, 'Documents'));
    await writeFile(path.join(root, 'Doc.md'), '');
    await writeFile(path.join(root, '.dotfile'), '');
    const service = new FileBrowserService({ clipboard, beforeMutation() {}, home: () => root });
    expect((await service.complete('~/Doc')).map(row => [row.name, row.directory])).toEqual([['Documents', true], ['Doc.md', false]]);
    expect((await service.complete(`${root}/`)).map(row => row.name)).toEqual(['Documents', 'Doc.md']);
    expect((await service.complete(`${root}/.d`)).map(row => row.name)).toEqual(['.dotfile']);
  });

  test('runs the shared transfer engine outside any open project, with cross-window protection', async () => {
    const root = await temporary();
    const trashed: string[] = [];
    let blocked = '';
    const service = new FileBrowserService({ clipboard, trash: async file => { trashed.push(file); await rm(file, { recursive: true }); },
      beforeMutation: (_state, paths) => { if (paths.some(file => file === blocked)) throw Error('open elsewhere'); } });
    await mkdir(path.join(root, 'target'));
    const created = await service.create(state(), root, 'report.md', 'file');
    const result = await service.transfer(state(), { kind: 'copy', paths: [created.path], target: path.join(root, 'target') });
    expect(result.items).toEqual([{ from: created.path, to: path.join(root, 'target', 'report.md'), status: 'completed' }]);
    const moved = await service.rename(state(), created.path, 'final.md');
    expect(moved.to).toBe(path.join(root, 'final.md'));
    const undone = await service.transfer(state(), { kind: 'undo', paths: [] });
    expect(undone).toMatchObject({ kind: 'move', items: [{ from: moved.to, to: created.path, status: 'completed' }] });
    blocked = created.path;
    await expect(service.rename(state(), created.path, 'other.md')).rejects.toThrow(/open elsewhere/);
    blocked = '';
    await service.trash(state(), created.path);
    expect(trashed).toEqual([created.path]);
    await expect(service.rename(state(), path.parse(root).root, 'x')).rejects.toThrow();
  });

  test('restores a Trash item to its original path and refuses to overwrite', async () => {
    const root = await temporary();
    const trash = path.join(root, 'Trash');
    await mkdir(path.join(trash, 'files'), { recursive: true });
    await mkdir(path.join(trash, 'info'));
    const original = path.join(root, 'restored folder', 'a b.md');
    await writeFile(path.join(trash, 'files', 'a b.md'), 'kept');
    await writeFile(path.join(trash, 'info', 'a b.md.trashinfo'), `[Trash Info]\nPath=${encodeURI(original)}\nDeletionDate=2026-11-11T10:00:00\n`);
    const service = new FileBrowserService({ clipboard, beforeMutation() {} });
    expect(await service.restore(state(), path.join(trash, 'files', 'a b.md'))).toBe(original);
    expect(await readFile(original, 'utf8')).toBe('kept');
    await expect(stat(path.join(trash, 'info', 'a b.md.trashinfo'))).rejects.toThrow();
    await writeFile(path.join(trash, 'files', 'a b.md'), 'second');
    await writeFile(path.join(trash, 'info', 'a b.md.trashinfo'), `[Trash Info]\nPath=${encodeURI(original)}\n`);
    await expect(service.restore(state(), path.join(trash, 'files', 'a b.md'))).rejects.toThrow(/already exists/);
    await expect(service.restore(state(), original)).rejects.toThrow(/Trash folder/);
  });
});
