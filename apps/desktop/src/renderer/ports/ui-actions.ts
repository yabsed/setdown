import type { GitHistorySelection } from '../../protocol/git-history';
import type {
  ApplicationMenuEntry,
  CloseDecision,
  GitRemoteAction,
  ProjectEntryKind,
  ProjectSearchResult,
  PreviewBounds,
} from '../../protocol/desktop-api';
import type { ProjectView } from '../project/project-state.svelte';

import type { WorkingTreeEdit } from '../../core/document/text-edit';
import type { BrowserActions } from '../browser/browser-actions';
import type { TerminalActions } from '../terminal/terminal-actions';

/** Final shell action contract. Feature implementations own their action types. */
export type AppActions = BrowserActions & TerminalActions & {
  openLanguageLocation(path: string, selection?: import('monaco-editor').IRange | import('monaco-editor').IPosition): Promise<void>;
  locationSuggestions: import('../../protocol/desktop-api').MarkTexApi['locationSuggestions'];
  menuOverlay: import('../../protocol/desktop-api').MarkTexApi['menuOverlay'];
  changeZoom(steps: number, scope: 'app' | 'text' | 'terminal', tabId?: string): void;
  newWebTab(input?: string, background?: boolean): void;
  navigateLocation(groupId: string, input: string): Promise<void>;
  navigateHistory(id: string, direction: -1 | 1): void;
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
  openProjectFile(path: string, options?: import('../../core/workspace/editor-groups').EditorOpenOptions): void;
  createProjectEntry(parentPath: string, name: string, kind: ProjectEntryKind): Promise<void>;
  renameProjectEntry(path: string, name: string): Promise<void>;
  moveProjectEntry(path: string, targetDirectory: string): Promise<void>;
  moveProjectEntries(paths: string[], targetDirectory: string): Promise<string[]>;
  explorer: import('../../protocol/explorer').ExplorerApi;
  transferProjectEntries(request: import('../../protocol/explorer').ExplorerTransfer | { kind: 'paste'; target: string; conflict?: import('../../protocol/explorer').ExplorerTransfer['conflict'] }): Promise<void>;
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
