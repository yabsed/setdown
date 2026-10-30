import { emptyNotebook } from '../../core/notebook/notebook-document';
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
import { copyExclusive, copyName, ensureMissing, exists, moveExclusive, treeVersion } from './file-transfer';
const HIDDEN_DIRECTORIES = new Set(['.git', '.hg', '.svn']);

export class ExplorerService {
  languageOperation?: (state: WindowState, operation: LanguageFileOperation, phase: 'will' | 'did') => Promise<void>;
  private readonly active = new Map<number, AbortController>();
  private readonly history = new Map<number, Array<{ kind: ExplorerTransfer['kind']; items: Array<{ from: string; to: string; version: string }> }>>();
  cancel(state: WindowState): void { this.active.get(state.webContentsId)?.abort(new Error('File operation canceled. Completed items were kept.')); }
  private async remember(state: WindowState, result: ExplorerOperationResult): Promise<ExplorerOperationResult> {
    const items = [];
    for (const item of result.items.filter(item => item.status === 'completed')) {
      try { items.push({ from: item.from, to: item.to, version: await treeVersion(item.to) }); }
      catch { result.warning = 'Files were changed, but some destinations could not be recorded for Undo.'; }
    }
    if (items.length) {
      const history = this.history.get(state.webContentsId) ?? [];
      history.push({ kind: result.kind, items }); this.history.set(state.webContentsId, history.slice(-50));
    }
    return { ...result, undoable: items.length > 0 };
  }
  private async undo(state: WindowState): Promise<ExplorerOperationResult> {
    const history = this.history.get(state.webContentsId), record = history?.at(-1);
    if (!record) throw Error('No file operation to undo in this window.');
    for (const item of record.items) {
      this.paths.entry(state, item.to);
      this.beforeMutation(state, [item.to]);
      if (state.rendererTabs?.some(tab => tab.dirty && (tab.path === item.to || tab.path.startsWith(`${item.to}${path.sep}`))))
        throw Error('Save or close edited documents in this selection before undoing the file operation.');
      if (await treeVersion(item.to) !== item.version) throw Error('A destination changed after this operation. Undo stopped to preserve those changes.');
      if (record.kind === 'move') await ensureMissing(item.from);
    }
    const items: ExplorerOperationItem[] = [];
    for (const item of [...record.items].reverse()) {
      try {
        this.beforeMutation(state, [item.to]);
        if (state.rendererTabs?.some(tab => tab.dirty && (tab.path === item.to || tab.path.startsWith(`${item.to}${path.sep}`))))
          throw Error('A document was edited during Undo. Save or close it before trying again.');
        if (await treeVersion(item.to) !== item.version) throw Error('A destination changed during Undo. Its contents were preserved.');
        if (record.kind === 'move') await moveExclusive(item.to, item.from);
        else await this.trash(item.to);
        items.push({ from: item.to, to: record.kind === 'move' ? item.from : item.to, status: 'completed' });
        record.items.splice(record.items.indexOf(item), 1);
      } catch (error) { items.push({ from: item.to, to: item.from, status: 'failed', error: String(error) }); break; }
    }
    if (!record.items.length) history!.pop();
    return { kind: record.kind === 'move' ? 'move' : 'undo', items, undoable: !!history?.length };
  }
  private queue: Promise<unknown> = Promise.resolve();
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private scoped<T>(state: WindowState, operation: (captured: WindowState) => Promise<T>): Promise<T> {
    const root = state.projectRoot;
    const captured = { ...state, get rendererTabs() { return state.rendererTabs; } };
    return this.serialize(() => {
      if (state.projectRoot !== root) throw Error('The open folder changed before the file operation started.');
      return operation(captured);
    });
  }
  create = (state: WindowState, parent: string, name: string, kind: ProjectEntryKind) =>
    this.scoped(state, captured => this.createEntry(captured, parent, name, kind));
  rename = (state: WindowState, from: string, name: string) => this.scoped(state, captured => this.renameEntry(captured, from, name));
  move = (state: WindowState, from: string, target: string) => this.scoped(state, captured => this.moveEntry(captured, from, target));
  moveMany = (state: WindowState, paths: string[], target: string) => this.scoped(state, captured => this.moveEntries(captured, paths, target));
  trashEntry = (state: WindowState, candidate: string) => this.scoped(state, async state => {
    const source = this.mutableEntry(state, candidate); this.beforeMutation(state, [source]);
    const operation: LanguageFileOperation = { kind: 'delete', files: [{ path: source, directory: (await fs.lstat(source)).isDirectory() }] };
    await this.languageOperation?.(state, operation, 'will'); await this.trash(source); await this.did(state, operation);
  });
  transfer = (state: WindowState, request: ExplorerTransfer) => this.scoped(state, async state => {
    if (request.kind === 'undo') return this.undo(state);
    const controller = new AbortController(); this.active.set(state.webContentsId, controller);
    try { return await this.remember(state, await this.transferEntries(state, request, controller.signal)); }
    finally { this.active.delete(state.webContentsId); }
  });
  constructor(private readonly paths: ProjectPaths,
    private readonly trash: (filePath: string) => Promise<void> = (filePath) => shell.trashItem(filePath),
    private readonly beforeMutation: (state: WindowState, paths: string[]) => void = () => {}) {}
  private async did(state: WindowState, operation: LanguageFileOperation): Promise<void> {
    try { await this.languageOperation?.(state, operation, 'did'); }
    catch (error) { console.warn('Files changed, but language-server notification failed.', error); }
  }
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
    else if (kind === 'file') {
      const content = /\.ipynb$/i.test(target) ? emptyNotebook() : '';
      await fs.writeFile(target, content, { flag: 'wx' });
    }
    else throw new Error('Unknown project entry kind.');
    await this.did(state, operation);
    await this.remember(state, { kind: 'copy', items: [{ from: target, to: target, status: 'completed' }], undoable: false });
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
    await this.did(state, operation);
    await this.remember(state, { kind: 'move', items: [{ from, to, status: 'completed' }], undoable: false });
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
    await this.did(state, operation);
    await this.remember(state, { kind: 'move', items: [{ from, to, status: 'completed' }], undoable: false });
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
        await this.did(state, { ...operation, files: operation.files.filter(file => file.path === move.from) });
      } catch (error) {
        // Disk errors after preflight can leave a partial move. Return the exact
        // completed paths so live documents and reading positions stay correct.
        await this.remember(state, { kind: 'move', items: moves.map(move => ({ ...move, status: 'completed' })), undoable: false });
        return { moves, error: error instanceof Error ? error.message : String(error) };
      }
    }
    await this.remember(state, { kind: 'move', items: moves.map(move => ({ ...move, status: 'completed' })), undoable: false });
    return { moves };
  }
  private async transferEntries(state: WindowState, request: ExplorerTransfer, signal?: AbortSignal): Promise<ExplorerOperationResult> {
    if (!request || !['copy', 'move', 'duplicate', 'import'].includes(request.kind)
      || !Array.isArray(request.paths) || !request.paths.length || request.paths.length > 10000
      || request.paths.some(item => typeof item !== 'string')
      || (request.conflict !== undefined && !['error', 'keep-both', 'skip'].includes(request.conflict))) throw new Error('Invalid file operation.');
    const sources = [...new Set(request.paths.map(item => {
      if (request.kind !== 'import') return this.mutableEntry(state, item);
      if (!path.isAbsolute(item) || item.includes('\0')) throw new Error('Invalid imported file path.');
      return path.resolve(item);
    }))];
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
        signal?.throwIfAborted();
        state.window?.webContents.send('explorer:progress', { completed: items.filter(item => item.status === 'completed').length, total: items.length, path: item.from });
        if (request.kind === 'move') await moveExclusive(item.from, item.to, signal);
        else await copyExclusive(item.from, item.to, signal);
        item.status = 'completed';
        await this.did(state, { ...operation, files: operation.files.filter(file => file.path === (request.kind === 'move' ? item.from : item.to)) });
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
