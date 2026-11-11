import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FolderPlace } from '../../protocol/files';

/**
 * Places come from the same files GNOME Files and the GTK file chooser read, so
 * bookmarks and folders stay shared with the desktop:
 * - `$XDG_CONFIG_HOME/gtk-3.0/bookmarks`: `URI[ label]` per line
 *   (vendor/nautilus/src/nautilus-bookmark-list.c:461-473).
 * - `/proc/self/mountinfo` for user-visible mounts (as yazi reads /proc/mounts,
 *   vendor/yazi/yazi-fs/src/mounts/linux.rs).
 * - The freedesktop Trash under `$XDG_DATA_HOME/Trash`.
 */
export function parseBookmarks(text: string): { path: string; name: string }[] {
  const places: { path: string; name: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;
    const space = value.indexOf(' ');
    const uri = space < 0 ? value : value.slice(0, space);
    if (!uri.startsWith('file:')) continue;
    try {
      const target = fileURLToPath(uri);
      places.push({ path: target, name: (space < 0 ? '' : value.slice(space + 1).trim()) || path.basename(target) || target });
    } catch { /* Malformed bookmark lines are skipped, as GTK does. */ }
  }
  return places;
}

const decodeMount = (value: string) => value.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)));
const SYSTEM_TYPES = new Set(['proc', 'sysfs', 'devtmpfs', 'devpts', 'tmpfs', 'cgroup', 'cgroup2', 'securityfs', 'pstore', 'bpf',
  'debugfs', 'tracefs', 'configfs', 'fusectl', 'mqueue', 'hugetlbfs', 'autofs', 'efivarfs', 'binfmt_misc', 'ramfs', 'rpc_pipefs', 'nsfs', 'overlay', 'squashfs']);

/** Mounts a user would browse: removable media, /mnt and folders under home. */
export function parseMountInfo(text: string, home: string, user = os.userInfo().username): { path: string; name: string; type: string; removable: boolean }[] {
  const mounts: { path: string; name: string; type: string; removable: boolean }[] = [];
  for (const line of text.split('\n')) {
    const separator = line.indexOf(' - ');
    if (separator < 0) continue;
    const fields = line.slice(0, separator).split(' ');
    const [type, source] = line.slice(separator + 3).split(' ');
    const target = decodeMount(fields[4] ?? '');
    if (!target || SYSTEM_TYPES.has(type) || type?.startsWith('fuse.gvfsd') || type === 'fuse.portal') continue;
    const removable = target.startsWith(`/run/media/${user}/`) || target.startsWith('/media/');
    const visible = removable || target.startsWith('/mnt/') || (target !== home && target.startsWith(`${home}/`));
    if (!visible || mounts.some(mount => mount.path === target)) continue;
    mounts.push({ path: target, name: path.basename(target) || decodeMount(source ?? target), type, removable });
  }
  return mounts;
}

/** `user-dirs.dirs` uses shell syntax: XDG_TEMPLATES_DIR="$HOME/Templates". */
export function parseUserDirs(text: string, home: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*XDG_([A-Z]+)_DIR\s*=\s*"(.*)"\s*$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^\$HOME(?=\/|$)/, home).replace(/\\(.)/g, '$1');
    if (path.isAbsolute(value) && value !== home) result[match[1].toLowerCase()] = value;
  }
  return result;
}

export const dataHome = (home = os.homedir()) => process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME) ? process.env.XDG_DATA_HOME : path.join(home, '.local', 'share');
export const configHome = (home = os.homedir()) => process.env.XDG_CONFIG_HOME && path.isAbsolute(process.env.XDG_CONFIG_HOME) ? process.env.XDG_CONFIG_HOME : path.join(home, '.config');
export const trashFiles = (home = os.homedir()) => path.join(dataHome(home), 'Trash', 'files');

const exists = (candidate: string) => fs.stat(candidate).then(stat => stat.isDirectory(), () => false);

export async function listPlaces(home: string, userDirectory: (name: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos') => string | null): Promise<FolderPlace[]> {
  const places: FolderPlace[] = [{ id: 'home', name: 'Home', path: home, kind: 'home' }];
  const add = async (place: FolderPlace) => {
    if (places.some(other => other.path === place.path) || !await exists(place.path)) return;
    places.push(place);
  };
  const labels = { desktop: 'Desktop', documents: 'Documents', downloads: 'Downloads', music: 'Music', pictures: 'Pictures', videos: 'Videos' } as const;
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
    const location = userDirectory(key);
    if (location && location !== home) await add({ id: `user:${key}`, name: labels[key], path: location, kind: 'user' });
  }
  const bookmarks = await fs.readFile(path.join(configHome(home), 'gtk-3.0', 'bookmarks'), 'utf8').catch(() => '');
  for (const bookmark of parseBookmarks(bookmarks)) await add({ id: `bookmark:${bookmark.path}`, name: bookmark.name, path: bookmark.path, kind: 'bookmark' });
  if (process.platform === 'linux') {
    const mountinfo = await fs.readFile('/proc/self/mountinfo', 'utf8').catch(() => '');
    for (const mount of parseMountInfo(mountinfo, home)) await add({ id: `mount:${mount.path}`, name: mount.name, path: mount.path, kind: 'mount', removable: mount.removable });
    const gvfs = typeof process.getuid === 'function' ? `/run/user/${process.getuid()}/gvfs` : '';
    for (const name of gvfs ? await fs.readdir(gvfs).catch(() => [] as string[]) : [])
      await add({ id: `mount:${gvfs}/${name}`, name: name.replace(/^[a-z]+-share:/, '').replace(/^[a-z]+:host=/, ''), path: path.join(gvfs, name), kind: 'mount' });
    await add({ id: 'trash', name: 'Trash', path: trashFiles(home), kind: 'trash' });
  }
  await add({ id: 'root', name: process.platform === 'win32' ? path.parse(home).root : 'Computer', path: path.parse(home).root, kind: 'root' });
  return places;
}

/** The freedesktop `.trashinfo` `Path=` value is URI-escaped and may be relative to the volume's top directory. */
export function trashInfoPath(text: string, topDirectory: string): string | null {
  const section = text.split(/\r?\n/);
  if (section[0]?.trim() !== '[Trash Info]') return null;
  const line = section.find(item => item.startsWith('Path='));
  if (!line) return null;
  let value: string;
  try { value = decodeURIComponent(line.slice(5).trim()); } catch { return null; }
  if (!value || value.includes('\0')) return null;
  return path.isAbsolute(value) ? path.normalize(value) : path.join(topDirectory, value);
}
