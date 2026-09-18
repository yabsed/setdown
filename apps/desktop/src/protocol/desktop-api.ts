import type { PreviewThemeAssets, PreviewThemeId } from '../core/preview/preview-preferences';
import type { DiskVersion, DocumentSnapshot } from '../core/document/document';
import type { RenderResult } from '../core/preview/preview-state';
import type { ThemeSnapshot } from '../core/theme/theme-state';

export type { DiskVersion, DocumentSnapshot } from '../core/document/document';
export type { PreviewHeading, RenderResult } from '../core/preview/preview-state';
export type { ThemeSnapshot } from '../core/theme/theme-state';

export type SaveResult = {
  canceled: boolean;
  document?: DocumentSnapshot;
};

export type ExternalChange = {
  path: string;
  diskVersion: DiskVersion;
};

export type ExportPdfResult = {
  canceled: boolean;
  path?: string;
};

export type PasteImageResult = {
  canceled: boolean;
  markdown?: string;
  relativePath?: string;
};

export type PickLinkTargetResult = {
  canceled: boolean;
  destination?: string;
  label?: string;
};

export type ProjectFolder = { path: string; name: string };

export type ProjectFilesChanged = { root: string };

export type ProjectEntry = {
  path: string;
  name: string;
  kind: 'directory' | 'document' | 'file';
};

export type ProjectEntryKind = 'file' | 'directory';

export type ProjectEntryMove = {
  from: string;
  to: string;
};

export type ProjectSearchResult = {
  path: string;
  name: string;
  relativePath: string;
  surface: 'viewer' | 'editor';
  line: number;
  column: number;
  lineOccurrence: number;
  ordinal: number;
  preview: string;
};

export type ProjectSearchDocument = {
  path: string;
  text: string;
  surface: 'viewer' | 'editor';
  matches?: Array<Pick<
    ProjectSearchResult,
    'line' | 'column' | 'lineOccurrence' | 'ordinal' | 'preview'
  >>;
};

export type ProjectSearchRequest = {
  query: string;
  documents: ProjectSearchDocument[];
};

export type GitChange = {
  path: string;
  filePath: string;
  status: string;
  indexStatus: string;
  workingTreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  conflict: boolean;
};

export type GitSnapshot = {
  repository: boolean;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  changes: GitChange[];
};

export type GitRemoteAction = 'fetch' | 'pull' | 'push' | 'sync';

export type GitDiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
};

export type GitDiff = {
  path: string;
  filePath: string;
  staged: boolean;
  patch: string;
  originalText: string | null;
  modifiedText: string | null;
  originalLabel: 'EMPTY' | 'HEAD' | 'INDEX';
  /**
   * Right-hand stage of the comparison. The main process only emits INDEX or
   * WORKTREE (saved disk bytes, the `git diff` view). The renderer resolves
   * BUFFER when an open editor holds unsaved content for the same file, which
   * is why a Changes review can legitimately differ from `git diff`.
   */
  modifiedLabel: 'INDEX' | 'WORKTREE' | 'BUFFER';
  hunks: GitDiffHunk[];
};

export type GitDiffPreviewResult = RenderResult & { supported: boolean };

export type TabStateSummary = {
  name: string;
  path: string;
  dirty: boolean;
  isUntitled: boolean;
};

/** Renderer-owned Git review state retained by the window across a renderer reload. */
export type GitReviewState = TabStateSummary & {
  staged: boolean;
  active: boolean;
  mode: 'rendered' | 'source';
  line: number;
  expectedText: string | null;
  workingText: string | null;
};

export type TransferableTab = {
  id: string;
  document: DocumentSnapshot;
  text: string;
  revision: number;
  surface: 'viewer' | 'editor';
  anchor: {
    sourceLine: number;
    sourceColumn?: number;
    sourceEndLine?: number;
    yRatio: number;
    reason: string;
    confidence: string;
  };
  editorViewState: unknown;
  viewerScrollRatio: number | null;
  /**
   * 이동을 시작한 순간 source 창의 Viewer에 보이던 줄들과 그 화면 비율.
   * 목적지 창의 폭이 다르면 본문이 재배치되므로 픽셀 scroll은 원리상 틀린다.
   * 이 띠의 무게중심으로 맞추면 보던 구간 전체가 같은 자리에 선다.
   */
  viewerBand?: { sourceLine: number; yRatio: number }[];
  /**
   * 목적지 창의 content 크기가 원래 창과 같은가.
   *
   * 같으면 폭도 배율도 그대로이므로 조판 결과가 한 픽셀도 달라지지 않는다.
   * 그때는 위치를 다시 계산하지 않는다. 재계산은 아무리 정확해도 몇 px의
   * 어긋남을 만들고, 그것이 화면이 흔들리는 것으로 보인다.
   */
  previewGeometryUnchanged?: boolean;
  previewUrl: string | null;
  previewRevision: number | null;
  previewTheme: PreviewThemeId | null;
  tocOpen: boolean;
};

export type ClaimedTabTransfer = {
  transferId: string;
  tab: TransferableTab;
};

export type PreviewBounds = { x: number; y: number; width: number; height: number };
export type PreviewMessage = { tabId: string; message: Record<string, unknown> };

export type ApplicationMenuEntry = {
  id: string;
  label: string;
  accelerator?: string;
  type: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu';
  enabled: boolean;
  checked: boolean;
  submenu?: ApplicationMenuEntry[];
};

export type CloseDecision = 'cancel' | 'discard' | 'save';

export type AppCommand =
  | 'new-document'
  | 'open-folder'
  | 'save'
  | 'save-as'
  | 'export-pdf'
  | 'close-tab'
  | 'next-tab'
  | 'previous-tab'
  | 'open-find'
  | 'escape'
  | 'toggle-folder-tools'
  | 'toggle-surface';

export type MarkTexApi = {
  initialTheme: ThemeSnapshot;
  getDocument(): Promise<DocumentSnapshot | null>;
  newDocument(): Promise<DocumentSnapshot | null>;
  openDocument(): Promise<DocumentSnapshot | null>;
  activateDocument(document: DocumentSnapshot, text: string, revision: number): Promise<DocumentSnapshot>;
  updateTabState(tabs: TabStateSummary[]): void;
  getGitReviewState(): Promise<GitReviewState | null>;
  updateGitReviewState(review: GitReviewState | null): void;
  registerTabTransfer(transferId: string, tab: TransferableTab): void;
  claimTabTransfer(transferId: string): Promise<ClaimedTabTransfer | null>;
  completeTabTransfer(transferId: string): void;
  cancelTabTransfer(transferId: string): void;
  detachTabToWindow(transferId: string, x: number, y: number): void;
  adoptTabTransfer(transferId: string): Promise<boolean>;
  releaseTabTransferSource(transferId: string): void;
  createPreview(tabId: string): void;
  /**
   * 조판하고 그 결과를 Preview에 설치한다.
   *
   * 예전에는 렌더러가 조판을 요청해 결과를 받고, 그것을 다시 메인으로 돌려
   * 보내 설치했다. 프로세스 경계를 여섯 번 넘었고 렌더러는 중계만 했다.
   */
  preparePreview(
    tabId: string,
    text: string,
    revision: number,
    documentPath: string,
    themeId: PreviewThemeId,
  ): Promise<RenderResult>;
  showPreview(tabId: string | null, bounds: PreviewBounds | null): void;
  /**
   * 지금 보이는 Preview를 PNG data URL로 얻는다. DOM overlay가 native view
   * 위에 그려질 수 없으므로, overlay가 열린 동안 이 정지 화면으로 갈음한다.
   */
  capturePreview(tabId: string): Promise<string | null>;
  sendPreviewCommand(tabId: string, message: Record<string, unknown>): void;
  destroyPreview(tabId: string): void;
  getTheme(): Promise<ThemeSnapshot>;
  getApplicationMenu(menuId: string): Promise<ApplicationMenuEntry[]>;
  executeApplicationMenuItem(itemId: string): void;
  getPreviewThemeAssets(themeId: PreviewThemeId): Promise<PreviewThemeAssets>;
  closeEmptyWindow(): void;
  updateText(text: string, revision: number): void;
  saveDocument(text: string, revision: number): Promise<SaveResult>;
  saveDocumentAs(text: string, revision: number): Promise<SaveResult>;
  saveTabDocument(document: DocumentSnapshot, text: string, revision: number): Promise<SaveResult>;
  discardDocument(document: DocumentSnapshot): Promise<void>;
  resolveWindowClose(decision: CloseDecision): void;
  finishWindowClose(saved: boolean): void;
  reloadDocument(): Promise<DocumentSnapshot | null>;
  exportPdf(text: string, revision: number, documentPath: string): Promise<ExportPdfResult>;
  pasteClipboardImage(): Promise<PasteImageResult>;
  pickLinkTarget(documentPath: string): Promise<PickLinkTargetResult>;
  pathForFile(file: File): string;
  chooseProjectFolder(): Promise<ProjectFolder | null>;
  getProjectFolder(): Promise<ProjectFolder | null>;
  restoreProjectFolder(path: string): Promise<ProjectFolder | null>;
  readProjectDirectory(directoryPath: string): Promise<ProjectEntry[]>;
  createProjectEntry(parentPath: string, name: string, kind: ProjectEntryKind): Promise<ProjectEntry>;
  renameProjectEntry(entryPath: string, name: string): Promise<ProjectEntryMove>;
  moveProjectEntry(entryPath: string, targetDirectory: string): Promise<ProjectEntryMove>;
  trashProjectEntry(entryPath: string): Promise<void>;
  openProjectFile(filePath: string): Promise<DocumentSnapshot | null>;
  searchProject(request: ProjectSearchRequest): Promise<ProjectSearchResult[]>;
  getGitStatus(): Promise<GitSnapshot>;
  getGitDiff(filePath: string, staged: boolean): Promise<GitDiff>;
  saveGitWorkingTree(
    filePath: string,
    text: string,
    expectedText: string,
  ): Promise<DocumentSnapshot>;
  prepareGitDiffPreview(
    tabId: string,
    diff: GitDiff,
    themeId: PreviewThemeId,
  ): Promise<GitDiffPreviewResult>;
  initializeGit(): Promise<GitSnapshot>;
  stageGit(paths: string[]): Promise<GitSnapshot>;
  unstageGit(paths: string[]): Promise<GitSnapshot>;
  discardGit(paths: string[]): Promise<GitSnapshot>;
  commitGit(message: string): Promise<GitSnapshot>;
  runGitRemote(action: GitRemoteAction): Promise<GitSnapshot>;
  openLink(href: string): Promise<void>;
  onDocumentOpened(listener: (document: DocumentSnapshot) => void): () => void;
  onExternalChange(listener: (change: ExternalChange) => void): () => void;
  onProjectFilesChanged(listener: (event: ProjectFilesChanged) => void): () => void;
  onCommand(listener: (command: AppCommand) => void): () => void;
  onThemeChanged(listener: (theme: ThemeSnapshot) => void): () => void;
  onWindowCloseRequested(listener: (names: string[]) => void): () => void;
  onSaveBeforeClose(listener: () => void): () => void;
  onTabTransferIncoming(listener: (transfer: ClaimedTabTransfer) => void): () => void;
  onTabTransferCompleted(listener: (transfer: { transferId: string; tabId: string }) => void): () => void;
  onPreviewMessage(listener: (payload: PreviewMessage) => void): () => void;
  onPreviewFindRequested(listener: (tabId: string) => void): () => void;
};
