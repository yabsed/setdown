import type { GitHistorySelection } from '../../protocol/git-history';
import type {
  DocumentSnapshot, GitRemoteAction, PreviewBounds, PreviewMessage, ProjectEntryKind,
  ProjectFolder, ProjectSearchDocument, ProjectSearchResult,
} from '../../protocol/desktop-api';
import type { PreviewThemeId } from '../../core/preview/preview-preferences';
import type { EditorOpenOptions } from '../../core/workspace/editor-groups';
import type { DesktopPort } from '../ports/desktop-port';
import type { WorkingTreeEdit } from '../../core/document/text-edit';
import { ExplorerController } from './explorer/explorer-controller';
import { project, rememberProjectState, type ProjectView } from './project-state.svelte';
import { SearchController } from './search/search-controller';
import { SourceControlController } from './source-control/source-control-controller';
import type { ExplorerTransfer } from '../../protocol/explorer';

type SearchTarget = Pick<ProjectSearchResult, 'surface' | 'line' | 'column' | 'lineOccurrence' | 'ordinal'>;
type Options = {
  folderChanged?(root: string | null): void;
  desktop: DesktopPort;
  searchDocuments(query: string): ProjectSearchDocument[];
  showDocument(path: string, options?: EditorOpenOptions): Promise<boolean>;
  openWorkingTree(path: string): Promise<boolean>;
  activateWorkingTree(path: string): Promise<boolean>;
  workingTreeBuffer(path: string): string | null;
  workingTreeChanged(path: string, text: string, edits?: WorkingTreeEdit[]): void;
  reloadDocuments(paths: string[]): Promise<void>;
  highlight(query: string, target?: SearchTarget): void;
  pathMoved(from: string, to: string): Promise<void>;
  prepareRemove(path: string): Promise<boolean>;
  commitRemove(path: string): Promise<void>;
  runMutation<T>(operation: () => Promise<T>): Promise<T>;
  reviewChanged(open: boolean, active: boolean): void;
  resized(): void;
};

export class ProjectController {
  private readonly explorer: ExplorerController;
  private readonly searcher: SearchController;
  private readonly sourceControl: SourceControlController;
  private changeTimer?: number;
  private changedPaths = new Set<string>();
  private fullRefresh = false;
  private folderRequest = 0;
  private recentRequest = 0;

  constructor(private readonly options: Options) {
    this.explorer = new ExplorerController({ desktop: options.desktop, showDocument: options.showDocument,
      pathMoved: options.pathMoved, prepareRemove: options.prepareRemove, commitRemove: options.commitRemove, runMutation: options.runMutation });
    this.searcher = new SearchController({ desktop: options.desktop, documents: options.searchDocuments,
      // The composition root deactivates the old review only after a successful read.
      open: (path) => this.explorer.open(path), highlight: options.highlight });
    this.sourceControl = new SourceControlController({ desktop: options.desktop,
      openWorkingTree: options.openWorkingTree, activateWorkingTree: options.activateWorkingTree,
      workingTreeBuffer: options.workingTreeBuffer, workingTreeChanged: options.workingTreeChanged,
      reviewChanged: options.reviewChanged });
  }

  toggle = (): void => {
    project.visible = !project.visible;
    rememberProjectState(); this.searcher.highlight(); this.resize();
  };
  select = (view: ProjectView): void => {
    if (project.visible && project.open && project.activeView === view) {
      project.open = false;
      rememberProjectState(); this.searcher.highlight(); return this.resize();
    }
    project.visible = true; project.open = true; project.activeView = view; project.error = '';
    rememberProjectState();
    if (view === 'git') void this.sourceControl.refresh();
    this.searcher.highlight(); this.resize();
  };
  chooseFolder = async (): Promise<void> => {
    const request = ++this.folderRequest;
    try {
      const folder = await this.options.desktop.chooseProjectFolder();
      if (folder && request === this.folderRequest) await this.replaceFolder(folder);
    } catch (error) { if (request === this.folderRequest) this.fail(error); }
  };
  openFolderPath = async (folderPath: string): Promise<void> => {
    const request = ++this.folderRequest;
    try {
      const folder = await this.options.desktop.restoreProjectFolder(folderPath);
      if (request !== this.folderRequest) return;
      if (!folder) { project.error = `Folder is unavailable: ${folderPath}`; return; }
      await this.replaceFolder(folder);
    } catch (error) { if (request === this.folderRequest) this.fail(error); }
  };
  recentFolders = async (): Promise<void> => {
    const request = ++this.recentRequest;
    try {
      const folders = await this.options.desktop.getRecentProjectFolders();
      if (request === this.recentRequest) project.recentFolders = folders;
    } catch (error) { if (request === this.recentRequest) this.fail(error); }
  };
  closeFolder = async (): Promise<void> => {
    const request = ++this.folderRequest;
    try {
      await this.options.desktop.closeProjectFolder();
      if (request !== this.folderRequest) return;
      this.clearFolderRefresh();
      project.folder = null; project.error = '';
      this.explorer.clear(); this.searcher.clear(); this.sourceControl.clear();
      this.options.folderChanged?.(null);
      rememberProjectState(); this.resize();
    } catch (error) { if (request === this.folderRequest) this.fail(error); }
  };
  restore = async (): Promise<void> => {
    const request = ++this.folderRequest;
    void this.recentFolders();
    // Reload keeps the main process's current folder. A fresh window always
    // starts with no folder, regardless of an old renderer storage snapshot.
    const folder = await this.options.desktop.getProjectFolder();
    if (request !== this.folderRequest) return;
    if (!folder) { project.folder = null; this.explorer.clear(); this.options.folderChanged?.(null); rememberProjectState(); return; }
    project.folder = folder; rememberProjectState();
    this.options.folderChanged?.(folder.path);
    await this.explorer.restore(folder);
    if (request !== this.folderRequest) return;
    this.searcher.restore();
    await this.sourceControl.refresh();
    if (request !== this.folderRequest) return;
    await this.sourceControl.restore();
    this.resize();
  };
  refreshExplorer = (): Promise<void> => this.explorer.refresh();
  collapseExplorer = (): void => this.explorer.collapse();
  toggleExplorerRoot = (): void => {
    project.explorerRootExpanded = !project.explorerRootExpanded; rememberProjectState();
  };
  toggleDirectory = (path: string): Promise<void> => this.explorer.toggle(path);
  openFile = (path: string, options?: EditorOpenOptions): Promise<boolean> => this.explorer.open(path, options);
  createEntry = (parent: string, name: string, kind: ProjectEntryKind): Promise<void> => this.explorer.create(parent, name, kind);
  renameEntry = (path: string, name: string): Promise<void> => this.explorer.rename(path, name);
  moveEntry = (path: string, target: string): Promise<void> => this.explorer.move(path, target);
  moveEntries = (paths: string[], target: string): Promise<string[]> => this.explorer.moveMany(paths, target);
  transferEntries = (request: ExplorerTransfer | { kind: 'paste'; target: string; conflict?: ExplorerTransfer['conflict'] }) => this.explorer.transfer(request);
  revealEntry = (path: string) => this.explorer.reveal(path);
  trashEntry = (path: string): Promise<boolean> => this.explorer.trash(path);
  openSearchResult = (result: ProjectSearchResult): Promise<void> => this.searcher.open(result);
  search = (query: string): void => this.searcher.search(query);
  toggleSearchGroup = (path: string): void => this.searcher.toggleGroup(path);
  contextChanged = (): void => this.searcher.contextChanged();
  documentSaved = (document: DocumentSnapshot): Promise<void> => this.sourceControl.documentSaved(document);
  filesChanged = (root: string, paths?: string[]): void => {
    if (root !== project.folder?.path) return;
    if (!paths) this.fullRefresh = true;
    else for (const path of paths) this.changedPaths.add(path);
    if (this.changeTimer) return;
    this.changeTimer = window.setTimeout(() => {
      this.changeTimer = undefined;
      const changed = this.fullRefresh ? undefined : [...this.changedPaths];
      this.fullRefresh = false; this.changedPaths.clear();
      void this.refreshChangedProject(changed);
    }, 120);
  };
  refreshGit = (): Promise<void> => this.sourceControl.refresh();
  toggleGitGroup = (title: string): void => {
    project.collapsedGitGroups = project.collapsedGitGroups.includes(title)
      ? project.collapsedGitGroups.filter((candidate) => candidate !== title) : [...project.collapsedGitGroups, title];
    rememberProjectState();
  };
  reviewGitHistory = (selection: GitHistorySelection): Promise<void> => this.sourceControl.reviewHistory(selection);
  reviewGitChange = (path: string, staged: boolean): Promise<void> => this.sourceControl.review(path, staged);
  activateGitDiff = (id: string): void => void this.sourceControl.activateDiff(id);
  deactivateGitDiff = (): void => this.sourceControl.deactivateDiff();
  closeGitDiff = (id?: string): void => this.sourceControl.closeDiff(id);
  closeWorkingTreeReviews = (path: string): void => this.sourceControl.closeWorkingTreeReviews(path);
  layoutGitDiff = (bounds: PreviewBounds | null): void => this.sourceControl.layoutDiff(bounds);
  updateGitDiffLine = (line: number): void => this.sourceControl.updateSourceLine(line);
  toggleGitDiffMode = (): void => this.sourceControl.toggleDiffMode();
  showRenderedGitDiff = (): void => this.sourceControl.showRendered();
  changeGitWorkingTree = (text: string, edits?: WorkingTreeEdit[]): void => this.sourceControl.changeWorkingTree(text, edits);
  previewMessage = (payload: PreviewMessage): boolean => this.sourceControl.previewMessage(payload);
  applyTheme = (themeId: PreviewThemeId): Promise<void> => this.sourceControl.applyTheme(themeId);
  initializeGit = (): Promise<void> => this.sourceControl.initialize();
  stageGit = (paths: string[]): Promise<void> => this.sourceControl.stage(paths);
  unstageGit = (paths: string[]): Promise<void> => this.sourceControl.unstage(paths);
  discardGit = async (paths: string[]): Promise<void> => {
    await this.sourceControl.discard(paths, () => this.options.reloadDocuments(paths));
    await this.explorer.refresh();
  };
  commitGit = (message: string): Promise<void> => this.sourceControl.commit(message);
  runGitRemote = async (action: GitRemoteAction): Promise<void> => {
    await this.sourceControl.remote(action);
    if (action !== 'fetch') await this.explorer.refresh();
  };
  private async replaceFolder(folder: ProjectFolder): Promise<void> {
    this.clearFolderRefresh();
    project.folder = folder; project.error = ''; project.visible = true; project.open = true; project.activeView = 'explorer';
    project.explorerRootExpanded = true;
    void this.recentFolders();
    this.options.folderChanged?.(folder.path);
    this.searcher.clear(); this.sourceControl.clear(); rememberProjectState();
    // Git status scans the whole tree; the explorer's top level is already
    // rendered by reset(), so let status fill in behind it.
    await this.explorer.reset(folder); void this.sourceControl.refresh(); this.resize();
  }
  private clearFolderRefresh(): void {
    window.clearTimeout(this.changeTimer); this.changeTimer = undefined; this.changedPaths.clear(); this.fullRefresh = false;
  }
  private fail(error: unknown): void { project.error = error instanceof Error ? error.message : String(error); }
  private async refreshChangedProject(paths?: string[]): Promise<void> {
    await this.explorer.refresh(paths);
    if (project.searchQuery.trim()) this.searcher.contextChanged();
    await this.sourceControl.refresh();
  }
  private resize(): void { window.requestAnimationFrame(this.options.resized); }
}
