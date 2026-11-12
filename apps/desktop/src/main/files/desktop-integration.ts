import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { FileApplication, FileProperties, FolderVolume } from '../../core/files/folder-types';
import { configHome, dataHome, parseBookmarks } from './places';

/**
 * Desktop services a file manager needs, reused from the system instead of
 * reimplemented: GIO resolves content types, default applications and Trash
 * exactly as GNOME Files does; UDisks mounts volumes; the freedesktop thumbnail
 * cache is shared with other applications. `LC_ALL=C` keeps CLI output parseable.
 */
const exec = promisify(execFile);
const run = (command: string, args: string[], timeout = 15_000) =>
  exec(command, args, { timeout, maxBuffer: 8_000_000, env: { ...process.env, LC_ALL: 'C' } }).then(result => result.stdout);

export function parseContentType(output: string): string {
  return /standard::content-type:\s*(\S+)/.exec(output)?.[1] ?? 'application/octet-stream';
}
export async function contentType(file: string): Promise<string> {
  try { return parseContentType(await run('gio', ['info', '-a', 'standard::content-type', file], 5000)); }
  catch { return 'application/octet-stream'; }
}

/** `gio mime <type>` lists the default, then registered and recommended desktop IDs. */
export function parseMimeApplications(output: string): { defaultId: string | null; ids: string[] } {
  const defaultId = /^Default application for .*?:\s*(\S+\.desktop)\s*$/m.exec(output)?.[1] ?? null;
  const ids = [...output.matchAll(/^\t(\S+\.desktop)\s*$/gm)].map(match => match[1]);
  return { defaultId, ids: [...new Set([...(defaultId ? [defaultId] : []), ...ids])] };
}

export function parseDesktopEntry(text: string, locale = ''): { name: string; exec: string; hidden: boolean } | null {
  const section = /^\[Desktop Entry\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1];
  if (!section) return null;
  const value = (key: string) => new RegExp(`^${key.replace(/[[\]]/g, '\\$&')}\\s*=\\s*(.*)$`, 'm').exec(section)?.[1]?.trim();
  const language = locale.split(/[_.@]/)[0];
  const name = (locale && value(`Name[${locale.split(/[.@]/)[0]}]`)) || (language && value(`Name[${language}]`)) || value('Name');
  const exec = value('Exec');
  if (!name || !exec) return null;
  return { name, exec, hidden: value('NoDisplay') === 'true' && !/%[fFuU]/.test(exec) || value('Hidden') === 'true' };
}

function applicationDirectories(home = os.homedir()): string[] {
  const data = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  return [...new Set([dataHome(home), ...data, path.join(home, '.local/share/flatpak/exports/share'), '/var/lib/flatpak/exports/share'])]
    .map(directory => path.join(directory, 'applications'));
}
async function desktopFile(id: string): Promise<string | null> {
  if (!/^[\w.-]+\.desktop$/.test(id)) return null;
  for (const directory of applicationDirectories()) {
    const candidate = path.join(directory, id);
    if (await fs.stat(candidate).then(stat => stat.isFile(), () => false)) return candidate;
  }
  return null;
}

export async function applicationsFor(file: string): Promise<{ type: string; applications: FileApplication[] }> {
  const type = await contentType(file);
  let parsed = { defaultId: null as string | null, ids: [] as string[] };
  try { parsed = parseMimeApplications(await run('gio', ['mime', type], 5000)); } catch { /* No handlers registered. */ }
  const locale = process.env.LC_MESSAGES || process.env.LANG || '';
  const applications: FileApplication[] = [];
  for (const id of parsed.ids.slice(0, 40)) {
    const location = await desktopFile(id);
    const entry = location ? parseDesktopEntry(await fs.readFile(location, 'utf8').catch(() => ''), locale) : null;
    if (entry && !entry.hidden) applications.push({ id, name: entry.name, isDefault: id === parsed.defaultId });
  }
  return { type, applications };
}

export async function openWith(id: string, files: string[]): Promise<void> {
  const location = await desktopFile(id);
  if (!location) throw new Error('That application is no longer installed.');
  await run('gio', ['launch', location, ...files], 20_000);
}

export const emptyTrash = () => run('gio', ['trash', '--empty'], 120_000).then(() => undefined);

/** Removable or hot-plugged filesystems from `lsblk --json`, mounted or not. */
export function parseVolumes(json: string): FolderVolume[] {
  type Device = { path?: string; label?: string | null; mountpoint?: string | null; rm?: boolean; hotplug?: boolean; type?: string; size?: string; fstype?: string | null; children?: Device[] };
  const volumes: FolderVolume[] = [];
  const visit = (device: Device, removable: boolean) => {
    const external = removable || device.rm === true || device.hotplug === true;
    if (device.children?.length) { for (const child of device.children) visit(child, external); return; }
    if (!external || !device.path || !device.fstype || device.fstype === 'swap' || device.mountpoint === '[SWAP]') return;
    volumes.push({ device: device.path, name: device.label || `${device.size ?? ''} Volume`.trim(), mountPath: device.mountpoint || null });
  };
  try { for (const device of (JSON.parse(json) as { blockdevices?: Device[] }).blockdevices ?? []) visit(device, false); } catch { /* Unparseable output lists nothing. */ }
  return volumes;
}
export async function listVolumes(): Promise<FolderVolume[]> {
  if (process.platform !== 'linux') return [];
  try { return parseVolumes(await run('lsblk', ['--json', '-o', 'NAME,PATH,LABEL,MOUNTPOINT,RM,HOTPLUG,TYPE,SIZE,FSTYPE'], 5000)); }
  catch { return []; }
}
const blockDevice = (device: string) => { if (!/^\/dev\/[\w/-]+$/.test(device)) throw new Error('Invalid device.'); return device; };
export async function mountVolume(device: string): Promise<string> {
  const output = await run('udisksctl', ['mount', '--no-user-interaction', '-b', blockDevice(device)], 60_000);
  const mounted = /Mounted \S+ at (.+?)\.?\s*$/m.exec(output)?.[1];
  if (!mounted) throw new Error(output.trim() || 'The volume could not be mounted.');
  return mounted;
}
export async function unmountVolume(device: string): Promise<void> {
  await run('udisksctl', ['unmount', '--no-user-interaction', '-b', blockDevice(device)], 60_000);
}

const bookmarksFile = (home = os.homedir()) => path.join(configHome(home), 'gtk-3.0', 'bookmarks');
/** GTK's bookmark file is shared with GNOME Files and every GTK file chooser. */
export async function setBookmark(folder: string, present: boolean, home = os.homedir()): Promise<void> {
  const file = bookmarksFile(home);
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  const kept = lines.filter(line => parseBookmarks(line)[0]?.path !== folder);
  // GLib's escaping matters only where GTK shares the file; a Windows path needs the drive-letter URL form.
  if (present) kept.push(process.platform === 'win32' ? pathToFileURL(folder).href : glibFileUri(folder));
  if (kept.join('\n') === lines.join('\n')) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, kept.length ? `${kept.join('\n')}\n` : '');
  await fs.rename(temporary, file);
}

/** g_filename_to_uri escaping: unreserved, sub-delims, ":@/" stay literal. */
export function glibFileUri(file: string): string {
  let uri = 'file://';
  for (const byte of Buffer.from(file)) {
    const char = String.fromCharCode(byte);
    uri += /[A-Za-z0-9\-._~!$&'()*+,;=:@/]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return uri;
}

/** Thumbnail Managing Standard: `<cache>/thumbnails/<size>/<md5(uri)>.png`. */
export function thumbnailCandidates(file: string, cache = process.env.XDG_CACHE_HOME && path.isAbsolute(process.env.XDG_CACHE_HOME) ? process.env.XDG_CACHE_HOME : path.join(os.homedir(), '.cache')): string[] {
  const name = `${createHash('md5').update(glibFileUri(file)).digest('hex')}.png`;
  return ['large', 'x-large', 'normal', 'xx-large'].map(size => path.join(cache, 'thumbnails', size, name));
}

const IMAGE = /\.(png|jpe?g|webp|gif|avif|tiff?|svg|bmp|heic)$/i;
const thumbnails = new Map<string, string | null>();
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>(resolve => waiting.push(resolve));
  active++;
  try { return await task(); } finally { active--; waiting.shift()?.(); }
}
/**
 * A shared-cache thumbnail when one is current, otherwise one rendered with
 * sharp for image files. Returned as a data URL; results are kept in a small LRU.
 */
export async function thumbnail(file: string): Promise<string | null> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  const key = `${file}\0${stat.mtimeMs}\0${stat.size}`;
  if (thumbnails.has(key)) { const hit = thumbnails.get(key)!; thumbnails.delete(key); thumbnails.set(key, hit); return hit; }
  const result = await slot(async () => {
    for (const candidate of thumbnailCandidates(file)) {
      const cached = await fs.stat(candidate).catch(() => null);
      if (cached && cached.mtimeMs >= stat.mtimeMs && cached.size < 2_000_000)
        return `data:image/png;base64,${(await fs.readFile(candidate)).toString('base64')}`;
    }
    if (!IMAGE.test(file) || stat.size > 64 * 1024 * 1024) return null;
    try {
      const { default: sharp } = await import('sharp');
      const buffer = await sharp(file, { limitInputPixels: 80_000_000, animated: false }).rotate()
        .resize(192, 192, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
      return `data:image/webp;base64,${buffer.toString('base64')}`;
    } catch { return null; }
  });
  thumbnails.set(key, result);
  if (thumbnails.size > 600) thumbnails.delete(thumbnails.keys().next().value!);
  return result;
}

const permissions = (mode: number) => [6, 3, 0].map(shift => {
  const bits = (mode >> shift) & 7;
  return `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`;
}).join('');

/** Folder totals are bounded so a huge tree cannot stall the dialog. */
export async function properties(file: string, budget = { entries: 200_000, milliseconds: 4000 }): Promise<FileProperties> {
  const stat = await fs.lstat(file);
  const link = stat.isSymbolicLink() ? await fs.readlink(file).catch(() => '') : undefined;
  const target = stat.isSymbolicLink() ? await fs.stat(file).catch(() => stat) : stat;
  const directory = target.isDirectory();
  let size = directory ? 0 : target.size, items = 0, partial = false;
  if (directory && !stat.isSymbolicLink()) {
    const deadline = Date.now() + budget.milliseconds;
    const pending = [file];
    while (pending.length) {
      if (items >= budget.entries || Date.now() > deadline) { partial = true; break; }
      const current = pending.pop()!;
      for (const entry of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) {
        items++;
        const child = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(child);
        else if (entry.isFile()) size += await fs.lstat(child).then(item => item.size, () => 0);
      }
    }
  }
  const volume = await fs.statfs(directory ? file : path.dirname(file)).catch(() => null);
  let owner = String(stat.uid);
  try { if (os.userInfo().uid === stat.uid) owner = os.userInfo().username; } catch { /* Keep the numeric owner. */ }
  return { path: file, name: path.basename(file) || file, directory, type: directory ? 'inode/directory' : await contentType(file),
    size, items: directory ? items : undefined, partial, modified: stat.mtimeMs, created: stat.birthtimeMs, accessed: stat.atimeMs,
    permissions: permissions(stat.mode), owner, link,
    free: volume ? Number(volume.bavail) * Number(volume.bsize) : undefined, capacity: volume ? Number(volume.blocks) * Number(volume.bsize) : undefined };
}

/** New, unused sibling name: `name`, `name 2`, `name 3`… */
async function uniqueSibling(directory: string, base: string, suffix = ''): Promise<string> {
  for (let index = 1; index < 1000; index++) {
    const candidate = path.join(directory, `${base}${index === 1 ? '' : ` ${index}`}${suffix}`);
    if (!await fs.lstat(candidate).then(() => true, () => false)) return candidate;
  }
  throw new Error('Could not choose a free name.');
}
/** Windows has no zip/unzip, but ships libarchive's tar, which reads and writes zip. A Unix shell's GNU tar on PATH does not. */
const windowsTar = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
export const ARCHIVE = /\.(zip|7z|rar|tar|tgz|tbz2|txz|tar\.(gz|bz2|xz|zst))$/i;
/** Extract into a new folder named after the archive; nothing existing is overwritten. */
export async function extractArchive(archive: string): Promise<string> {
  const match = ARCHIVE.exec(archive);
  if (!match) throw new Error('This file type cannot be extracted.');
  const target = await uniqueSibling(path.dirname(archive), path.basename(archive).slice(0, -match[0].length) || 'Archive');
  await fs.mkdir(target);
  try {
    if (process.platform === 'win32') await run(windowsTar(), ['-xf', archive, '-C', target], 600_000);
    else if (/\.zip$/i.test(archive)) await run('unzip', ['-q', '-n', archive, '-d', target], 600_000);
    else if (/\.(7z|rar)$/i.test(archive)) await run('7z', ['x', '-y', `-o${target}`, archive], 600_000);
    else await run('tar', ['-xf', archive, '-C', target, '--no-same-owner'], 600_000);
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true });
    throw new Error(`Could not extract “${path.basename(archive)}”: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
  return target;
}
/** Compress siblings into one new .zip beside them. */
export async function compressFiles(files: string[]): Promise<string> {
  if (!files.length) throw new Error('Select files or folders first.');
  const directory = path.dirname(files[0]);
  if (files.some(file => path.dirname(file) !== directory)) throw new Error('Compress items from one folder at a time.');
  const base = files.length === 1 ? path.basename(files[0]).replace(/\.[^.]+$/, '') || path.basename(files[0]) : 'Archive';
  const target = await uniqueSibling(directory, base, '.zip');
  const names = files.map(file => path.basename(file));
  const windows = process.platform === 'win32';
  await exec(windows ? windowsTar() : 'zip', [...(windows ? ['-a', '-cf'] : ['-r', '-q', '-y']), target, '--', ...names],
    { cwd: directory, timeout: 600_000, maxBuffer: 8_000_000, env: { ...process.env, LC_ALL: 'C' } });
  return target;
}
