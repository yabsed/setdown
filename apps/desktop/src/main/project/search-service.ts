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
import { RipgrepFiles } from './engines/ripgrep-files';

const MAX_RESULTS = 300;
const MAX_FILE_SIZE = 2_000_000;

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
    private readonly files = new RipgrepFiles(),
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
          ? [[documentPath, {
            text: document.text,
            surface: document.surface,
            matches: Array.isArray(document.matches) ? document.matches : [],
          }] as const] : [];
      }));
    const results: ProjectSearchResult[] = [];
    for (const filePath of await this.files.markdown(root)) {
      if (this.searches.get(state.webContentsId) !== sequence || results.length >= MAX_RESULTS) break;
      if (results.length >= MAX_RESULTS || !isMarkdownDocument(filePath)) continue;
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_FILE_SIZE) continue;
      const open = openDocuments.get(canonicalPath(filePath));
      const text = open?.text ?? await fs.readFile(filePath, 'utf8').catch(() => '');
      const surface = open?.surface ?? 'viewer';
      const remaining = MAX_RESULTS - results.length;
      const matches = surface === 'editor'
        ? (open?.matches ?? []).slice(0, remaining)
        : await this.searchVisible(filePath, text, query, remaining, root).catch(() => []);
      results.push(...matches.map((match) => ({
        path: filePath,
        name: path.basename(filePath),
        relativePath: path.relative(root, filePath),
        surface,
        ...match,
      })));
    }
    return results;
  }
}
