import type { GitHistorySelection } from '../protocol/git-history';
import type {
  ApplicationMenuEntry,
  CloseDecision,
  GitRemoteAction,
  ProjectEntryKind,
  ProjectSearchResult,
  PreviewBounds,
} from '../protocol/desktop-api';
import type { ProjectView } from './project/project-state.svelte';

export type TabView = {
  sessionId?: string;
  kind?: 'document' | 'web' | 'terminal';
  exited?: boolean;
  page?: import('../protocol/browser').BrowserPage;
  id: string;
  name: string;
  path: string;
  active: boolean;
  dirty: boolean;
  preview: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type HeadingView = {
  id: string;
  text: string;
  level: number;
};

export type ClosePromptView = {
  scope: 'tab' | 'window';
  names: string[];
};

export type WorkingTreeEdit = {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  text: string;
};

export type AppActions = {
  locationSuggestions: import('../protocol/desktop-api').MarkTexApi['locationSuggestions'];
  menuOverlay: import('../protocol/desktop-api').MarkTexApi['menuOverlay'];
  changeZoom(steps: number, scope: 'app' | 'text' | 'terminal', tabId?: string): void;
  newTerminal(): void;
  openTerminalSession(id: string): void;
  closeTerminalSession(id: string): void;
  terminalChanged(id: string, info: { title?: string; cwd?: string; exited?: boolean }): void;
  newWebTab(input?: string, background?: boolean): void;
  navigateLocation(groupId: string, input: string): Promise<void>;
  navigateHistory(id: string, direction: -1 | 1): void;
  browserCommand(id: string, command: import('../protocol/browser').BrowserCommand): void;
  browserPlaces(query: string, scope?: import('../protocol/browser').BrowserPlaceScope): Promise<import('../protocol/browser').BrowserPlace[]>;
  browserBookmark(url: string, title: string, bookmarked: boolean): Promise<void>;
  browserDeleteHistory(url?: string): Promise<void>;
  browserDownloadCommand(id: string, command: import('../protocol/browser').DownloadCommand): Promise<void>;
  browserFind(id: string, query: string, forward?: boolean, next?: boolean): void;
  browserReaderExport(id: string, format: 'markdown' | 'pdf'): Promise<void>;
  browserReaderMenu(id: string, context: { selection: string; link: string }): Promise<import('../core/reading/reading-menu').ReadingMenuCommand | null>;
  browserReaderEnter(id: string): void;
  browserReaderExit(id: string, anchor?: import('../protocol/browser').ReaderAnchor): void;
  browserExtensions(): Promise<import('../protocol/browser').BrowserExtensionInfo[]>;
  browserInstallExtension(kind: import('../protocol/browser').ExtensionInstallKind, input?: string): Promise<import('../protocol/browser').BrowserExtensionInfo[]>;
  browserSetExtensionEnabled(id: string, enabled: boolean): Promise<import('../protocol/browser').BrowserExtensionInfo[]>;
  browserRemoveExtension(id: string): Promise<import('../protocol/browser').BrowserExtensionInfo[]>;
  browserOpenExtension(id: string, page: import('../protocol/browser').ExtensionPage): Promise<void>;
  focusGroup(id: string): void;
  resizeGroup(id: string, ratio: number): void;
  loadMenu(id: string): Promise<ApplicationMenuEntry[]>;
  executeMenuItem(id: string): void;
  resolveClosePrompt(decision: CloseDecision): void;
  activateTab(id: string): void;
  pinTab(id: string): void;
  closeTab(id: string): void;
  startTabDrag(id: string, event: DragEvent): void;
  endTabDrag(event: DragEvent): void;
  newDocument(): void;
  openDocument(): void;
  toggleProjectSidebar(): void;
  selectProjectView(view: ProjectView): void;
  chooseProjectFolder(): void;
  refreshProjectExplorer(): void;
  collapseProjectExplorer(): void;
  toggleProjectExplorerRoot(): void;
  toggleProjectDirectory(path: string): void;
  openProjectFile(path: string, options?: import('../core/workspace/editor-groups').EditorOpenOptions): void;
  createProjectEntry(parentPath: string, name: string, kind: ProjectEntryKind): Promise<void>;
  renameProjectEntry(path: string, name: string): Promise<void>;
  moveProjectEntry(path: string, targetDirectory: string): Promise<void>;
  moveProjectEntries(paths: string[], targetDirectory: string): Promise<string[]>;
  explorer: import('../protocol/explorer').ExplorerApi;
  transferProjectEntries(request: import('../protocol/explorer').ExplorerTransfer | { kind: 'paste'; target: string; conflict?: import('../protocol/explorer').ExplorerTransfer['conflict'] }): Promise<void>;
  revealActiveProjectEntry(): Promise<void>;
  openProjectTerminal(path: string): void;
  openProjectFiles(paths: string[]): Promise<void>;
  trashProjectEntry(path: string): Promise<boolean>;
  openProjectSearchResult(result: ProjectSearchResult): void;
  searchProject(query: string): void;
  toggleProjectSearchGroup(path: string): void;
  refreshProjectGit(): void;
  toggleProjectGitGroup(title: string): void;
  reviewGitHistory(selection: GitHistorySelection): void;
  reviewProjectGitChange(path: string, staged: boolean): void;
  activateProjectGitDiff(id: string): void;
  closeProjectGitDiff(id: string): void;
  layoutProjectGitDiff(bounds: PreviewBounds | null): void;
  updateProjectGitDiffLine(line: number): void;
  changeProjectGitWorkingTree(text: string, edits?: WorkingTreeEdit[]): void;
  saveProjectGitWorkingTree(): void;
  initializeProjectGit(): void;
  stageProjectGit(paths: string[]): void;
  unstageProjectGit(paths: string[]): void;
  discardProjectGit(paths: string[]): void;
  commitProjectGit(message: string): void;
  runProjectGitRemote(action: GitRemoteAction): void;
  toggleSurface(): void;
  openTable(): void;
  openLink(): void;
  submitTable(): void;
  closeTable(): void;
  submitLink(): void;
  closeLink(): void;
  pickLinkFile(): void;
  toggleToc(): void;
  find(query: string, direction?: 'forward' | 'backward', next?: boolean): void;
  closeFind(): void;
  scrollToHeading(id: string): void;
  keepExternalChange(): void;
  reloadExternalChange(): void;
  showRenderError(): void;
};

export const view = $state({
  languageSupportOpen: false,
  groups: [{ id: 'group-0', tabs: [], activeId: null, previewId: null }] as import('../core/workspace/editor-groups').Group[],
  groupTree: { kind: 'group', id: 'group-0' } as import('../core/workspace/editor-groups').GroupTree,
  focusedGroupId: 'group-0',
  tabs: [] as TabView[],
  terminalSessions: [] as import('../core/workspace/workspace-state').TerminalSession[],
  draggedTabId: null as string | null,
  surface: 'empty' as 'empty' | 'viewer' | 'editor' | 'pdf' | 'image' | 'video' | 'web' | 'terminal',
  mediaTabs: [] as import('./workspace/media-cache').MediaTab[],
  activeMediaId: null as string | null,
  notice: false,
  tocOpen: false,
  headings: [] as HeadingView[],
  activeHeadingId: null as string | null,
  findOpen: false,
  findQuery: '',
  findActive: 0,
  findMatches: 0,
  rendering: false,
  renderVariant: 'blocking' as 'blocking' | 'refresh',
  renderError: '',
  renderErrorVariant: 'blocking' as 'blocking' | 'refresh',
  closePrompt: null as ClosePromptView | null,
});
