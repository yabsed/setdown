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
  closeEmptyWindow(): void;
  updateText(text: string, revision: number): void;
  saveDocument(text: string, revision: number): Promise<SaveResult>;
  saveDocumentAs(text: string, revision: number): Promise<SaveResult>;
  saveTabDocument(document: DocumentSnapshot, text: string, revision: number): Promise<SaveResult>;
  confirmCloseDocument(name: string): Promise<CloseDecision>;
  discardDocument(document: DocumentSnapshot): Promise<void>;
  finishWindowClose(saved: boolean): void;
  reloadDocument(): Promise<DocumentSnapshot | null>;
  renderDocument(text: string, revision: number, documentPath: string): Promise<RenderResult>;
  exportPdf(text: string, revision: number, documentPath: string): Promise<ExportPdfResult>;
  pasteClipboardImage(): Promise<PasteImageResult>;
  openLink(href: string): Promise<void>;
  onDocumentOpened(listener: (document: DocumentSnapshot) => void): () => void;
  onExternalChange(listener: (change: ExternalChange) => void): () => void;
  onCommand(listener: (command: AppCommand) => void): () => void;
  onSaveBeforeClose(listener: () => void): () => void;
  onTabTransferIncoming(listener: (transfer: ClaimedTabTransfer) => void): () => void;
  onTabTransferCompleted(listener: (tabId: string) => void): () => void;
};
