import type { PreviewThemeAssets, PreviewThemeId } from './preview-preferences';

export type DiskVersion = {
  mtimeMs: number;
  size: number;
};

export type DocumentSnapshot = {
  path: string;
  name: string;
  text: string;
  revision: number;
  savedRevision: number;
  diskVersion: DiskVersion;
  isUntitled: boolean;
};

export type RenderResult = {
  revision: number;
  url: string;
  themeId: PreviewThemeId;
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
  previewUrl: string | null;
  previewRevision: number | null;
  previewTheme: PreviewThemeId | null;
};

export type ClaimedTabTransfer = {
  transferId: string;
  tab: TransferableTab;
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
  | `set-preview-theme:${PreviewThemeId}`
  | 'toggle-surface';

export type MarkTexApi = {
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
  renderDocument(
    text: string,
    revision: number,
    documentPath: string,
    themeId: PreviewThemeId,
  ): Promise<RenderResult>;
  exportPdf(text: string, revision: number, documentPath: string): Promise<ExportPdfResult>;
  pasteClipboardImage(): Promise<PasteImageResult>;
  pickLinkTarget(documentPath: string): Promise<PickLinkTargetResult>;
  openLink(href: string): Promise<void>;
  onDocumentOpened(listener: (document: DocumentSnapshot) => void): () => void;
  onExternalChange(listener: (change: ExternalChange) => void): () => void;
  onCommand(listener: (command: AppCommand) => void): () => void;
  onSaveBeforeClose(listener: () => void): () => void;
  onTabTransferIncoming(listener: (transfer: ClaimedTabTransfer) => void): () => void;
  onTabTransferCompleted(listener: (tabId: string) => void): () => void;
};
