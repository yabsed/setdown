import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { compressFiles, extractArchive, glibFileUri, parseDesktopEntry, parseMimeApplications, parseContentType, parseVolumes, properties,
  setBookmark, thumbnailCandidates } from './desktop-integration';
import { collectMatches, FileSearch, matchesQuery, queryWords } from './file-search';
import { folderRequestFromArgs, requestsFromFileManagerCall } from './file-manager-launch';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function temporary() { const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-fm-')); roots.push(root); return root; }

describe('desktop integration parsers', () => {
  test('reads gio content types and application lists', () => {
    expect(parseContentType('uri: file:///a\nattributes:\n  standard::content-type: text/markdown\n')).toBe('text/markdown');
    expect(parseMimeApplications('Default application for “text/plain”: setdown.desktop\nRegistered applications:\n\tsetdown.desktop\n\torg.gnome.TextEditor.desktop\nRecommended applications:\n\torg.gnome.TextEditor.desktop\n'))
      .toEqual({ defaultId: 'setdown.desktop', ids: ['setdown.desktop', 'org.gnome.TextEditor.desktop'] });
    expect(parseMimeApplications('No default applications for “x/y”\n')).toEqual({ defaultId: null, ids: [] });
  });

  test('reads localized desktop entry names and ignores other groups', () => {
    const entry = '[Desktop Entry]\nName=Text Editor\nName[ko]=텍스트 편집기\nExec=gnome-text-editor %U\n[Desktop Action new]\nName=New Window\nExec=x\n';
    expect(parseDesktopEntry(entry, 'ko_KR.UTF-8')).toEqual({ name: '텍스트 편집기', exec: 'gnome-text-editor %U', hidden: false });
    expect(parseDesktopEntry(entry)?.name).toBe('Text Editor');
    expect(parseDesktopEntry('[Desktop Entry]\nName=X\nExec=x\nHidden=true\n')?.hidden).toBe(true);
    expect(parseDesktopEntry('Name=X')).toBeNull();
  });

  test('lists removable filesystems, mounted or not, and skips system disks and swap', () => {
    const json = JSON.stringify({ blockdevices: [
      { path: '/dev/nvme0n1', rm: false, hotplug: false, type: 'disk', children: [{ path: '/dev/nvme0n1p3', fstype: 'btrfs', mountpoint: '/', rm: false, hotplug: false }] },
      { path: '/dev/sdb', rm: true, hotplug: true, type: 'disk', children: [
        { path: '/dev/sdb1', label: 'USB', fstype: 'vfat', mountpoint: null, rm: true, size: '16G' },
        { path: '/dev/sdb2', label: null, fstype: 'ext4', mountpoint: '/run/media/me/data', size: '8G' }] },
      { path: '/dev/zram0', fstype: 'swap', mountpoint: '[SWAP]', rm: false },
    ] });
    expect(parseVolumes(json)).toEqual([
      { device: '/dev/sdb1', name: 'USB', mountPath: null },
      { device: '/dev/sdb2', name: '8G Volume', mountPath: '/run/media/me/data' },
    ]);
    expect(parseVolumes('not json')).toEqual([]);
  });

  test('escapes file URIs as GLib does for the shared thumbnail cache', () => {
    expect(glibFileUri('/home/me/a b;c~[1].png')).toBe('file:///home/me/a%20b;c~%5B1%5D.png');
    expect(glibFileUri('/tmp/한글.md')).toBe('file:///tmp/%ED%95%9C%EA%B8%80.md');
    expect(thumbnailCandidates('/a.png', '/cache')[0]).toMatch(/^\/cache\/thumbnails\/large\/[0-9a-f]{32}\.png$/);
  });
});

describe('file manager operations', () => {
  test('adds and removes GTK bookmarks without touching other lines', async () => {
    const home = await temporary();
    const config = path.join(home, '.config');
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = config;
    try {
      await mkdir(path.join(config, 'gtk-3.0'), { recursive: true });
      const file = path.join(config, 'gtk-3.0', 'bookmarks');
      await writeFile(file, 'file:///home/me/Music Tunes\n');
      await setBookmark('/home/me/My Notes', true, home);
      expect(await readFile(file, 'utf8')).toBe('file:///home/me/Music Tunes\nfile:///home/me/My%20Notes\n');
      await setBookmark('/home/me/Music', false, home);
      expect(await readFile(file, 'utf8')).toBe('file:///home/me/My%20Notes\n');
    } finally { if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; }
  });

  test('reports folder totals and file details', async () => {
    const root = await temporary();
    await mkdir(path.join(root, 'a', 'b'), { recursive: true });
    await writeFile(path.join(root, 'a', 'one.txt'), '12345');
    await writeFile(path.join(root, 'a', 'b', 'two.txt'), '123');
    const folder = await properties(path.join(root, 'a'));
    expect(folder).toMatchObject({ directory: true, size: 8, items: 3, partial: false, type: 'inode/directory' });
    expect(folder.permissions).toMatch(/^[rwx-]{9}$/);
    expect((await properties(path.join(root, 'a', 'one.txt'))).size).toBe(5);
    expect((await properties(path.join(root, 'a'), { entries: 1, milliseconds: 4000 })).partial).toBe(true);
  });

  test('compresses to a new zip and extracts into a new folder without overwriting', async () => {
    const root = await temporary();
    await mkdir(path.join(root, 'docs'));
    await writeFile(path.join(root, 'docs', 'a.txt'), 'alpha');
    await writeFile(path.join(root, 'b.txt'), 'beta');
    const archive = await compressFiles([path.join(root, 'docs'), path.join(root, 'b.txt')]);
    expect(path.basename(archive)).toBe('Archive.zip');
    expect(path.basename(await compressFiles([path.join(root, 'b.txt')]))).toBe('b.zip');
    const first = await extractArchive(archive), second = await extractArchive(archive);
    expect([path.basename(first), path.basename(second)]).toEqual(['Archive', 'Archive 2']);
    expect(await readFile(path.join(first, 'docs', 'a.txt'), 'utf8')).toBe('alpha');
    expect((await readdir(second)).sort()).toEqual(['b.txt', 'docs']);
    await expect(extractArchive(path.join(root, 'b.txt'))).rejects.toThrow(/cannot be extracted/);
  });
});

describe('name search', () => {
  test('requires every word and finds folders through their files', () => {
    expect(matchesQuery('Lecture Notes 3.md', queryWords('notes LECT'))).toBe(true);
    expect(matchesQuery('Lecture.md', queryWords('lect notes'))).toBe(false);
    expect(collectMatches('/r', ['notes/week1/a.md', 'notes/b.md', 'other/notes.txt'], ['notes'], 10))
      .toEqual(['/r/notes', '/r/other/notes.txt']);
    expect(collectMatches('/r', ['a1', 'a2', 'a3'], ['a'], 2)).toHaveLength(2);
  });

  test('searches a real tree with ripgrep, honouring hidden files', async () => {
    const root = await temporary();
    await mkdir(path.join(root, 'deep', 'report-archive'), { recursive: true });
    await writeFile(path.join(root, 'deep', 'report-archive', 'x.txt'), '');
    await writeFile(path.join(root, 'Report 2026.md'), '');
    await writeFile(path.join(root, '.report-hidden'), '');
    const search = new FileSearch();
    const visible = await search.search(1, root, 'report', false);
    expect(visible.paths.map(file => path.relative(root, file))).toEqual(['Report 2026.md', path.join('deep', 'report-archive')]);
    expect((await search.search(1, root, 'report', true)).paths).toContain(path.join(root, '.report-hidden'));
    expect((await search.search(1, root, '  ', false)).paths).toEqual([]);
  });
});

describe('launching as a file manager', () => {
  const isDirectory = (candidate: string) => ['/home/me/Documents', '/srv/data'].includes(candidate);
  test('opens folder arguments, file URIs and --files', () => {
    expect(folderRequestFromArgs(['/opt/setdown', '/home/me/Documents'], true, '/home/me', isDirectory)).toEqual({ path: '/home/me/Documents' });
    expect(folderRequestFromArgs(['/opt/setdown', 'file:///srv/data'], true, '/home/me', isDirectory)).toEqual({ path: '/srv/data' });
    expect(folderRequestFromArgs(['/opt/setdown', '--files'], true, '/home/me', isDirectory)).toEqual({ path: '/home/me' });
    expect(folderRequestFromArgs(['/opt/setdown', '/home/me/notes.md'], true, '/home/me', isDirectory)).toBeNull();
    expect(folderRequestFromArgs(['electron', '--inspect=0', '--remote-debugging-port=0', '.'], false, '/home/me', () => true)).toBeNull();
  });

  test('maps FileManager1 calls to folders and selections', () => {
    expect(requestsFromFileManagerCall('ShowFolders', ['/srv/data', '/nope', 'relative'], isDirectory)).toEqual([{ path: '/srv/data' }]);
    expect(requestsFromFileManagerCall('ShowItems', ['/a/x.pdf', '/a/y.pdf', '/b/z'], isDirectory))
      .toEqual([{ path: '/a', selection: ['/a/x.pdf', '/a/y.pdf'] }, { path: '/b', selection: ['/b/z'] }]);
    expect(requestsFromFileManagerCall('ShowItemProperties', ['/a/x.pdf'], isDirectory)).toEqual([{ path: '/a', selection: ['/a/x.pdf'], properties: true }]);
  });
});
