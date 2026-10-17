import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { RecentFolders } from './recent-folders';

test('recent folders persist the five latest distinct visits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-recent-'));
  try {
    const file = path.join(root, 'recent.json'), history = new RecentFolders(file);
    expect(history.list()).toEqual([]);
    const folders = Array.from({ length: 6 }, (_, i) => path.join(root, `folder-${i}`));
    for (const folder of folders) history.visit(folder);
    history.visit(folders[2]);
    const expected = [folders[2], folders[5], folders[4], folders[3], folders[1]];
    expect(history.list().map(folder => folder.path)).toEqual(expected);
    expect(new RecentFolders(file).list().map(folder => folder.path)).toEqual(expected);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(expected);
    history.list().splice(0);
    expect(history.list()).toHaveLength(5);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('damaged history is ignored and stored entries are bounded and validated', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-recent-'));
  try {
    const file = path.join(root, 'recent.json');
    await writeFile(file, '{broken');
    expect(new RecentFolders(file).list()).toEqual([]);
    await writeFile(file, JSON.stringify([null, 7, {}, 'relative', root, root,
      ...Array.from({ length: 8 }, (_, i) => path.join(root, String(i)))]));
    const folders = new RecentFolders(file).list();
    expect(folders).toHaveLength(5);
    expect(folders[0]).toEqual({ path: root, name: path.basename(root) });
    expect(new Set(folders.map(folder => folder.path)).size).toBe(5);
  } finally { await rm(root, { recursive: true, force: true }); }
});
