import type { ProjectSearchDocument, ProjectSearchResult } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project } from '../project-state.svelte';

type SearchTarget = Pick<
  ProjectSearchResult,
  'surface' | 'line' | 'column' | 'lineOccurrence' | 'ordinal'
>;

type Options = {
  desktop: DesktopPort;
  documents(): ProjectSearchDocument[];
  open(path: string): Promise<boolean>;
  highlight(query: string, target?: SearchTarget): void;
};

export class SearchController {
  private timer?: number;
  private request = 0;

  constructor(private readonly options: Options) {}

  search = (query: string): void => {
    project.searchQuery = query;
    this.highlight();
    window.clearTimeout(this.timer);
    if (!query.trim() || !project.folder) {
      project.searchResults = [];
      project.searching = false;
      if (project.folder) void this.options.desktop.searchProject({ query: '', documents: [] });
      return;
    }
    project.searching = true;
    this.timer = window.setTimeout(() => void this.run(query), 200);
  };

  open = async (result: ProjectSearchResult): Promise<void> => {
    if (await this.options.open(result.path)) this.options.highlight(project.searchQuery.trim(), result);
  };

  contextChanged = (): void => {
    if (project.searchQuery.trim()) this.search(project.searchQuery);
  };

  highlight = (): void => {
    this.options.highlight(project.visible && project.open && project.activeView === 'search'
      ? project.searchQuery.trim() : '');
  };

  clear = (): void => {
    project.searchQuery = '';
    project.searchResults = [];
    project.searching = false;
    this.options.highlight('');
    void this.options.desktop.searchProject({ query: '', documents: [] });
  };

  private async run(query: string): Promise<void> {
    const request = ++this.request;
    try {
      const results = await this.options.desktop.searchProject({
        query,
        documents: this.options.documents(),
      });
      if (request === this.request && query === project.searchQuery) {
        project.searchResults = results;
        project.error = '';
      }
    } catch (error) {
      if (request === this.request) project.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (request === this.request) project.searching = false;
    }
  }
}
