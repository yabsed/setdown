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
    if (await fs.stat(candidate).catch(() => null)) throw new Error(`“${path.basename(candidate)}” already exists.`);
  }
}
