import { hasUnsavedText } from '../../core/document/document-state';
import { GOLDEN_TOP_RATIO, type ViewportAnchor } from '../../core/preview/viewport-anchor';
import {
  createWorkspaceTab,
  type TabSession,
  type WorkspaceState,
  type WorkspaceTab,
} from '../../core/workspace/workspace-state';
import type {
  ClaimedTabTransfer,
  CloseDecision,
  DocumentSnapshot,
  TransferableTab,
} from '../../protocol/desktop-api';
import type { MonacoEditor } from '../adapters/monaco-editor';
import type { SurfaceController } from '../application/surface-controller';
import type { DesktopPort } from '../ports/desktop-port';
import type { PreviewSession } from '../reader/preview-session';
import type { ReaderController } from '../reader/reader-controller';
import { view } from '../view-state.svelte';
import { restoredOutlineOpen } from '../shell/layout-session';

type Options = {
  desktop: DesktopPort;
  workspace: WorkspaceState;
  session: TabSession;
  shell: HTMLElement;
  editor: MonacoEditor;
  reader: ReaderController;
  preview: PreviewSession;
  surfaces: SurfaceController;
  confirmClose(name: string): Promise<CloseDecision>;
  workspaceChanged(): void;
};

const TRANSFER_ANNOUNCE_GRACE_MS = 150;

export class TabController {
  private activation = 0;

  constructor(private readonly options: Options) {}

  text = (tab: WorkspaceTab): string => this.options.editor.text(tab);

  dirty = (tab: WorkspaceTab): boolean => hasUnsavedText(tab.document, this.text(tab));

  currentText = (): string | null => {
    const tab = this.options.workspace.active;
    return tab ? this.text(tab) : this.options.session.document?.text ?? null;
  };

  lineCount = (): number => {
    const tab = this.options.workspace.active;
    return tab ? this.options.editor.lineCount(tab) : this.countLines(this.currentText() ?? '');
  };

  private saveActiveState(): void {
    const tab = this.options.workspace.active;
    if (!tab || !this.options.session.document) return;
    this.options.editor.saveView(tab);
    if (this.options.preview.readyRevision !== null) {
      tab.previewRevision = this.options.preview.readyRevision;
    }
  }

  transferable = (tab: WorkspaceTab): TransferableTab => {
    if (tab.id === this.options.workspace.activeId) this.saveActiveState();
    return {
      id: tab.id,
      document: tab.document,
      text: this.text(tab),
      revision: tab.revision,
      surface: tab.surface,
      anchor: tab.anchor,
      editorViewState: this.options.editor.exportView(tab.id),
      viewerScrollRatio: tab.viewerScrollRatio,
      previewUrl: tab.previewUrl,
      previewRevision: tab.previewRevision,
      previewTheme: tab.previewTheme,
      tocOpen: tab.tocOpen,
    };
  };

  render = (): void => {
    const { desktop, shell, workspace } = this.options;
    const summaries = workspace.tabs.map((tab) => ({
      id: tab.id,
      name: tab.document.name,
      path: tab.document.path,
      active: tab.id === workspace.activeId,
      dirty: this.dirty(tab),
    }));
    view.tabs = summaries;
    shell.dataset.tabs = summaries.length > 0 ? 'true' : 'false';
    shell.dataset.dirtyTabs = String(summaries.filter((tab) => tab.dirty).length);
    desktop.updateTabState(workspace.tabs.map((tab) => ({
      name: tab.document.name,
      path: tab.document.path,
      dirty: this.dirty(tab),
      isUntitled: tab.document.isUntitled,
    })));
    this.options.workspaceChanged();
  };

  updateChrome = (): void => {
    const { document: activeDocument } = this.options.session;
    if (!activeDocument) {
      document.title = 'Setdown';
      return;
    }
    const dirty = hasUnsavedText(activeDocument, this.currentText() ?? activeDocument.text);
    document.title = `${dirty ? '• ' : ''}${activeDocument.name} — Setdown`;
    this.render();
  };

  activate = async (tabId: string): Promise<void> => {
    const { desktop, editor, preview, reader, session, surfaces, workspace } = this.options;
    if (tabId === workspace.activeId) {
      this.activation += 1;
      return;
    }
    const next = workspace.find(tabId);
    if (!next) return;
    const activation = ++this.activation;
    if (next.surface === 'editor') await editor.load();
    if (activation !== this.activation) return;
    this.saveActiveState();
    preview.newSession();
    workspace.activeId = next.id;
    editor.activate(next);
    surfaces.publishAnchor();
    view.notice = false;
    if (next.previewRevision === session.revision
      && next.previewTheme === reader.themeId
      && next.previewUrl?.startsWith('marktex-preview:')) {
      preview.readyRevision = session.revision;
    }
    this.updateChrome();
    surfaces.set(next.surface);
    reader.send(next.id, { command: 'marktex:collect-headings' });
    await desktop.activateDocument(next.document, this.text(next), session.revision);
    if (activation !== this.activation || workspace.activeId !== next.id) return;
    if (preview.readyRevision === session.revision) {
      preview.updateUi();
      return;
    }
    const ready = await preview.ensure(session.revision);
    if (ready && next.surface === 'viewer' && activation === this.activation) {
      await preview.position(session.anchor, session.revision);
    }
  };

  close = async (tabId: string): Promise<void> => {
    const { desktop, editor, preview, reader, session, surfaces, workspace } = this.options;
    let index = workspace.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;
    const tab = workspace.tabs[index];
    if (this.dirty(tab)) {
      const decision = await this.options.confirmClose(tab.document.name);
      if (decision === 'cancel') return;
      if (decision === 'save') {
        const result = await desktop.saveTabDocument(tab.document, this.text(tab), tab.revision);
        if (result.canceled || !result.document) return;
        tab.document = result.document;
        tab.revision = result.document.revision;
      }
    }
    if (tab.document.isUntitled) await desktop.discardDocument(tab.document);
    index = workspace.tabs.findIndex((candidate) => candidate.id === tabId);
    if (index < 0) return;
    const removed = workspace.remove(tab.id);
    if (!removed) return;
    reader.destroy(tab.id);
    editor.dispose(tab.id);
    if (!removed.wasActive) return this.render();
    const replacement = workspace.replacement(removed.index);
    if (replacement) return void await this.activate(replacement.id);
    preview.reset();
    session.document = null;
    editor.clear();
    surfaces.set('empty');
    this.updateChrome();
    this.render();
  };

  removeTransferred = async (tabId: string): Promise<void> => {
    const { desktop, editor, preview, session, surfaces, workspace } = this.options;
    const removed = workspace.remove(tabId);
    if (!removed) return;
    const { tab } = removed;
    if (!removed.wasActive) {
      editor.dispose(tab.id);
      return this.render();
    }
    const replacement = workspace.replacement(removed.index);
    if (replacement) {
      await this.activate(replacement.id);
      editor.dispose(tab.id);
      return;
    }
    editor.dispose(tab.id);
    preview.reset();
    session.document = null;
    surfaces.set('empty');
    this.updateChrome();
    this.render();
    desktop.closeEmptyWindow();
  };

  cycle(direction: -1 | 1): void {
    const next = this.options.workspace.cycle(direction);
    if (next) void this.activate(next.id);
  }

  editorChanged = (tab: WorkspaceTab, text: string): void => {
    const { desktop, preview, session, workspace } = this.options;
    if (tab.id !== workspace.activeId || !session.document) return;
    tab.text = text;
    tab.revision += 1;
    desktop.updateText(text, tab.revision);
    this.updateChrome();
    if (tab.surface === 'editor') preview.schedule(tab.revision);
  };

  installModel = (documentSnapshot: DocumentSnapshot): void => {
    const tab = this.options.workspace.active;
    if (tab) this.options.editor.replace(tab, documentSnapshot);
  };

  show = async (
    documentSnapshot: DocumentSnapshot,
    initialSurface: 'viewer' | 'editor' = 'viewer',
  ): Promise<void> => {
    const { editor, reader, workspace } = this.options;
    if (!documentSnapshot.isUntitled) {
      const existing = workspace.tabs.find((tab) =>
        !tab.document.isUntitled && tab.document.path === documentSnapshot.path);
      if (existing) return void await this.activate(existing.id);
    }
    const id = crypto.randomUUID();
    reader.create(id);
    const created = createWorkspaceTab(id, documentSnapshot, initialSurface, {
      sourceLine: 1,
      yRatio: GOLDEN_TOP_RATIO,
      reason: 'empty-document',
      confidence: 'fallback',
    });
    created.tocOpen = restoredOutlineOpen();
    workspace.add(created);
    this.render();
    await this.activate(id);
    if (initialSurface === 'viewer') {
      window.setTimeout(() => {
        void editor.load().catch((error) => console.error('Failed to load editor', error));
      }, 0);
    }
  };

  installTransferred = async (transfer: ClaimedTabTransfer): Promise<void> => {
    const { desktop, editor, preview, reader, shell, surfaces, workspace } = this.options;
    const incoming = transfer.tab;
    const announce = workspace.tabs.length === 0;
    const finishAnnouncement = () => {
      if (!announce || !reader.awaiting) return;
      reader.awaiting = false;
      preview.updateUi();
    };
    if (announce) {
      reader.awaiting = true;
      surfaces.set('viewer');
    }
    if (!await desktop.adoptTabTransfer(transfer.transferId)) {
      finishAnnouncement();
      return;
    }
    shell.dataset.lastTransferUsedSnapshot = 'false';
    const restoredDocument: DocumentSnapshot = {
      ...incoming.document,
      text: incoming.text,
      revision: incoming.revision,
    };
    const restored = createWorkspaceTab(
      incoming.id,
      restoredDocument,
      incoming.surface,
      incoming.anchor as ViewportAnchor,
    );
    Object.assign(restored, {
      previewUrl: incoming.previewUrl,
      previewRevision: incoming.previewRevision,
      previewTheme: incoming.previewTheme,
      tocOpen: incoming.tocOpen === true,
      viewerScrollRatio: incoming.viewerScrollRatio,
    });
    editor.importView(restored.id, incoming.editorViewState);
    workspace.add(restored);
    this.render();
    await this.activate(restored.id);
    reader.syncView();
    const positioned = restored.surface === 'viewer'
      && restored.previewRevision !== null
      && incoming.previewGeometryUnchanged !== true
      ? preview.position(
        restored.anchor,
        restored.previewRevision,
        restored.id,
        this.countLines(restored.text),
        false,
        Array.isArray(incoming.viewerBand) ? incoming.viewerBand : [],
      )
      : Promise.resolve(true);
    desktop.completeTabTransfer(transfer.transferId);
    void Promise.race([
      positioned,
      new Promise((resolve) => window.setTimeout(resolve, TRANSFER_ANNOUNCE_GRACE_MS)),
    ]).then(finishAnnouncement);
  };

  reload = async (documentSnapshot: DocumentSnapshot): Promise<void> => {
    const { preview, session } = this.options;
    const tab = this.options.workspace.active;
    if (!tab) return;
    preview.reset();
    session.document = documentSnapshot;
    tab.document = documentSnapshot;
    tab.previewUrl = null;
    tab.previewRevision = null;
    tab.previewTheme = null;
    this.installModel(documentSnapshot);
    view.notice = false;
    this.updateChrome();
    const ready = await preview.ensure(session.revision);
    if (ready && session.surface === 'viewer') await preview.position(session.anchor, session.revision);
  };

  private countLines(text: string): number {
    return text.length === 0 ? 1 : text.split(/\r\n|\r|\n/).length;
  }
}
