import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ProjectSearchRequest,
  ProjectSearchResult,
} from '../../protocol/desktop-api';
import { canonicalPath, isInside } from '../documents/file-system';
import type { WindowState } from '../windows/window-state';
import type { VisibleSearchMatch } from './visible-search';
import { isMarkdownDocument, ProjectPaths } from './project-paths';

const SEARCH_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules']);
const MAX_RESULTS = 300;
const MAX_FILE_SIZE = 2_000_000;

export function searchSourceText(
  text: string,
  rawQuery: string,
  limit = MAX_RESULTS,
): VisibleSearchMatch[] {
  const query = rawQuery.toLocaleLowerCase();
  if (!query || limit <= 0) return [];
  const results: VisibleSearchMatch[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  let ordinal = 0;
  for (let index = 0; index < lines.length && results.length < limit; index += 1) {
    const line = lines[index];
    const folded = line.toLocaleLowerCase();
    let lineOccurrence = 0;
    for (let match = folded.indexOf(query); match >= 0 && results.length < limit;
      match = folded.indexOf(query, match + query.length)) {
      const start = Math.max(0, match - 60);
      const end = Math.min(line.length, match + query.length + 120);
      results.push({
        line: index + 1,
        column: match + 1,
        lineOccurrence: lineOccurrence++,
        ordinal: ordinal++,
        preview: `${start ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`,
      });
    }
  }
  return results;
}

export class SearchService {
  private readonly searches = new Map<number, number>();

  constructor(
    private readonly paths: ProjectPaths,
    private readonly searchVisible: (
      documentPath: string,
      text: string,
      query: string,
      limit: number,
      root: string,
    ) => Promise<VisibleSearchMatch[]>,
  ) {}

  async search(state: WindowState, request: ProjectSearchRequest): Promise<ProjectSearchResult[]> {
    const root = this.paths.root(state);
    const sequence = (this.searches.get(state.webContentsId) ?? 0) + 1;
    this.searches.set(state.webContentsId, sequence);
    const query = String(request?.query ?? '').trim();
    if (!query) return [];
    const openDocuments = new Map((Array.isArray(request?.documents) ? request.documents : [])
      .flatMap((document) => {
        if (!document || typeof document.path !== 'string' || typeof document.text !== 'string'
          || !['viewer', 'editor'].includes(document.surface)) return [];
        const documentPath = canonicalPath(document.path);
        return isInside(root, documentPath) && isMarkdownDocument(documentPath)
          ? [[documentPath, { text: document.text, surface: document.surface }] as const] : [];
      }));
    const results: ProjectSearchResult[] = [];
    await this.walk(root, async (filePath) => {
      if (results.length >= MAX_RESULTS || !isMarkdownDocument(filePath)) return;
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_FILE_SIZE) return;
      const open = openDocuments.get(canonicalPath(filePath));
      const text = open?.text ?? await fs.readFile(filePath, 'utf8').catch(() => '');
      const surface = open?.surface ?? 'viewer';
      const remaining = MAX_RESULTS - results.length;
      const matches = surface === 'editor'
        ? searchSourceText(text, query, remaining)
        : await this.searchVisible(filePath, text, query, remaining, root).catch(() => []);
      results.push(...matches.map((match) => ({
        path: filePath,
        name: path.basename(filePath),
        relativePath: path.relative(root, filePath),
        surface,
        ...match,
      })));
    }, () => this.searches.get(state.webContentsId) !== sequence || results.length >= MAX_RESULTS);
    return results;
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
