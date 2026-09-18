import type {
  GitRemoteAction,
  ProjectEntryKind,
  ProjectFolder,
  ProjectSearchDocument,
  ProjectSearchResult,
} from '../../protocol/desktop-api';
import type { DesktopPort } from '../ports/desktop-port';
import { ExplorerController } from './explorer/explorer-controller';
import { project, rememberProjectState, type ProjectView } from './project-state.svelte';
import { SearchController } from './search/search-controller';
import { SourceControlController } from './source-control/source-control-controller';

type SearchTarget = Pick<
  ProjectSearchResult,
  'surface' | 'line' | 'column' | 'lineOccurrence' | 'ordinal'
>;

type Options = {
  desktop: DesktopPort;
  searchDocuments(query: string): ProjectSearchDocument[];
  showDocument(path: string): Promise<boolean>;
  highlight(query: string, target?: SearchTarget): void;
  pathMoved(from: string, to: string): Promise<void>;
  prepareRemove(path: string): Promise<boolean>;
  resized(): void;
};

/** Project composition facade. Feature controllers own Explorer, Search, and Git behavior. */
export class ProjectController {
  private readonly explorer: ExplorerController;
  private readonly searcher: SearchController;
  private readonly sourceControl: SourceControlController;
  private changeTimer?: number;

  constructor(private readonly options: Options) {
    this.explorer = new ExplorerController({
      desktop: options.desktop,
      showDocument: options.showDocument,
      pathMoved: options.pathMoved,
      prepareRemove: options.prepareRemove,
    });
    this.searcher = new SearchController({
      desktop: options.desktop,
      documents: options.searchDocuments,
      open: this.explorer.open,
      highlight: options.highlight,
    });
    this.sourceControl = new SourceControlController(options.desktop);
  }

  toggle = (): void => {
    project.visible = !project.visible;
    rememberProjectState();
    this.searcher.highlight();
    this.resize();
  };

  select = (view: ProjectView): void => {
    if (project.open && project.activeView === view) {
      project.open = false;
      rememberProjectState();
      this.searcher.highlight();
      return this.resize();
    }
    project.visible = true;
    project.open = true;
    project.activeView = view;
    project.error = '';
    rememberProjectState();
    if (view === 'git') void this.sourceControl.refresh();
    this.searcher.highlight();
    this.resize();
  };

  chooseFolder = async (): Promise<void> => {
    const folder = await this.options.desktop.chooseProjectFolder();
    if (folder) await this.replaceFolder(folder);
  };

  openFolderPath = async (folderPath: string): Promise<void> => {
    const folder = await this.options.desktop.restoreProjectFolder(folderPath);
    if (!folder) {
      project.error = 'Drop a folder to open it.';
      return;
    }
    await this.replaceFolder(folder);
  };

  restore = async (): Promise<void> => {
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
    await this.explorer.restore(folder);
    this.searcher.restore();
    if (project.activeView === 'git') await this.sourceControl.refresh();
    this.resize();
  };

  refreshExplorer = (): Promise<void> => this.explorer.refresh();
  collapseExplorer = (): void => this.explorer.collapse();
  toggleDirectory = (path: string): Promise<void> => this.explorer.toggle(path);
  openFile = (path: string): Promise<boolean> => this.explorer.open(path);
  createEntry = (parent: string, name: string, kind: ProjectEntryKind): Promise<void> =>
    this.explorer.create(parent, name, kind);
  renameEntry = (path: string, name: string): Promise<void> => this.explorer.rename(path, name);
  moveEntry = (path: string, target: string): Promise<void> => this.explorer.move(path, target);
  trashEntry = (path: string): Promise<void> => this.explorer.trash(path);

  openSearchResult = (result: ProjectSearchResult): Promise<void> => this.searcher.open(result);
  search = (query: string): void => this.searcher.search(query);
  toggleSearchGroup = (path: string): void => this.searcher.toggleGroup(path);
  contextChanged = (): void => this.searcher.contextChanged();

  filesChanged = (root: string): void => {
    if (root !== project.folder?.path) return;
    window.clearTimeout(this.changeTimer);
    this.changeTimer = window.setTimeout(() => void this.refreshChangedProject(), 120);
  };

  refreshGit = (): Promise<void> => this.sourceControl.refresh();
  reviewGitChange = (path: string, staged: boolean): Promise<void> =>
    this.sourceControl.review(path, staged);
  closeGitDiff = (): void => this.sourceControl.closeDiff();
  initializeGit = (): Promise<void> => this.sourceControl.initialize();
  stageGit = (paths: string[]): Promise<void> => this.sourceControl.stage(paths);
  unstageGit = (paths: string[]): Promise<void> => this.sourceControl.unstage(paths);
  discardGit = async (paths: string[]): Promise<void> => {
    await this.sourceControl.discard(paths);
    await this.explorer.refresh();
  };
  commitGit = (message: string): Promise<void> => this.sourceControl.commit(message);
  runGitRemote = async (action: GitRemoteAction): Promise<void> => {
    await this.sourceControl.remote(action);
    if (action !== 'fetch') await this.explorer.refresh();
  };

  private async replaceFolder(folder: ProjectFolder): Promise<void> {
    project.folder = folder;
    project.visible = true;
    project.open = true;
    project.activeView = 'explorer';
    this.searcher.clear();
    this.sourceControl.clear();
    rememberProjectState();
    await this.explorer.reset(folder);
    this.resize();
  }

  private async refreshChangedProject(): Promise<void> {
    await this.explorer.refresh();
    if (project.searchQuery.trim()) this.searcher.contextChanged();
    if (project.activeView === 'git') await this.sourceControl.refresh();
  }

  private resize(): void {
    window.requestAnimationFrame(this.options.resized);
  }
}
