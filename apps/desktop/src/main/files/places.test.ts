import { describe, expect, it } from 'vitest';
import { parseBookmarks, parseMountInfo, parseUserDirs, trashInfoPath } from './places';

describe('desktop places', () => {
  it('reads GTK bookmarks with optional labels and escaped paths', () => {
    expect(parseBookmarks('file:///home/me/Documents\nfile:///home/me/My%20Notes Notes\nsftp://server/x Remote\n\n')).toEqual([
      { path: '/home/me/Documents', name: 'Documents' },
      { path: '/home/me/My Notes', name: 'Notes' },
    ]);
  });

  it('keeps removable, /mnt and home mounts and decodes spaces', () => {
    const info = [
      '22 1 0:21 / / rw,relatime - btrfs /dev/nvme0n1p3 rw',
      '25 22 0:5 / /dev rw - devtmpfs devtmpfs rw',
      '90 22 8:17 / /run/media/me/My\\040USB rw - vfat /dev/sdb1 rw',
      '91 22 8:18 / /mnt/data rw - ext4 /dev/sdc1 rw',
      '92 22 0:50 / /home/me/remote rw - fuse.sshfs me@host: rw',
      '93 22 0:51 / /run/user/1000/gvfs rw - fuse.gvfsd-fuse gvfsd-fuse rw',
      '94 22 0:52 / /home/me rw - btrfs /dev/nvme0n1p3 rw',
    ].join('\n');
    expect(parseMountInfo(info, '/home/me', 'me')).toEqual([
      { path: '/run/media/me/My USB', name: 'My USB', type: 'vfat', removable: true },
      { path: '/mnt/data', name: 'data', type: 'ext4', removable: false },
      { path: '/home/me/remote', name: 'remote', type: 'fuse.sshfs', removable: false },
    ]);
  });

  it('expands $HOME in user-dirs.dirs and skips the home folder itself', () => {
    expect(parseUserDirs('# comment\nXDG_DESKTOP_DIR="$HOME"\nXDG_DOCUMENTS_DIR="$HOME/문서"\nXDG_TEMPLATES_DIR="/srv/t"\n', '/home/me'))
      .toEqual({ documents: '/home/me/문서', templates: '/srv/t' });
  });

  it('decodes trashinfo paths, including volume-relative ones', () => {
    expect(trashInfoPath('[Trash Info]\nPath=/home/me/a%20b.md\nDeletionDate=2026-11-11T10:00:00\n', '/')).toBe('/home/me/a b.md');
    expect(trashInfoPath('[Trash Info]\nPath=docs/x.txt\n', '/run/media/me/USB')).toBe('/run/media/me/USB/docs/x.txt');
    expect(trashInfoPath('Path=/x\n', '/')).toBeNull();
    expect(trashInfoPath('[Trash Info]\nPath=%E0%A4%A\n', '/')).toBeNull();
  });
});
