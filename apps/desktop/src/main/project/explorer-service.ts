import { promises as fs } from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import type { ProjectEntry, ProjectEntryKind, ProjectEntryMove } from '../../protocol/desktop-api';
import type { WindowState } from '../windows/window-state';
import { isOpenableDocument, isMarkdownDocument } from '../../core/document/document-profile';
import { readTextFile } from '../documents/text-file';
import { ProjectPaths } from './project-paths';
import type { ExplorerOperationItem, ExplorerOperationResult, ExplorerTransfer } from '../../protocol/explorer';
import type { LanguageFileOperation } from '../language/file-operations';
import { copyExclusive, copyName, ensureMissing, exists, moveExclusive } from './file-transfer';
const HIDDEN_DIRECTORIES = new Set(['.git', '.hg', '.svn']);

export class ExplorerService {
  languageOperation?: (state: WindowState, operation: LanguageFileOperation, phase: 'will' | 'did') => Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  create = (state: WindowState, parent: string, name: string, kind: ProjectEntryKind) =>
    this.serialize(() => this.createEntry(state, parent, name, kind));
  rename = (state: WindowState, from: string, name: string) => this.serialize(() => this.renameEntry(state, from, name));
  move = (state: WindowState, from: string, target: string) => this.serialize(() => this.moveEntry(state, from, target));
  moveMany = (state: WindowState, paths: string[], target: string) => this.serialize(() => this.moveEntries(state, paths, target));
  trashEntry = (state: WindowState, candidate: string) => this.serialize(async () => {
    const source = this.mutableEntry(state, candidate); this.beforeMutation(state, [source]);
    const operation: LanguageFileOperation = { kind: 'delete', files: [{ path: source, directory: (await fs.lstat(source)).isDirectory() }] };
    await this.languageOperation?.(state, operation, 'will'); await this.trash(source); await this.languageOperation?.(state, operation, 'did');
  });
  transfer = (state: WindowState, request: ExplorerTransfer) => this.serialize(() => this.transferEntries(state, request));
  constructor(private readonly paths: ProjectPaths,
    private readonly trash: (filePath: string) => Promise<void> = (filePath) => shell.trashItem(filePath),
    private readonly beforeMutation: (state: WindowState, paths: string[]) => void = () => {}) {}
  async readDirectory(state: WindowState, candidate: string): Promise<ProjectEntry[]> {
    const directory = this.paths.inside(state, candidate);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => !entry.isSymbolicLink() && !HIDDEN_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.setdown-copy-'))
      .map((entry): ProjectEntry => this.entry(path.join(directory, entry.name), entry.isDirectory()))
      .sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory')
        || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  private async createEntry(state: WindowState, parentPath: string, name: string, kind: ProjectEntryKind): Promise<ProjectEntry> {
    const target = this.paths.child(state, parentPath, name);
    if (kind !== 'directory' && kind !== 'file') throw Error('Unknown project entry kind.');
    await this.ensureMissing(target);
    const operation: LanguageFileOperation = { kind: 'create', files: [{ path: target, directory: kind === 'directory' }] };
    await this.languageOperation?.(state, operation, 'will');
    if (kind === 'directory') await fs.mkdir(target);
    else if (kind === 'file') await fs.writeFile(target, '', { flag: 'wx' });
    else throw new Error('Unknown project entry kind.');
    await this.languageOperation?.(state, operation, 'did');
    return this.entry(target, kind === 'directory');
  }
  private async renameEntry(state: WindowState, entryPath: string, name: string): Promise<ProjectEntryMove> {
    const from = this.mutableEntry(state, entryPath);
    this.beforeMutation(state, [from]);
    const to = this.paths.child(state, path.dirname(from), name);
    if (to === from) return { from, to };
    await this.ensureMissing(to);
    // A new text interpretation must be safe before a Markdown file is renamed.
    if (isMarkdownDocument(from) && !isMarkdownDocument(to) && isOpenableDocument(to)
      && (await fs.stat(from)).isFile()) await readTextFile(from);
    const operation: LanguageFileOperation = { kind: 'rename', files: [{ path: from, to, directory: (await fs.lstat(from)).isDirectory() }] };
    await this.languageOperation?.(state, operation, 'will');
    await moveExclusive(from, to);
    await this.languageOperation?.(state, operation, 'did');
    return { from, to };
  }
  private async moveEntry(state: WindowState, entryPath: string, targetDirectory: string): Promise<ProjectEntryMove> {
    const from = this.mutableEntry(state, entryPath);
    this.beforeMutation(state, [from]);
    const directory = this.paths.inside(state, targetDirectory);
    const stat = await fs.stat(directory).catch(() => null);
    if (!stat?.isDirectory()) throw new Error('The move target is not a folder.');
    if (directory === from || directory.startsWith(`${from}${path.sep}`)) throw new Error('A folder cannot be moved into itself.');
    const to = this.paths.child(state, directory, path.basename(from));
    if (to === from) return { from, to };
    await this.ensureMissing(to);
    const operation: LanguageFileOperation = { kind: 'rename', files: [{ path: from, to, directory: (await fs.lstat(from)).isDirectory() }] };
    await this.languageOperation?.(state, operation, 'will'); await moveExclusive(from, to);
    await this.languageOperation?.(state, operation, 'did');
    return { from, to };
  }
  private async moveEntries(state: WindowState, entryPaths: string[], targetDirectory: string): Promise<{ moves: ProjectEntryMove[]; error?: string }> {
    if (!Array.isArray(entryPaths) || !entryPaths.length || entryPaths.some(item => typeof item !== 'string')) {
      throw new Error('Select files or folders to move.');
    }
    const directory = this.paths.inside(state, targetDirectory);
    if (!(await fs.stat(directory)).isDirectory()) throw new Error('The move target is not a folder.');
    const sources = [...new Set(entryPaths.map(item => this.mutableEntry(state, item)))];
    this.beforeMutation(state, sources);
    const roots = sources.filter(item => !sources.some(parent => parent !== item && item.startsWith(`${parent}${path.sep}`)));
    const planned: ProjectEntryMove[] = [];
    // Validate the entire selection before changing anything. A conflict in the
    // last item must not leave the earlier items moved or overwrite a file.
    for (const from of roots) {
      await fs.lstat(from);
      if (directory === from || directory.startsWith(`${from}${path.sep}`)) throw new Error('A folder cannot be moved into itself.');
      const to = this.paths.child(state, directory, path.basename(from));
      if (to === from) continue;
      if (planned.some(move => move.to === to)) throw new Error(`“${path.basename(to)}” occurs more than once in the selection.`);
      await this.ensureMissing(to);
      planned.push({ from, to });
    }
    const operation: LanguageFileOperation = { kind: 'rename', files: await Promise.all(planned.map(async move => ({ path: move.from, to: move.to, directory: (await fs.lstat(move.from)).isDirectory() }))) };
    await this.languageOperation?.(state, operation, 'will');
    const moves: ProjectEntryMove[] = [];
    for (const move of planned) {
      try {
        await this.ensureMissing(move.to);
        await moveExclusive(move.from, move.to);
        moves.push(move);
        await this.languageOperation?.(state, { ...operation, files: operation.files.filter(file => file.path === move.from) }, 'did');
      } catch (error) {
        // Disk errors after preflight can leave a partial move. Return the exact
        // completed paths so live documents and reading positions stay correct.
        return { moves, error: error instanceof Error ? error.message : String(error) };
      }
    }
    return { moves };
  }
  private async transferEntries(state: WindowState, request: ExplorerTransfer): Promise<ExplorerOperationResult> {
    if (!request || !['copy', 'move', 'duplicate'].includes(request.kind)
      || !Array.isArray(request.paths) || !request.paths.length || request.paths.length > 10000
      || request.paths.some(item => typeof item !== 'string')
      || (request.conflict !== undefined && !['error', 'keep-both', 'skip'].includes(request.conflict))) throw new Error('Invalid file operation.');
    const sources = [...new Set(request.paths.map(item => this.mutableEntry(state, item)))];
    if (request.kind === 'move') this.beforeMutation(state, sources);
    const roots = sources.filter(item => !sources.some(parent => parent !== item && item.startsWith(`${parent}${path.sep}`)));
    const target = request.kind === 'duplicate' ? null : this.paths.inside(state, request.target ?? '');
    if (target && !(await fs.stat(target)).isDirectory()) throw new Error('The target is not a folder.');
    const items: ExplorerOperationItem[] = [];
    const reserved = new Set<string>();
    // A conflict aborts the entire plan before mutation unless the caller explicitly
    // chose Skip or Keep Both. Duplicate and same-folder Copy always allocate names.
    for (const from of roots) {
      const stat = await fs.lstat(from);
      const directory = target ?? path.dirname(from);
      if (directory === from || directory.startsWith(`${from}${path.sep}`)) throw new Error('A folder cannot be copied or moved into itself.');
      let to = path.join(directory, path.basename(from));
      if (to === from && request.kind === 'move') { items.push({ from, to, status: 'skipped' }); continue; }
      const duplicate = request.kind === 'duplicate' || (request.kind === 'copy' && to === from);
      if (duplicate || reserved.has(to) || await exists(to)) {
        if (!duplicate && request.conflict === 'skip') { items.push({ from, to, status: 'skipped' }); continue; }
        if (!duplicate && request.conflict !== 'keep-both') throw new Error(`“${path.basename(to)}” already exists.`);
        let index = 1;
        do { to = path.join(directory, copyName(path.basename(from), stat.isDirectory(), index++)); }
        while (reserved.has(to) || await exists(to));
      }
      reserved.add(to);
      items.push({ from, to, status: 'not-started' });
    }
    const operation: LanguageFileOperation = { kind: request.kind === 'move' ? 'rename' : 'create', files: await Promise.all(items.filter(item => item.status === 'not-started').map(async item => ({ path: request.kind === 'move' ? item.from : item.to, to: request.kind === 'move' ? item.to : undefined, directory: (await fs.lstat(item.from)).isDirectory() }))) };
    await this.languageOperation?.(state, operation, 'will');
    for (const item of items) {
      if (item.status !== 'not-started') continue;
      try {
        if (request.kind === 'move') await moveExclusive(item.from, item.to);
        else await copyExclusive(item.from, item.to);
        item.status = 'completed';
        await this.languageOperation?.(state, { ...operation, files: operation.files.filter(file => file.path === (request.kind === 'move' ? item.from : item.to)) }, 'did');
      } catch (error) {
        item.status = 'failed'; item.error = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    return { kind: request.kind, items, undoable: false };
  }
  private mutableEntry(state: WindowState, candidate: string): string {
    const entryPath = this.paths.entry(state, candidate);
    if (entryPath === this.paths.root(state)) throw new Error('The open folder itself cannot be changed.');
    return entryPath;
  }
  private entry(entryPath: string, directory: boolean): ProjectEntry {
    return { path: entryPath, name: path.basename(entryPath),
      kind: directory ? 'directory' : isOpenableDocument(entryPath) ? 'document' : 'file' };
  }
  private ensureMissing = ensureMissing;
}
