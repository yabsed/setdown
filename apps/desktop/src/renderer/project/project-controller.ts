import type {
  ProjectEntry,
  ProjectFolder,
  ProjectSearchDocument,
  ProjectSearchResult,
} from '../../protocol/desktop-api';
import type { DesktopPort } from '../ports/desktop-port';
import {
  project,
  rememberProjectState,
  type ProjectView,
  type VisibleProjectEntry,
} from './project-state.svelte';

type SearchTarget = Pick<
  ProjectSearchResult,
  'surface' | 'line' | 'column' | 'lineOccurrence' | 'ordinal'
>;

type Options = {
  desktop: DesktopPort;
  searchDocuments(): ProjectSearchDocument[];
  showDocument(path: string): Promise<boolean>;
  highlight(query: string, target?: SearchTarget): void;
  resized(): void;
};

export class ProjectController {
  private readonly children = new Map<string, ProjectEntry[]>();
  private readonly expanded = new Set<string>();
  private searchTimer?: number;
  private searchRequest = 0;

  constructor(private readonly options: Options) {
    for (const path of project.expanded) this.expanded.add(path);
  }

  toggle = () => {
    project.visible = !project.visible;
    rememberProjectState();
    this.highlight();
    this.resize();
  };

  select = (view: ProjectView) => {
    if (project.open && project.activeView === view) {
      project.open = false;
      rememberProjectState();
      this.highlight();
      return this.resize();
    }
    project.visible = true;
    project.open = true;
    project.activeView = view;
    project.error = '';
    rememberProjectState();
    if (view === 'git') void this.refreshGit();
    this.highlight();
    this.resize();
  };

  chooseFolder = async () => {
    const folder = await this.options.desktop.chooseProjectFolder();
    if (!folder) return;
    await this.replaceFolder(folder);
  };

  openFolderPath = async (folderPath: string) => {
    const folder = await this.options.desktop.restoreProjectFolder(folderPath);
    if (!folder) {
      project.error = 'Drop a folder to open it.';
      return;
    }
    await this.replaceFolder(folder);
  };

  private async replaceFolder(folder: ProjectFolder) {
    project.folder = folder;
    project.visible = true;
    project.open = true;
    project.activeView = 'explorer';
    project.searchQuery = '';
    project.searchResults = [];
    project.git = null;
    this.options.highlight('');
    void this.options.desktop.searchProject({ query: '', documents: [] });
    this.children.clear();
    this.expanded.clear();
    rememberProjectState();
    await this.load(folder.path);
    this.resize();
  }

  restore = async () => {
    const remembered = project.folder;
    const folder = await this.options.desktop.getProjectFolder()
      ?? (remembered ? await this.options.desktop.restoreProjectFolder(remembered.path) : null);
    if (!folder) {
      project.folder = null;
      rememberProjectState();
      return;
    }
    project.folder = folder;
    rememberProjectState();
    await this.load(folder.path);
    for (const directoryPath of [...this.expanded]) {
      if (directoryPath !== folder.path) await this.load(directoryPath);
    }
    if (project.activeView === 'git') await this.refreshGit();
    this.resize();
  };

  refreshExplorer = async () => {
    if (!project.folder) return;
    this.children.clear();
    this.expanded.clear();
    await this.load(project.folder.path);
  };

  toggleDirectory = async (directoryPath: string) => {
    if (this.expanded.delete(directoryPath)) return this.renderEntries();
    this.expanded.add(directoryPath);
    this.renderEntries();
    if (!this.children.has(directoryPath)) await this.load(directoryPath);
  };

  openFile = async (filePath: string): Promise<boolean> => {
    try {
      project.error = '';
      return await this.options.showDocument(filePath);
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  };

  openSearchResult = async (result: ProjectSearchResult) => {
    if (await this.openFile(result.path)) this.options.highlight(project.searchQuery.trim(), result);
  };

  search = (query: string) => {
    project.searchQuery = query;
    this.highlight();
    window.clearTimeout(this.searchTimer);
    if (!query.trim() || !project.folder) {
      project.searchResults = [];
      project.searching = false;
      if (project.folder) void this.options.desktop.searchProject({ query: '', documents: [] });
      return;
    }
    project.searching = true;
    this.searchTimer = window.setTimeout(() => void this.runSearch(query), 200);
  };

  contextChanged = () => {
    if (project.searchQuery.trim()) this.search(project.searchQuery);
  };

  refreshGit = async () => {
    if (!project.folder || project.gitLoading) return;
    project.gitLoading = true;
    project.error = '';
    try {
      project.git = await this.options.desktop.getGitStatus();
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
    } finally {
      project.gitLoading = false;
    }
  };

  private async load(directoryPath: string) {
    project.error = '';
    try {
      this.children.set(directoryPath, await this.options.desktop.readProjectDirectory(directoryPath));
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
      this.expanded.delete(directoryPath);
    }
    this.renderEntries();
  }

  private async runSearch(query: string) {
    const request = ++this.searchRequest;
    try {
      const results = await this.options.desktop.searchProject({
        query,
        documents: this.options.searchDocuments(),
      });
      if (request === this.searchRequest && query === project.searchQuery) {
        project.searchResults = results;
        project.error = '';
      }
    } catch (error) {
      if (request === this.searchRequest) {
        project.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (request === this.searchRequest) project.searching = false;
    }
  }

  private renderEntries() {
    const visible: VisibleProjectEntry[] = [];
    const append = (directoryPath: string, depth: number) => {
      for (const entry of this.children.get(directoryPath) ?? []) {
        const expanded = entry.kind === 'directory' && this.expanded.has(entry.path);
        visible.push({
          ...entry,
          depth,
          expanded,
          loading: expanded && !this.children.has(entry.path),
        });
        if (expanded) append(entry.path, depth + 1);
      }
    };
    if (project.folder) append(project.folder.path, 0);
    project.entries = visible;
    project.expanded = [...this.expanded];
    rememberProjectState();
  }

  private resize() {
    window.requestAnimationFrame(this.options.resized);
  }

  private highlight() {
    this.options.highlight(project.visible && project.open && project.activeView === 'search'
      ? project.searchQuery.trim() : '');
  }
}
