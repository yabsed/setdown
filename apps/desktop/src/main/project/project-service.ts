import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { dialog } from 'electron';
import type {
  GitChange,
  GitSnapshot,
  ProjectEntry,
  ProjectFolder,
  ProjectSearchResult,
} from '../../protocol/desktop-api';
import { canonicalPath, isInside } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';

const exec = promisify(execFile);
const DOCUMENT = /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i;
const HIDDEN_DIRECTORIES = new Set(['.git', '.hg', '.svn']);
const SEARCH_DIRECTORIES = new Set([...HIDDEN_DIRECTORIES, 'node_modules']);
const MAX_RESULTS = 300;
const MAX_FILE_SIZE = 2_000_000;

export const isMarkdownDocument = (filePath: string) => DOCUMENT.test(filePath);

export function parseGitStatus(output: string): GitChange[] {
  return output.split(/\r?\n/).flatMap((line) => {
    if (line.length < 4) return [];
    const code = line.slice(0, 2);
    const renamed = line.slice(3).split(' -> ').at(-1) ?? '';
    return [{
      path: renamed.replace(/^"|"$/g, ''),
      filePath: '',
      status: code.trim() || '?',
      staged: code[0] !== ' ' && code[0] !== '?',
    }];
  });
}

export class ProjectService {
  private readonly searches = new Map<number, number>();

  async choose(state: WindowState): Promise<ProjectFolder | null> {
    const selected = await dialog.showOpenDialog(state.window, {
      title: 'Open Folder',
      properties: ['openDirectory'],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    state.projectRoot = canonicalPath(selected.filePaths[0]);
    return this.folder(state.projectRoot);
  }

  current(state: WindowState): ProjectFolder | null {
    return state.projectRoot ? this.folder(state.projectRoot) : null;
  }

  async restore(state: WindowState, candidate: string): Promise<ProjectFolder | null> {
    const folderPath = canonicalPath(candidate);
    const stat = await fs.stat(folderPath).catch(() => null);
    if (!stat?.isDirectory()) return null;
    state.projectRoot = folderPath;
    return this.folder(folderPath);
  }

  async readDirectory(state: WindowState, candidate: string): Promise<ProjectEntry[]> {
    const directory = this.inside(state, candidate);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.isSymbolicLink() && !HIDDEN_DIRECTORIES.has(entry.name))
      .map((entry): ProjectEntry => {
        const entryPath = path.join(directory, entry.name);
        return {
          path: entryPath,
          name: entry.name,
          kind: entry.isDirectory()
            ? 'directory'
            : isMarkdownDocument(entry.name) ? 'document' : 'file',
        };
      })
      .sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory')
        || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  async search(state: WindowState, rawQuery: string): Promise<ProjectSearchResult[]> {
    const root = this.root(state);
    const request = (this.searches.get(state.webContentsId) ?? 0) + 1;
    this.searches.set(state.webContentsId, request);
    const query = rawQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    const results: ProjectSearchResult[] = [];
    await this.walk(root, async (filePath) => {
      if (results.length >= MAX_RESULTS || !isMarkdownDocument(filePath)) return;
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_FILE_SIZE) return;
      const text = await fs.readFile(filePath, 'utf8').catch(() => '');
      const lines = text.split(/\r\n|\r|\n/);
      let ordinal = 0;
      for (let index = 0; index < lines.length && results.length < MAX_RESULTS; index += 1) {
        const line = lines[index];
        const folded = line.toLocaleLowerCase();
        let lineOccurrence = 0;
        for (let match = folded.indexOf(query); match >= 0 && results.length < MAX_RESULTS;
          match = folded.indexOf(query, match + query.length)) {
          const start = Math.max(0, match - 60);
          const end = Math.min(line.length, match + query.length + 120);
          results.push({
            path: filePath,
            name: path.basename(filePath),
            relativePath: path.relative(root, filePath),
            line: index + 1,
            column: match + 1,
            lineOccurrence: lineOccurrence++,
            ordinal: ordinal++,
            preview: `${start ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`,
          });
        }
      }
    }, () => this.searches.get(state.webContentsId) !== request || results.length >= MAX_RESULTS);
    return results;
  }

  async gitStatus(state: WindowState): Promise<GitSnapshot> {
    const root = this.root(state);
    try {
      const [{ stdout: branch }, { stdout: status }] = await Promise.all([
        exec('git', ['-C', root, 'branch', '--show-current'], { timeout: 5000 }),
        exec('git', ['-C', root, 'status', '--short', '--untracked-files=all', '--', '.'], {
          timeout: 5000,
          maxBuffer: 2_000_000,
        }),
      ]);
      return {
        repository: true,
        branch: branch.trim() || 'HEAD',
        changes: parseGitStatus(status).map((change) => ({
          ...change,
          filePath: path.join(root, change.path),
        })),
      };
    } catch {
      return { repository: false, branch: '', changes: [] };
    }
  }

  assertDocument(state: WindowState, candidate: string): string {
    const filePath = this.inside(state, candidate);
    if (!isMarkdownDocument(filePath)) throw new Error('Setdown opens Markdown documents only.');
    return filePath;
  }

  private folder(root: string): ProjectFolder {
    return { path: root, name: path.basename(root) || root };
  }

  private root(state: WindowState): string {
    if (!state.projectRoot) throw new Error('No folder is open.');
    return state.projectRoot;
  }

  private inside(state: WindowState, candidate: string): string {
    const root = this.root(state);
    const resolved = canonicalPath(candidate);
    if (!isInside(root, resolved)) throw new Error('The path is outside the open folder.');
    return resolved;
  }

  private async walk(
    directory: string,
    visit: (filePath: string) => Promise<void>,
    stopped: () => boolean,
  ): Promise<void> {
    if (stopped()) return;
    if (directory !== path.parse(directory).root && SEARCH_DIRECTORIES.has(path.basename(directory))) return;
    const entries = await fs.readdir(directory, { withFileTypes: true })
      .then((items) => items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })))
      .catch(() => []);
    for (const entry of entries) {
      if (stopped()) return;
      if (entry.isSymbolicLink() || SEARCH_DIRECTORIES.has(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await this.walk(entryPath, visit, stopped);
      else await visit(entryPath);
    }
  }
}
