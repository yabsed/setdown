import { describe, expect, it } from 'vitest';
import type { FolderEntry } from './folder-types';
import { compareNames, folderCrumbs, formatSize, parentFolder, presentFolder } from './folder-presentation';

const entry = (name: string, kind: FolderEntry['kind'] = 'file', extra: Partial<FolderEntry> = {}): FolderEntry =>
  ({ path: `/d/${name}`, name, kind, size: 0, modified: 0, hidden: name.startsWith('.'), ...extra });

describe('folder presentation', () => {
  it('sorts folders first with natural names', () => {
    const rows = presentFolder([entry('file10.md'), entry('file2.md'), entry('zeta', 'directory'), entry('Alpha', 'directory')],
      { sort: 'name', descending: false, showHidden: true });
    expect(rows.map(row => row.name)).toEqual(['Alpha', 'zeta', 'file2.md', 'file10.md']);
  });

  it('keeps folders first when sorting in descending order', () => {
    const rows = presentFolder([entry('a.txt'), entry('b.txt'), entry('docs', 'directory')], { sort: 'name', descending: true, showHidden: true });
    expect(rows.map(row => row.name)).toEqual(['docs', 'b.txt', 'a.txt']);
  });

  it('separates names a numeric collator considers equal', () => {
    expect(compareNames('img_7', 'img_07')).not.toBe(0);
    expect(compareNames('a', 'a')).toBe(0);
  });

  it('sorts by size and modified time with the name as the tie-break', () => {
    const rows = [entry('b', 'file', { size: 5, modified: 1 }), entry('a', 'file', { size: 5, modified: 3 }), entry('c', 'file', { size: 1, modified: 2 })];
    expect(presentFolder(rows, { sort: 'size', descending: false, showHidden: true }).map(row => row.name)).toEqual(['c', 'a', 'b']);
    expect(presentFolder(rows, { sort: 'modified', descending: true, showHidden: true }).map(row => row.name)).toEqual(['a', 'c', 'b']);
  });

  it('hides dotfiles only when asked', () => {
    const rows = [entry('.env'), entry('notes.md')];
    expect(presentFolder(rows, { sort: 'name', descending: false, showHidden: false }).map(row => row.name)).toEqual(['notes.md']);
    expect(presentFolder(rows, { sort: 'name', descending: false, showHidden: true })).toHaveLength(2);
  });

  it('formats sizes in decimal units', () => {
    expect(formatSize(1)).toBe('1 byte');
    expect(formatSize(999)).toBe('999 bytes');
    expect(formatSize(1500)).toBe('1.5 kB');
    expect(formatSize(25_000_000)).toBe('25 MB');
  });

  it('roots breadcrumbs at home and mounts', () => {
    expect(folderCrumbs('/home/me/a/b', '/home/me')).toEqual([
      { name: 'Home', path: '/home/me' }, { name: 'a', path: '/home/me/a' }, { name: 'b', path: '/home/me/a/b' }]);
    expect(folderCrumbs('/run/media/me/USB/x', '/home/me', [{ path: '/run/media/me/USB', name: 'USB' }]).map(crumb => crumb.name)).toEqual(['USB', 'x']);
    expect(folderCrumbs('/etc', '/home/me')).toEqual([{ name: '/', path: '/' }, { name: 'etc', path: '/etc' }]);
    expect(folderCrumbs('/home/me', '/home/me')).toEqual([{ name: 'Home', path: '/home/me' }]);
  });

  it('stops at the drive or share root on Windows', () => {
    expect(folderCrumbs('C:\\Users\\me\\a', 'C:\\Users\\me')).toEqual([{ name: 'Home', path: 'C:\\Users\\me' }, { name: 'a', path: 'C:\\Users\\me\\a' }]);
    expect(folderCrumbs('D:\\data\\x', 'C:\\Users\\me')).toEqual([
      { name: 'D:\\', path: 'D:\\' }, { name: 'data', path: 'D:\\data' }, { name: 'x', path: 'D:\\data\\x' }]);
    expect(folderCrumbs('\\\\nas\\docs\\a', 'C:\\Users\\me').map(crumb => crumb.path)).toEqual(['\\\\nas\\docs\\', '\\\\nas\\docs\\a']);
  });

  it('finds the parent folder without leaving the filesystem root', () => {
    expect(['/home/me/a', '/home/me/', '/home', '/'].map(parentFolder)).toEqual(['/home/me', '/home', '/', '/']);
    // `C:` alone is drive-relative, which the main process rejects as a folder path.
    expect(['C:\\Users\\me', 'C:\\Users', 'C:\\', 'D:/data/x'].map(parentFolder)).toEqual(['C:\\Users', 'C:\\', 'C:\\', 'D:/data']);
    expect(['\\\\nas\\docs\\a\\b', '\\\\nas\\docs\\a', '\\\\nas\\docs\\', '\\\\nas\\docs'].map(parentFolder))
      .toEqual(['\\\\nas\\docs\\a', '\\\\nas\\docs\\', '\\\\nas\\docs\\', '\\\\nas\\docs']);
  });
});
