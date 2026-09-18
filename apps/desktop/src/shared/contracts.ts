import type { PreviewThemeAssets, PreviewThemeId } from './preview-preferences';

export type DiskVersion = {
  mtimeMs: number;
  size: number;
};

export type DocumentSnapshot = {
  path: string;
  name: string;
  text: string;
  /** 마지막으로 확인한 디스크 내용. dirty 여부의 기준이다. */
  savedText: string;
  revision: number;
  savedRevision: number;
  diskVersion: DiskVersion;
  isUntitled: boolean;
};

/**
 * 렌더러가 보는 조판 결과.
 *
 * 조판된 HTML은 담지 않는다. 수식 문서에서 1.4MB가 되는데 렌더러는 손도 대지
 * 않고 되돌려 보내기만 했다. 조판과 설치를 메인이 한 번에 처리하고, 렌더러는
 * 결과만 받는다.
 */
export type RenderResult = {
  revision: number;
  themeId: PreviewThemeId;
  /** 이 탭의 Preview가 지금 띄우고 있는 페이지. 실패했을 때만 null이다. */
  url: string | null;
};

export type PreviewHeading = {
  id: string;
  text: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  sourceLine?: number;
};

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

export type TabStateSummary = {
  name: string;
  path: string;
  dirty: boolean;
  isUntitled: boolean;
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

export type ThemeSnapshot = {
  id: PreviewThemeId;
  revision: number;
};

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
  | 'save'
  | 'save-as'
  | 'export-pdf'
  | 'close-tab'
  | 'next-tab'
  | 'previous-tab'
  | 'insert-table'
  | 'insert-link'
  | 'open-find'
  | 'escape'
  | 'toggle-surface';

export type MarkTexApi = {
  initialTheme: ThemeSnapshot;
  getDocument(): Promise<DocumentSnapshot | null>;
  newDocument(): Promise<DocumentSnapshot | null>;
  openDocument(): Promise<DocumentSnapshot | null>;
  activateDocument(document: DocumentSnapshot, text: string, revision: number): Promise<DocumentSnapshot>;
  updateTabState(tabs: TabStateSummary[]): void;
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
  confirmCloseDocument(name: string): Promise<CloseDecision>;
  discardDocument(document: DocumentSnapshot): Promise<void>;
  finishWindowClose(saved: boolean): void;
  reloadDocument(): Promise<DocumentSnapshot | null>;
  exportPdf(text: string, revision: number, documentPath: string): Promise<ExportPdfResult>;
  pasteClipboardImage(): Promise<PasteImageResult>;
  pickLinkTarget(documentPath: string): Promise<PickLinkTargetResult>;
  openLink(href: string): Promise<void>;
  onDocumentOpened(listener: (document: DocumentSnapshot) => void): () => void;
  onExternalChange(listener: (change: ExternalChange) => void): () => void;
  onCommand(listener: (command: AppCommand) => void): () => void;
  onThemeChanged(listener: (theme: ThemeSnapshot) => void): () => void;
  onSaveBeforeClose(listener: () => void): () => void;
  onTabTransferIncoming(listener: (transfer: ClaimedTabTransfer) => void): () => void;
  onTabTransferCompleted(listener: (transfer: { transferId: string; tabId: string }) => void): () => void;
  onPreviewMessage(listener: (payload: PreviewMessage) => void): () => void;
  onPreviewFindRequested(listener: (tabId: string) => void): () => void;
};
