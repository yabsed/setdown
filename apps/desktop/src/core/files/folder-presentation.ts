import type { FolderEntry } from './folder-types';

export type FolderSort = 'name' | 'modified' | 'size' | 'type';
export type FolderViewOptions = { sort: FolderSort; descending: boolean; showHidden: boolean; layout?: 'list' | 'grid' };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Natural file-name order. The numeric collator matches GLib's
 * g_utf8_collate_key_for_filename closely; the final comparison separates names
 * the collator treats as equal (`img_7` / `img_07`), as VS Code's
 * compareFileNames does (vendor/vscode/src/vs/base/common/comparers.ts, MIT).
 */
export function compareNames(a: string, b: string): number {
  const result = collator.compare(a, b);
  if (result !== 0) return result;
  return a < b ? -1 : a > b ? 1 : 0;
}

export const extensionOf = (name: string): string =>
  name.includes('.') && !name.startsWith('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';

const directory = (entry: FolderEntry) => entry.kind === 'directory';

/** Folders first (in both directions), then the chosen key, then the name. */
export function presentFolder(entries: FolderEntry[], options: FolderViewOptions, accept: (entry: FolderEntry) => boolean = () => true): FolderEntry[] {
  const order = options.descending ? -1 : 1;
  const key = (a: FolderEntry, b: FolderEntry) => {
    if (options.sort === 'modified') return a.modified - b.modified;
    if (options.sort === 'size') return directory(a) ? 0 : a.size - b.size;
    if (options.sort === 'type') return extensionOf(a.name).localeCompare(extensionOf(b.name));
    return 0;
  };
  return entries.filter(entry => (options.showHidden || !entry.hidden) && accept(entry))
    .sort((a, b) => Number(directory(b)) - Number(directory(a)) || order * (key(a, b) || compareNames(a.name, b.name)));
}

const UNITS = ['bytes', 'kB', 'MB', 'GB', 'TB'];
/** Decimal units, as GNOME Files shows them. */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return bytes === 1 ? '1 byte' : `${bytes} bytes`;
  let value = bytes, unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) { value /= 1000; unit++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}

export function formatModified(time: number, now = Date.now(), locale?: string): string {
  if (!Number.isFinite(time) || time <= 0) return '';
  const date = new Date(time), today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString(locale, date.getFullYear() === today.getFullYear()
    ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

export function kindLabel(entry: FolderEntry): string {
  if (entry.link?.broken) return 'Broken link';
  if (entry.kind === 'directory') return entry.link ? 'Folder link' : 'Folder';
  const extension = extensionOf(entry.name);
  return extension ? `${extension.toUpperCase()} ${entry.kind === 'document' ? 'document' : 'file'}` : 'File';
}

/** Length of a path's filesystem root: `/`, `C:\` or `\\server\share\`. */
export function rootLength(path: string): number {
  if (/^[A-Za-z]:[\\/]/.test(path)) return 3;
  const share = /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+[\\/]?/.exec(path);
  return share ? share[0].length : /^[\\/]/.test(path) ? 1 : 0;
}

/** The containing folder; a filesystem root is its own parent (`C:\Users` → `C:\`, never the relative `C:`). */
export function parentFolder(path: string): string {
  const root = rootLength(path);
  const rest = path.slice(root).replace(/[\\/]+$/, '');
  const cut = Math.max(rest.lastIndexOf('/'), rest.lastIndexOf('\\'));
  return cut < 0 ? path.slice(0, root) || path : path.slice(0, root + cut);
}

/** Breadcrumb segments rooted at home or a filesystem root, as Nautilus's pathbar does. */
export function folderCrumbs(path: string, home: string, roots: { path: string; name: string }[] = []): { name: string; path: string }[] {
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  const anchors = [...roots, ...(home ? [{ path: home, name: 'Home' }] : [])]
    .filter(root => path === root.path || path.startsWith(root.path.endsWith(separator) ? root.path : `${root.path}${separator}`))
    .sort((a, b) => b.path.length - a.path.length);
  const anchor = anchors[0];
  const base = anchor ? anchor.path : path.slice(0, rootLength(path)) || '/';
  const crumbs = [{ name: anchor?.name ?? base, path: base }];
  const rest = path.slice(base.length).split(separator).filter(Boolean);
  let current = base;
  for (const part of rest) {
    current = current.endsWith(separator) ? `${current}${part}` : `${current}${separator}${part}`;
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}
