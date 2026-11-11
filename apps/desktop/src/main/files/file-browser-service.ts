import { constants, promises as fs, watch, type Dirent, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOpenableDocument } from '../../core/document/document-profile';
import type { ExplorerTransfer } from '../../protocol/explorer';
import type { FolderEntry, FolderListing, FolderLocation, FolderPlace } from '../../protocol/files';
import { listVolumes } from './desktop-integration';
import { FileSearch } from './file-search';
import type { ProjectEntryKind } from '../../protocol/desktop-api';
import { canonicalPath, isInside } from '../documents/file-system';
import type { ExplorerClipboardStore } from '../project/explorer-clipboard';
import { ExplorerService } from '../project/explorer-service';
import { ensureMissing, moveExclusive } from '../project/file-transfer';
import type { ProjectPaths } from '../project/project-paths';
import type { WindowState } from '../windows/window-state';
import type { LanguageFileOperation } from '../language/file-operations';
import { FileSystemPaths } from './file-system-paths';
import { listPlaces, trashInfoPath } from './places';

const LIST_LIMIT = 100_000;
const STAT_CONCURRENCY = 64;
const MAX_WATCHERS = 64;

async function mapLimit<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await map(items[index]); }
  }));
  return results;
}

export function expandLocation(input: string, home = os.homedir()): string {
  const value = input.trim();
  if (/^file:/i.test(value)) return fileURLToPath(value);
  if (value === '~') return home;
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  return value;
}

type Options = {
  clipboard: ExplorerClipboardStore;
  /** Rejects moves/deletes of paths that another window has open. */
  beforeMutation(state: WindowState, paths: string[]): void;
  home?: () => string;
  userDirectory?: (name: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos') => string | null;
  trash?: (filePath: string) => Promise<void>;
};

/**
 * Folder-tab backend. Listing and watching are new; every mutation goes through
 * the same ExplorerService the sidebar uses, with a filesystem-wide boundary.
 */
export class FileBrowserService {
  private readonly paths = new FileSystemPaths();
  readonly operations: ExplorerService;
  private readonly watchers = new Map<number, Map<string, { path: string; watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> }>>();
  constructor(private readonly options: Options) {
    this.operations = new ExplorerService(this.paths as unknown as ProjectPaths, options.trash, options.beforeMutation);
  }
  home = (): string => this.options.home?.() ?? os.homedir();

  /** Forward language-server file events only for paths inside the window's project. */
  setLanguageFileOperations(handler: (state: WindowState, operation: LanguageFileOperation, phase: 'will' | 'did') => Promise<void>): void {
    this.operations.languageOperation = async (state, operation, phase) => {
      const root = state.projectRoot;
      if (!root) return;
      const files = operation.files.filter(file => isInside(root, file.path) && (!file.to || isInside(root, file.to)));
      if (files.length) await handler(state, { ...operation, files }, phase);
    };
  }

  async list(candidate: string): Promise<FolderListing> {
    const directory = this.paths.inside(undefined, candidate);
    const dirents: Dirent[] = [];
    let truncated = false;
    const handle = await fs.opendir(directory, { bufferSize: 256 });
    for await (const dirent of handle) {
      if (dirent.name.startsWith('.setdown-copy-')) continue;
      if (dirents.length >= LIST_LIMIT) { truncated = true; break; }
      dirents.push(dirent);
    }
    const hiddenNames = new Set((await fs.readFile(path.join(directory, '.hidden'), 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean));
    const entries = (await mapLimit(dirents, STAT_CONCURRENCY, dirent => this.entry(directory, dirent.name, hiddenNames))).filter((entry): entry is FolderEntry => !!entry);
    const writable = await fs.access(directory, constants.W_OK).then(() => true, () => false);
    return { path: directory, entries, truncated, writable };
  }

  private async entry(directory: string, name: string, hiddenNames: Set<string>): Promise<FolderEntry | null> {
    const entryPath = path.join(directory, name);
    let stat;
    try { stat = await fs.lstat(entryPath); } catch { return null; }
    let link: FolderEntry['link'];
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(entryPath).catch(() => '');
      try { stat = await fs.stat(entryPath); link = { target, broken: false }; } catch { link = { target, broken: true }; }
    }
    const directoryKind = !link?.broken && stat.isDirectory();
    return { path: entryPath, name, kind: directoryKind ? 'directory' : !link?.broken && isOpenableDocument(entryPath) ? 'document' : 'file',
      size: directoryKind ? 0 : stat.size, modified: stat.mtimeMs,
      hidden: name.startsWith('.') || name.endsWith('~') || hiddenNames.has(name), ...(link ? { link } : {}) };
  }

  async resolve(location: string): Promise<FolderLocation> {
    if (typeof location !== 'string' || location.length > 16384) throw new Error('Invalid location.');
    const expanded = expandLocation(location, this.home());
    if (!path.isAbsolute(expanded)) throw new Error('Enter an absolute path, a file URL, or a path starting with ~.');
    const candidate = path.resolve(expanded);
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat?.isDirectory()) return { kind: 'folder', path: canonicalPath(candidate) };
    if (stat) return { kind: 'file', path: candidate };
    let parent: string | null = path.dirname(candidate);
    while (parent && !(await fs.stat(parent).then(item => item.isDirectory(), () => false))) {
      const next = path.dirname(parent); parent = next === parent ? null : next;
    }
    return { kind: 'missing', path: candidate, parent };
  }

  /** Shell-like completion: the typed parent's children that start with the typed name. */
  async complete(prefix: string, limit = 8): Promise<{ path: string; name: string; directory: boolean }[]> {
    if (typeof prefix !== 'string' || prefix.length > 4096) return [];
    let expanded: string;
    try { expanded = expandLocation(prefix, this.home()); } catch { return []; }
    if (!path.isAbsolute(expanded)) return [];
    const trailing = /[\\/]$/.test(expanded);
    const directory = trailing ? expanded : path.dirname(expanded);
    const typed = trailing ? '' : path.basename(expanded);
    const children = await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as Dirent[]);
    const lower = typed.toLocaleLowerCase();
    return children.filter(child => (typed.startsWith('.') || !child.name.startsWith('.')) && child.name.toLocaleLowerCase().startsWith(lower))
      .map(child => ({ path: path.join(directory, child.name), name: child.name, directory: child.isDirectory() || (child.isSymbolicLink()) }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .slice(0, Math.max(1, Math.min(50, limit)));
  }

  /** Desktop places plus removable volumes: mounted ones gain Unmount, unmounted ones can be mounted. */
  async places(): Promise<FolderPlace[]> {
    const [places, volumes] = await Promise.all([listPlaces(this.home(), name => this.options.userDirectory?.(name) ?? null), listVolumes()]);
    for (const volume of volumes) {
      const mounted = volume.mountPath ? places.find(place => place.path === volume.mountPath) : undefined;
      if (mounted) { mounted.device = volume.device; mounted.removable = true; continue; }
      const place: FolderPlace = volume.mountPath
        ? { id: `mount:${volume.mountPath}`, name: volume.name, path: volume.mountPath, kind: 'mount', removable: true, device: volume.device }
        : { id: `volume:${volume.device}`, name: volume.name, path: '', kind: 'volume', removable: true, device: volume.device };
      const before = places.findIndex(item => item.kind === 'trash' || item.kind === 'root');
      places.splice(before < 0 ? places.length : before, 0, place);
    }
    return places;
  }

  /** Rows for arbitrary paths (search results); missing paths are dropped. */
  async entries(paths: string[]): Promise<FolderEntry[]> {
    if (!Array.isArray(paths) || paths.length > 5000) throw new Error('Too many paths.');
    const rows = await mapLimit(paths, STAT_CONCURRENCY, candidate => {
      const entryPath = this.paths.entry(undefined, candidate);
      return this.entry(path.dirname(entryPath), path.basename(entryPath), new Set());
    });
    return rows.filter((row): row is FolderEntry => !!row);
  }

  private readonly searcher = new FileSearch();
  async search(state: WindowState, root: string, query: string, showHidden: boolean): Promise<{ entries: FolderEntry[]; limitHit: boolean }> {
    const found = await this.searcher.search(state.webContentsId, this.paths.inside(undefined, root), String(query).slice(0, 200), showHidden === true);
    return { entries: await this.entries(found.paths), limitHit: found.limitHit };
  }
  cancelSearch = (state: WindowState) => this.searcher.cancel(state.webContentsId);

  /** Shift+Delete: bypass Trash. Never a filesystem root, never something open in another window. */
  async deletePermanently(state: WindowState, candidates: string[]): Promise<void> {
    if (!Array.isArray(candidates) || !candidates.length || candidates.length > 10000) throw new Error('Select files or folders first.');
    const targets = [...new Set(candidates.map(candidate => this.paths.entry(undefined, candidate)))];
    for (const target of targets) if (target === path.parse(target).root || target === this.home()) throw new Error('This folder cannot be deleted.');
    this.options.beforeMutation(state, targets);
    for (const target of targets) await fs.rm(target, { recursive: true, force: false });
  }

  /** One non-recursive watch per visible folder tab. Events only invalidate; the renderer re-lists. */
  watch(state: WindowState, token: string, candidate: string | null, send: (event: { token: string; path: string }) => void): void {
    if (typeof token !== 'string' || token.length > 100) return;
    let owned = this.watchers.get(state.webContentsId);
    const previous = owned?.get(token);
    if (previous) { clearTimeout(previous.timer); previous.watcher.close(); owned!.delete(token); }
    if (candidate === null) return;
    const directory = this.paths.inside(undefined, candidate);
    if (!owned) {
      owned = new Map(); this.watchers.set(state.webContentsId, owned);
      state.window.once('closed', () => this.unwatchAll(state.webContentsId));
    }
    if (owned.size >= MAX_WATCHERS) return;
    try {
      const record: { path: string; watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> } = { path: directory, watcher: watch(directory, { persistent: false }, () => {
        clearTimeout(record.timer);
        record.timer = setTimeout(() => send({ token, path: directory }), 150);
      }) };
      record.watcher.on('error', () => { record.watcher.close(); if (owned!.get(token) === record) owned!.delete(token); });
      owned.set(token, record);
    } catch { /* Unwatchable folders still list; Refresh remains available. */ }
  }
  private unwatchAll(id: number): void {
    for (const record of this.watchers.get(id)?.values() ?? []) { clearTimeout(record.timer); record.watcher.close(); }
    this.watchers.delete(id);
  }
  dispose(): void { for (const id of [...this.watchers.keys()]) this.unwatchAll(id); }

  create = (state: WindowState, parent: string, name: string, kind: ProjectEntryKind) => this.operations.create(state, parent, name, kind);
  rename = (state: WindowState, entryPath: string, name: string) => this.operations.rename(state, entryPath, name);
  trash = (state: WindowState, entryPath: string) => this.operations.trashEntry(state, entryPath);
  transfer = (state: WindowState, request: ExplorerTransfer) => this.operations.transfer(state, request);
  cancel = (state: WindowState) => this.operations.cancel(state);

  async setClipboard(paths: string[], cut: boolean) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 10000) throw new Error('Select files or folders first.');
    const entries = [...new Set(paths.map(candidate => this.paths.entry(undefined, candidate)))];
    for (const entry of entries) {
      if (entry === path.parse(entry).root) throw new Error('A filesystem root cannot be copied or moved.');
      await fs.lstat(entry);
    }
    return this.options.clipboard.write(entries, cut === true);
  }
  async paste(state: WindowState, target: string, conflict?: ExplorerTransfer['conflict']) {
    const selection = await this.options.clipboard.snapshot();
    if (!selection) throw new Error('Copy files in a file manager or Setdown first.');
    const result = await this.transfer(state, { kind: selection.external ? 'import' : selection.cut ? 'move' : 'copy', paths: selection.paths, target, conflict });
    await this.options.clipboard.consume(selection, result);
    return result;
  }

  /** Restore a top-level Trash item using its `.trashinfo`, never overwriting an existing file. */
  async restore(state: WindowState, candidate: string): Promise<string> {
    const item = this.paths.entry(undefined, candidate);
    const files = path.dirname(item), trash = path.dirname(files);
    if (path.basename(files) !== 'files') throw new Error('Only items in a Trash folder can be restored.');
    const info = path.join(trash, 'info', `${path.basename(item)}.trashinfo`);
    const text = await fs.readFile(info, 'utf8').catch(() => { throw new Error('This item has no restore information.'); });
    const top = path.basename(trash).startsWith('.Trash') ? path.dirname(trash) : path.parse(trash).root;
    const original = trashInfoPath(text, top);
    if (!original) throw new Error('This item has invalid restore information.');
    this.options.beforeMutation(state, [item]);
    await ensureMissing(original).catch(() => { throw new Error(`“${path.basename(original)}” already exists in ${path.dirname(original)}.`); });
    await fs.mkdir(path.dirname(original), { recursive: true });
    await moveExclusive(item, original);
    await fs.unlink(info).catch(() => {});
    return original;
  }
}
