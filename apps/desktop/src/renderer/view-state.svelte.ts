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
  id: string;
  name: string;
  path: string;
  active: boolean;
  dirty: boolean;
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
  focusGroup(id: string): void;
  resizeGroup(id: string, ratio: number): void;
  loadMenu(id: string): Promise<ApplicationMenuEntry[]>;
  executeMenuItem(id: string): void;
  resolveClosePrompt(decision: CloseDecision): void;
  activateTab(id: string): void;
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
  openProjectFile(path: string): void;
  createProjectEntry(parentPath: string, name: string, kind: ProjectEntryKind): Promise<void>;
  renameProjectEntry(path: string, name: string): Promise<void>;
  moveProjectEntry(path: string, targetDirectory: string): Promise<void>;
  trashProjectEntry(path: string): Promise<void>;
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
  groups: [{ id: 'group-0', tabs: [], activeId: null }] as import('../core/workspace/editor-groups').Group[],
  groupTree: { kind: 'group', id: 'group-0' } as import('../core/workspace/editor-groups').GroupTree,
  focusedGroupId: 'group-0',
  tabs: [] as TabView[],
  draggedTabId: null as string | null,
  surface: 'empty' as 'empty' | 'viewer' | 'editor' | 'pdf' | 'image' | 'video',
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
