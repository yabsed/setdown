import type { ProjectSearchDocument, ProjectSearchResult } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project, rememberProjectState } from '../project-state.svelte';
import { searchScope } from './search-scope.svelte';
type SearchTarget = Pick<ProjectSearchResult, 'surface' | 'line' | 'column' | 'lineOccurrence' | 'ordinal'>;
type Options = {
  desktop: DesktopPort; documents(query: string): ProjectSearchDocument[];
  open(path: string): Promise<boolean>; highlight(query: string, target?: SearchTarget): void;
};
export class SearchController {
  private timer?: number;
  private request = 0;
  constructor(private readonly options: Options) {}
  search = (query: string): void => {
    const request = ++this.request;
    if (query !== project.searchQuery) project.expandedSearchGroups = [];
    project.searchQuery = query;
    rememberProjectState(); this.highlight(); window.clearTimeout(this.timer);
    if (!query.trim() || !project.folder) {
      project.searchResults = []; project.searching = false;
      if (project.folder) void this.options.desktop.searchProject({ query: '', documents: [] });
      return;
    }
    project.searching = true;
    this.timer = window.setTimeout(() => void this.run(query, request), 200);
  };
  open = async (result: ProjectSearchResult): Promise<void> => {
    if (await this.options.open(result.path)) this.options.highlight(project.searchQuery.trim(), result);
  };
  contextChanged = (): void => { if (project.searchQuery.trim()) this.search(project.searchQuery); };
  restore = (): void => {
    if (!project.searchQuery.trim() || !project.folder) return;
    project.searching = true; this.highlight(); void this.run(project.searchQuery, ++this.request);
  };
  toggleGroup = (path: string): void => {
    project.expandedSearchGroups = project.expandedSearchGroups.includes(path)
      ? project.expandedSearchGroups.filter((candidate) => candidate !== path) : [...project.expandedSearchGroups, path];
    rememberProjectState();
  };
  highlight = (): void => {
    this.options.highlight(project.visible && project.open && project.activeView === 'search' ? project.searchQuery.trim() : '');
  };
  clear = (): void => {
    ++this.request; window.clearTimeout(this.timer);
    project.searchQuery = ''; project.searchResults = []; project.expandedSearchGroups = []; project.searching = false;
    rememberProjectState(); this.options.highlight('');
    void this.options.desktop.searchProject({ query: '', documents: [] });
  };
  private async run(query: string, request: number): Promise<void> {
    const root = project.folder?.path;
    const scope = searchScope.value;
    const current = () => request === this.request && query === project.searchQuery
      && root === project.folder?.path && scope === searchScope.value;
    try {
      const payload = { query, documents: this.options.documents(query), scope };
      const results = await this.options.desktop.searchProject(payload);
      if (current()) { project.searchResults = results; project.error = ''; }
    } catch (error) {
      if (current()) project.error = error instanceof Error ? error.message : String(error);
    } finally { if (current()) project.searching = false; }
  }
}
