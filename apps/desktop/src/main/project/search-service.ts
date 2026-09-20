import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProjectSearchRequest, ProjectSearchResult } from '../../protocol/desktop-api';
import { isTextCandidate } from '../../core/document/document-profile';
import { searchSource } from '../../core/search/source-search';
import { canonicalPath, isInside } from '../documents/file-system';
import { readTextFile } from '../documents/text-file';
import type { WindowState } from '../windows/window-state';
import type { VisibleSearchMatch } from './visible-search';
import { isMarkdownDocument, ProjectPaths } from './project-paths';
import { RipgrepFiles } from './engines/ripgrep-files';
const MAX_RESULTS = 300;
const MAX_FILE_SIZE = 2_000_000;
export type ScopedSearchRequest = ProjectSearchRequest & { scope?: 'markdown' | 'text' };

export class SearchService {
  private readonly searches = new Map<number, number>();
  constructor(private readonly paths: ProjectPaths,
    private readonly searchVisible: (documentPath: string, text: string, query: string, limit: number, root: string) => Promise<VisibleSearchMatch[]>,
    private readonly files = new RipgrepFiles()) {}
  async search(state: WindowState, request: ScopedSearchRequest): Promise<ProjectSearchResult[]> {
    const root = this.paths.root(state);
    const sequence = (this.searches.get(state.webContentsId) ?? 0) + 1;
    this.searches.set(state.webContentsId, sequence);
    const current = () => this.searches.get(state.webContentsId) === sequence && state.projectRoot === root;
    const query = String(request?.query ?? '').trim().slice(0, 512);
    if (!query) return [];
    const allText = request?.scope === 'text';
    const eligible = (filePath: string) => isMarkdownDocument(filePath) || (allText && isTextCandidate(filePath));
    const openDocuments = new Map((Array.isArray(request?.documents) ? request.documents : []).flatMap((document) => {
      if (!document || typeof document.path !== 'string' || typeof document.text !== 'string'
        || !['viewer', 'editor'].includes(document.surface)) return [];
      const documentPath = canonicalPath(document.path);
      return isInside(root, documentPath) && eligible(documentPath) ? [[documentPath, {
        text: document.text, surface: document.surface, matches: Array.isArray(document.matches) ? document.matches : [],
      }] as const] : [];
    }));
    const listed = allText ? await this.files.text(root) : await this.files.markdown(root);
    if (!current()) return [];
    const candidates = allText ? [...new Set([...listed, ...openDocuments.keys()])] : listed;
    const results: ProjectSearchResult[] = [];
    let inspected = 0;
    for (const candidate of candidates) {
      if (!current()) return [];
      if (results.length >= MAX_RESULTS || (allText && ++inspected > 25_000)) break;
      let filePath: string;
      try { filePath = this.paths.inside(state, candidate); } catch { continue; }
      if (!eligible(filePath)) continue;
      const markdown = isMarkdownDocument(filePath);
      const open = openDocuments.get(filePath);
      let text: string;
      if (open && !markdown) {
        if (open.text.length > MAX_FILE_SIZE) continue;
        text = open.text;
      } else if (markdown) {
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile() || stat.size > MAX_FILE_SIZE) continue;
        text = open?.text ?? await fs.readFile(filePath, 'utf8').catch(() => '');
      } else {
        try { text = (await readTextFile(filePath, MAX_FILE_SIZE)).text; } catch { continue; }
      }
      if (!current()) return [];
      const surface = markdown ? open?.surface ?? 'viewer' : 'editor';
      const remaining = MAX_RESULTS - results.length;
      const matches = !markdown ? searchSource(text, query, remaining)
        : surface === 'editor' ? (open?.matches ?? []).slice(0, remaining)
          : await this.searchVisible(filePath, text, query, remaining, root).catch(() => []);
      if (!current()) return [];
      results.push(...matches.map((match) => ({ path: filePath, name: path.basename(filePath),
        relativePath: path.relative(root, filePath), surface, ...match })));
    }
    return current() ? results : [];
  }
}
