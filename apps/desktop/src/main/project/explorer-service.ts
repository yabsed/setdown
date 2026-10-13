import { promises as fs } from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import type { ProjectEntry, ProjectEntryKind, ProjectEntryMove } from '../../protocol/desktop-api';
import type { WindowState } from '../windows/window-state';
import { isOpenableDocument, isMarkdownDocument } from '../../core/document/document-profile';
import { readTextFile } from '../documents/text-file';
import { ProjectPaths } from './project-paths';
const HIDDEN_DIRECTORIES = new Set(['.git', '.hg', '.svn']);

export class ExplorerService {
  constructor(private readonly paths: ProjectPaths,
    private readonly trash: (filePath: string) => Promise<void> = (filePath) => shell.trashItem(filePath)) {}
  async readDirectory(state: WindowState, candidate: string): Promise<ProjectEntry[]> {
    const directory = this.paths.inside(state, candidate);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => !entry.isSymbolicLink() && !HIDDEN_DIRECTORIES.has(entry.name))
      .map((entry): ProjectEntry => this.entry(path.join(directory, entry.name), entry.isDirectory()))
      .sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory')
        || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  async create(state: WindowState, parentPath: string, name: string, kind: ProjectEntryKind): Promise<ProjectEntry> {
    const target = this.paths.child(state, parentPath, name);
    if (kind === 'directory') await fs.mkdir(target);
    else if (kind === 'file') await fs.writeFile(target, '', { flag: 'wx' });
    else throw new Error('Unknown project entry kind.');
    return this.entry(target, kind === 'directory');
  }
  async rename(state: WindowState, entryPath: string, name: string): Promise<ProjectEntryMove> {
    const from = this.mutableEntry(state, entryPath);
    const to = this.paths.child(state, path.dirname(from), name);
    if (to === from) return { from, to };
    await this.ensureMissing(to);
    // A new text interpretation must be safe before a Markdown file is renamed.
    if (isMarkdownDocument(from) && !isMarkdownDocument(to) && isOpenableDocument(to)
      && (await fs.stat(from)).isFile()) await readTextFile(from);
    await fs.rename(from, to);
    return { from, to };
  }
  async move(state: WindowState, entryPath: string, targetDirectory: string): Promise<ProjectEntryMove> {
    const from = this.mutableEntry(state, entryPath);
    const directory = this.paths.inside(state, targetDirectory);
    const stat = await fs.stat(directory).catch(() => null);
    if (!stat?.isDirectory()) throw new Error('The move target is not a folder.');
    if (directory === from || directory.startsWith(`${from}${path.sep}`)) throw new Error('A folder cannot be moved into itself.');
    const to = this.paths.child(state, directory, path.basename(from));
    if (to === from) return { from, to };
    await this.ensureMissing(to); await fs.rename(from, to);
    return { from, to };
  }
  async moveMany(state: WindowState, entryPaths: string[], targetDirectory: string): Promise<{ moves: ProjectEntryMove[]; error?: string }> {
    if (!Array.isArray(entryPaths) || !entryPaths.length || entryPaths.some(item => typeof item !== 'string')) {
      throw new Error('Select files or folders to move.');
    }
    const directory = this.paths.inside(state, targetDirectory);
    if (!(await fs.stat(directory)).isDirectory()) throw new Error('The move target is not a folder.');
    const sources = [...new Set(entryPaths.map(item => this.mutableEntry(state, item)))];
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
    const moves: ProjectEntryMove[] = [];
    for (const move of planned) {
      try {
        await this.ensureMissing(move.to);
        await fs.rename(move.from, move.to);
        moves.push(move);
      } catch (error) {
        // Disk errors after preflight can leave a partial move. Return the exact
        // completed paths so live documents and reading positions stay correct.
        return { moves, error: error instanceof Error ? error.message : String(error) };
      }
    }
    return { moves };
  }
  async trashEntry(state: WindowState, entryPath: string): Promise<void> { await this.trash(this.mutableEntry(state, entryPath)); }
  private mutableEntry(state: WindowState, candidate: string): string {
    const entryPath = this.paths.inside(state, candidate);
    if (entryPath === this.paths.root(state)) throw new Error('The open folder itself cannot be changed.');
    return entryPath;
  }
  private entry(entryPath: string, directory: boolean): ProjectEntry {
    return { path: entryPath, name: path.basename(entryPath),
      kind: directory ? 'directory' : isOpenableDocument(entryPath) ? 'document' : 'file' };
  }
  private async ensureMissing(candidate: string): Promise<void> {
    const existing = await fs.lstat(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existing) throw new Error(`“${path.basename(candidate)}” already exists.`);
  }
}
