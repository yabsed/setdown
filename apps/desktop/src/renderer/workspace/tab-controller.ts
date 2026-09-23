import { hasUnsavedText } from '../../core/document/document-state';
import { hasMarkdownPreview } from '../../core/document/document-capabilities';
import { documentSurface, isMarkdownDocument } from '../../core/document/document-profile';
import { retainUnsavedRevision } from '../../core/document/document-save';
import { GOLDEN_TOP_RATIO, type ViewportAnchor } from '../../core/preview/viewport-anchor';
import { createWorkspaceTab, type TabSession, type WorkspaceState, type WorkspaceTab } from '../../core/workspace/workspace-state';
import type { ClaimedTabTransfer, CloseDecision, DocumentSnapshot, TransferableTab } from '../../protocol/desktop-api';
import type { MonacoEditor } from '../adapters/monaco-editor';
import type { SurfaceController } from '../application/surface-controller';
import type { DesktopPort } from '../ports/desktop-port';
import type { PreviewSession } from '../reader/preview-session';
import type { ReaderController } from '../reader/reader-controller';
import { view, type WorkingTreeEdit } from '../view-state.svelte';
import { restoredOutlineOpen } from '../shell/layout-session';
import { tick } from 'svelte';
import { MediaCache } from './media-cache';
import type { EditorGroupPlacement } from '../../core/workspace/editor-groups';

type Options = {
  desktop: DesktopPort; workspace: WorkspaceState; session: TabSession; shell: HTMLElement;
  editor: MonacoEditor; reader: ReaderController; preview: PreviewSession; surfaces: SurfaceController;
  capturePosition?(tab?: WorkspaceTab): void;
  shouldSchedulePreview(): boolean;
  confirmClose(names: string[]): Promise<CloseDecision>;
  workspaceChanged(): void;
  groupsChanged?(): void;
  autoSave?: { schedule(tab: WorkspaceTab): void; cancel(tabId?: string): void };
};
const TRANSFER_ANNOUNCE_GRACE_MS = 150;

export class TabController {
  private activation = 0;
  private readonly media = new MediaCache();
  constructor(private readonly options: Options) {}
  text = (tab: WorkspaceTab): string => this.options.editor.text(tab);
  dirty = (tab: WorkspaceTab): boolean => hasUnsavedText(tab.document, this.text(tab));
  currentText = (): string | null => {
    const tab = this.options.workspace.active;
    return tab ? this.text(tab) : this.options.session.document?.text ?? null;
  };
  documentBuffer = (path: string): string | null => {
    const tab = this.options.workspace.tabs.find((candidate) => !candidate.document.isUntitled && candidate.document.path === path);
    return tab ? this.text(tab) : null;
  };
  activateWorkingTreePath = async (path: string): Promise<boolean> => {
    const tab = this.options.workspace.tabs.find((candidate) => !candidate.document.isUntitled && candidate.document.path === path);
    if (!tab) return false;
    await this.activate(tab.id, 'review');
    return true;
  };
  acceptWorkingTreeBuffer = (path: string, text: string, edits?: WorkingTreeEdit[]): void => {
    const { desktop, editor, preview, workspace } = this.options;
    const tab = workspace.tabs.find((candidate) => !candidate.document.isUntitled && candidate.document.path === path);
    if (!tab || this.text(tab) === text) return;
    const notified = editor.setText(tab, text, edits);
    if (!notified) {
      tab.text = text;
      tab.revision += 1;
      if (tab.id === workspace.activeId) desktop.updateText(text, tab.revision);
    }
    if (hasMarkdownPreview(tab.document)) {
      Object.assign(tab, { previewUrl: null, previewRevision: null, previewTheme: null });
      if (tab.id === workspace.activeId && tab.surface === 'viewer' && preview.readyRevision !== null) preview.reset();
    }
    if (!notified) this.updateChrome();
  };

  reloadDocumentPaths = async (paths: string[]): Promise<void> => {
    const selected = new Set(paths);
    const { desktop, editor, preview, reader, session, workspace } = this.options;
    const targets = workspace.tabs.filter((tab) => !tab.document.isUntitled && selected.has(tab.document.path));
    let activeReloaded = false;
    for (const tab of targets) {
      let diskDocument: DocumentSnapshot | null = null;
      try { diskDocument = await desktop.openProjectFile(tab.document.path); }
      catch (error) {
        // Decoder/permission failures must not masquerade as a discarded file.
        if (/ENOENT|no such file/i.test(String(error))) await this.close(tab.id, true);
        else throw error;
        continue;
      }
      if (!diskDocument || !workspace.find(tab.id)) continue;
      const active = workspace.activeId === tab.id;
      tab.document = diskDocument;
      Object.assign(tab, { previewUrl: null, previewRevision: null, previewTheme: null });
      editor.replace(tab, diskDocument);
      if (active) {
        session.document = diskDocument;
        if (hasMarkdownPreview(diskDocument)) preview.reset();
        view.notice = false;
        activeReloaded = true;
      }
    }
    const active = workspace.active;
    if (active) {
      await desktop.activateDocument(active.document, this.text(active), active.revision);
      if (activeReloaded && active.surface === 'viewer' && hasMarkdownPreview(active.document)) {
        const revision = active.revision;
        void preview.ensure(revision).then((ready) => {
          if (ready && workspace.activeId === active.id) void preview.position(active.anchor, revision);
        });
      }
      if (hasMarkdownPreview(active.document)) reader.send(active.id, { command: 'marktex:collect-headings' });
    }
    this.render();
    this.updateChrome();
  };
  lineCount = (): number => {
    const tab = this.options.workspace.active;
    return tab ? this.options.editor.lineCount(tab) : this.countLines(this.currentText() ?? '');
  };
  private saveActiveState(): void {
    const tab = this.options.workspace.active;
    if (!tab || !this.options.session.document) return;
    this.options.capturePosition?.(tab);
    this.options.editor.saveView(tab);
    if (hasMarkdownPreview(tab.document) && this.options.preview.readyRevision !== null) {
      tab.previewRevision = this.options.preview.readyRevision;
    }
  }
  transferable = (tab: WorkspaceTab): TransferableTab => {
    if (tab.id === this.options.workspace.activeId) this.saveActiveState();
    else this.options.editor.saveView(tab);
    const markdown = hasMarkdownPreview(tab.document);
    return { id: tab.id, document: tab.document, text: this.text(tab), revision: tab.revision,
      surface: documentSurface(tab.document.path, tab.surface), anchor: tab.anchor, readingPosition: tab.readingPosition,
      editorViewState: this.options.editor.exportView(tab.id), viewerScrollRatio: markdown ? tab.viewerScrollRatio : null,
      previewUrl: markdown ? tab.previewUrl : null, previewRevision: markdown ? tab.previewRevision : null,
      previewTheme: markdown ? tab.previewTheme : null, tocOpen: markdown && tab.tocOpen };
  };
  render = (): void => {
    const { desktop, shell, workspace } = this.options;
    const summaries = workspace.tabs.map((tab) => ({ id: tab.id, name: tab.document.name,
      path: tab.document.path, active: tab.id === workspace.activeId, dirty: this.dirty(tab) }));
    view.groups = workspace.groups.groups.map(group => ({ ...group, tabs: [...group.tabs] }));
    view.groupTree = structuredClone(workspace.groups.tree);
    view.focusedGroupId = workspace.groups.focusedId;
    view.tabs = summaries;
    void tick().then(() => this.options.groupsChanged?.());
    view.mediaTabs = this.media.sync(workspace.tabs, workspace.activeId, workspace.groups.groups.flatMap(g => g.activeId ? [g.activeId] : []));
    view.activeMediaId = workspace.active?.document.kind ? workspace.activeId : null;
    shell.dataset.tabs = summaries.length > 0 ? 'true' : 'false';
    shell.dataset.dirtyTabs = String(summaries.filter((tab) => tab.dirty).length);
    desktop.updateTabState(workspace.tabs.map((tab) => ({ name: tab.document.name, path: tab.document.path,
      dirty: this.dirty(tab), isUntitled: tab.document.isUntitled })));
    this.options.workspaceChanged();
  };
  updateChrome = (): void => {
    const { document: activeDocument } = this.options.session;
    if (!activeDocument) { document.title = 'Setdown'; return; }
    const dirty = hasUnsavedText(activeDocument, this.currentText() ?? activeDocument.text);
    document.title = `${dirty ? '• ' : ''}${activeDocument.name} — Setdown`;
    this.render();
  };

  activate = async (tabId: string, presentation: 'document' | 'review' = 'document'): Promise<void> => {
    const { desktop, editor, preview, reader, session, surfaces, workspace } = this.options;
    const next = workspace.find(tabId);
    if (!next) return;
    const reviewing = presentation === 'review';
    // Review needs the live document/session, not its ordinary reader. Suspend
    // before resetting sessions or updating UI, which can otherwise show it.
    if (reviewing) reader.setSuspended(true);
    next.surface = documentSurface(next.document.path, next.surface);
    if (tabId === workspace.activeId) {
      const activation = ++this.activation;
      if (reviewing) return;
      // A review may be this document's first source surface. Its shared model
      // does not imply that the ordinary editor has been mounted yet.
      if (next.surface === 'editor') {
        await editor.load();
        if (activation !== this.activation || workspace.activeId !== next.id) return;
      }
      editor.selectGroup(workspace.groups.focusedId);
      editor.activate(next);
      surfaces.set(next.surface);
      this.updateChrome();
      if (next.surface !== 'viewer' || !hasMarkdownPreview(next.document)) {
        window.setTimeout(() => editor.layout(), 0);
        return;
      }
      if (preview.readyRevision === session.revision && next.previewUrl) { preview.updateUi(); return; }
      const ready = await preview.ensure(session.revision);
      if (ready && activation === this.activation && workspace.activeId === next.id) {
        await preview.position(session.anchor, session.revision);
      }
      return;
    }
    const activation = ++this.activation;
    const restoreAnchor = next.readingPosition?.kind === 'text' ? { ...next.anchor } : null;
    next.restoringPosition = !!restoreAnchor;
    if (!reviewing && next.surface === 'editor') await editor.load();
    if (activation !== this.activation || !workspace.find(next.id)) return;
    this.saveActiveState();
    // A pending auto save targets the tab being deactivated; it could never fire.
    this.options.autoSave?.cancel();
    // Cancel outgoing work but retain its native page, model and cached revision.
    preview.newSession();
    workspace.activeId = next.id;
    editor.selectGroup(workspace.groups.focusedId);
    editor.activate(next);
    if (hasMarkdownPreview(next.document)) surfaces.publishAnchor();
    view.notice = false;
    if (hasMarkdownPreview(next.document) && next.previewRevision === session.revision
      && next.previewTheme === reader.themeId && next.previewUrl?.startsWith('marktex-preview:')) {
      preview.readyRevision = session.revision;
    }
    this.updateChrome();
    if (!reviewing) surfaces.set(next.surface);
    if (!reviewing && hasMarkdownPreview(next.document)) reader.send(next.id, { command: 'marktex:collect-headings' });
    await desktop.activateDocument(next.document, this.text(next), session.revision);
    if (activation !== this.activation || workspace.activeId !== next.id) return;
    if (reviewing) { next.restoringPosition = false; return; }
    if (!hasMarkdownPreview(next.document)) {
      if (restoreAnchor && next.surface === 'editor' && !(next.readingPosition?.kind === 'text' && next.readingPosition.editorView)) editor.reveal(restoreAnchor);
      next.restoringPosition = false; return;
    }
    if (preview.readyRevision === session.revision) { next.restoringPosition = false; preview.updateUi(); return; }
    const ready = await preview.ensure(session.revision);
    if (ready && next.surface === 'viewer' && activation === this.activation) {
      await preview.position(restoreAnchor ?? session.anchor, session.revision);
    }
    next.restoringPosition = false;
  };

  close = async (tabId: string, confirmed = false): Promise<boolean> => {
    const { desktop, editor, preview, reader, session, surfaces, workspace } = this.options;
    let index = workspace.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return true;
    const tab = workspace.tabs[index];
    if (this.dirty(tab) && !confirmed) {
      const decision = await this.options.confirmClose([tab.document.name]);
      if (decision === 'cancel') return false;
      if (decision === 'save') {
        const result = await desktop.saveTabDocument(tab.document, this.text(tab), tab.revision);
        if (result.canceled || !result.document) return false;
        await this.acceptSaved(tab, result.document);
        if (this.dirty(tab)) return false;
      }
    }
    if (tab.document.isUntitled) await desktop.discardDocument(tab.document);
    index = workspace.tabs.findIndex((candidate) => candidate.id === tabId);
    if (index < 0) return true;
    if (workspace.activeId === tab.id) this.saveActiveState();
    const removed = workspace.remove(tab.id);
    if (!removed) return true;
    this.options.autoSave?.cancel(tab.id);
    if (hasMarkdownPreview(tab.document)) reader.destroy(tab.id);
    editor.dispose(tab.id);
    if (!removed.wasActive) { this.render(); return true; }
    const replacement = workspace.replacement(removed.index);
    if (replacement) { await this.activate(replacement.id); return true; }
    preview.reset();
    session.document = null;
    editor.clear();
    surfaces.set('empty');
    this.updateChrome();
    this.render();
    return true;
  };
  prepareRemove = async (entryPath: string): Promise<boolean> => {
    const affected = this.options.workspace.tabs.filter((tab) => this.pathUnder(tab.document.path, entryPath));
    const dirty = affected.filter(this.dirty);
    if (dirty.length) {
      const decision = await this.options.confirmClose(dirty.map((tab) => tab.document.name));
      if (decision === 'cancel') return false;
      if (decision === 'save') for (const tab of dirty) {
        const result = await this.options.desktop.saveTabDocument(tab.document, this.text(tab), tab.revision);
        if (result.canceled || !result.document) return false;
        await this.acceptSaved(tab, result.document);
        if (this.dirty(tab)) return false;
      }
    }
    for (const tab of affected) if (!await this.close(tab.id, true)) return false;
    return true;
  };

  /** One path-change boundary for Save As and Explorer rename/move. */
  private async retarget(tab: WorkspaceTab, previousPath: string): Promise<void> {
    const { desktop, editor, preview, reader, surfaces, workspace } = this.options;
    const wasMarkdown = isMarkdownDocument(previousPath);
    const markdown = hasMarkdownPreview(tab.document);
    if (wasMarkdown && !markdown) reader.destroy(tab.id);
    if (!wasMarkdown && markdown) reader.create(tab.id);
    Object.assign(tab, { previewUrl: null, previewRevision: null, previewTheme: null });
    if (!markdown) Object.assign(tab, { surface: documentSurface(tab.document.path), tocOpen: false, headings: [], activeHeadingId: null,
      viewerScrollRatio: null, find: { open: false, query: '', activeMatch: 0, matches: 0 } });
    editor.retarget(tab);
    if (workspace.activeId !== tab.id) return;
    if (wasMarkdown || markdown) preview.reset();
    if (!markdown && tab.document.kind === undefined && !editor.loaded) await editor.load();
    if (workspace.activeId !== tab.id || !workspace.find(tab.id)) return;
    surfaces.set(tab.surface);
    await desktop.activateDocument(tab.document, this.text(tab), tab.revision);
    if (workspace.activeId !== tab.id || !hasMarkdownPreview(tab.document)) return;
    if (tab.surface === 'viewer') await preview.ensure(tab.revision);
    else preview.schedule(tab.revision);
  }

  acceptSaved = async (tab: WorkspaceTab, saved: DocumentSnapshot): Promise<void> => {
    if (!this.options.workspace.find(tab.id)) return;
    const oldPath = tab.document.path;
    const text = this.text(tab);
    const revision = tab.revision;
    tab.document = retainUnsavedRevision(saved, text, revision);
    tab.revision = tab.document.revision;
    tab.text = tab.document.text;
    // Only actual draft-asset text rewriting replaces content, not a pure rename.
    if (revision <= saved.revision && text !== saved.text) this.options.editor.replace(tab, saved);
    if (oldPath !== saved.path) await this.retarget(tab, oldPath);
    this.updateChrome();
  };

  relocatePath = async (from: string, to: string): Promise<void> => {
    const { workspace } = this.options;
    for (const tab of [...workspace.tabs]) {
      if (!this.pathUnder(tab.document.path, from)) continue;
      const previousPath = tab.document.path;
      const nextPath = `${to}${previousPath.slice(from.length)}`;
      tab.document = { ...tab.document, path: nextPath,
        name: nextPath.split(/[\\/]/).at(-1) || tab.document.name };
      await this.retarget(tab, previousPath);
    }
    this.updateChrome();
  };
  removeTransferred = async (tabId: string): Promise<void> => {
    const { desktop, editor, preview, session, surfaces, workspace } = this.options;
    const removed = workspace.remove(tabId);
    if (!removed) return;
    const { tab } = removed;
    if (!removed.wasActive) { editor.dispose(tab.id); return this.render(); }
    const replacement = workspace.replacement(removed.index);
    if (replacement) { await this.activate(replacement.id); editor.dispose(tab.id); return; }
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
    const { desktop, preview, workspace } = this.options;
    if (!workspace.find(tab.id)) return;
    tab.text = text;
    tab.revision += 1;
    const active = tab.id === workspace.activeId;
    if (active) desktop.updateText(text, tab.revision);
    this.updateChrome();
    if (active && hasMarkdownPreview(tab.document) && tab.surface === 'editor' && this.options.shouldSchedulePreview()) {
      preview.schedule(tab.revision);
    }
    this.options.autoSave?.schedule(tab);
  };
  installModel = (documentSnapshot: DocumentSnapshot): void => {
    const tab = this.options.workspace.active;
    if (tab) this.options.editor.replace(tab, documentSnapshot);
  };
  show = async (documentSnapshot: DocumentSnapshot, initialSurface: 'viewer' | 'editor' | 'pdf' | 'image' | 'video' = 'viewer',
    presentation: 'document' | 'review' = 'document', placement?: EditorGroupPlacement): Promise<void> => {
    const { editor, reader, workspace } = this.options;
    if (!documentSnapshot.isUntitled) {
      const existing = workspace.tabs.find((tab) => !tab.document.isUntitled && tab.document.path === documentSnapshot.path);
      if (existing) {
        if (placement) {
          if (existing.id === workspace.activeId) this.saveActiveState(); else editor.saveView(existing);
          workspace.groups.move(existing.id, placement.groupId, placement.direction, placement.index);
          this.render();
        }
        return void await this.activate(existing.id, presentation);
      }
    }
    const saved = documentSnapshot.readingPosition;
    initialSurface = documentSurface(documentSnapshot.path, saved?.kind === 'text' ? saved.surface : initialSurface);
    const id = crypto.randomUUID();
    if (hasMarkdownPreview(documentSnapshot)) reader.create(id);
    const created = createWorkspaceTab(id, documentSnapshot, initialSurface, {
      sourceLine: 1, yRatio: GOLDEN_TOP_RATIO, reason: 'empty-document', confidence: 'fallback',
    });
    if (saved?.kind === 'text') {
      created.anchor = { ...saved.anchor, sourceLine: Math.min(saved.anchor.sourceLine, this.countLines(created.text)) };
      if (saved.editorView) editor.importView(id, saved.editorView);
    }
    created.tocOpen = hasMarkdownPreview(documentSnapshot) && restoredOutlineOpen();
    workspace.add(created);
    if (placement) workspace.groups.move(id, placement.groupId, placement.direction, placement.index);
    this.render();
    await this.activate(id, presentation);
    if (presentation === 'document' && initialSurface === 'viewer' && hasMarkdownPreview(documentSnapshot)) window.setTimeout(() => {
      void editor.load().catch((error) => console.error('Failed to load editor', error));
    }, 0);
  };
  installTransferred = async (transfer: ClaimedTabTransfer, placement?: EditorGroupPlacement): Promise<void> => {
    const { desktop, editor, preview, reader, shell, surfaces, workspace } = this.options;
    const incoming = transfer.tab;
    const markdown = hasMarkdownPreview(incoming.document);
    const announce = markdown && workspace.tabs.length === 0;
    const finishAnnouncement = () => {
      if (!announce || !reader.awaiting) return;
      reader.awaiting = false;
      preview.updateUi();
    };
    if (announce) { reader.awaiting = true; surfaces.set('viewer'); }
    if (!await desktop.adoptTabTransfer(transfer.transferId)) { finishAnnouncement(); return; }
    shell.dataset.lastTransferUsedSnapshot = 'false';
    const restoredDocument: DocumentSnapshot = { ...incoming.document, text: incoming.text, revision: incoming.revision };
    const restored = createWorkspaceTab(incoming.id, restoredDocument, incoming.surface, incoming.anchor as ViewportAnchor);
    if (markdown) Object.assign(restored, { previewUrl: incoming.previewUrl, previewRevision: incoming.previewRevision,
      previewTheme: incoming.previewTheme, tocOpen: incoming.tocOpen === true, viewerScrollRatio: incoming.viewerScrollRatio });
    restored.readingPosition = incoming.readingPosition;
    editor.importView(restored.id, incoming.editorViewState);
    workspace.add(restored);
    if (placement) workspace.groups.move(restored.id, placement.groupId, placement.direction, placement.index);
    this.render();
    await this.activate(restored.id);
    reader.syncView();
    const positioned = markdown && restored.surface === 'viewer' && restored.previewRevision !== null
      && incoming.previewGeometryUnchanged !== true
      ? preview.position(restored.anchor, restored.previewRevision, restored.id, this.countLines(restored.text), false,
        Array.isArray(incoming.viewerBand) ? incoming.viewerBand : []) : Promise.resolve(true);
    desktop.completeTabTransfer(transfer.transferId);
    if (announce) void Promise.race([positioned,
      new Promise((resolve) => window.setTimeout(resolve, TRANSFER_ANNOUNCE_GRACE_MS))]).then(finishAnnouncement);
  };
  reload = async (documentSnapshot: DocumentSnapshot): Promise<void> => {
    const { preview, session } = this.options;
    const tab = this.options.workspace.active;
    if (!tab) return;
    if (hasMarkdownPreview(tab.document)) preview.reset();
    session.document = documentSnapshot;
    tab.document = documentSnapshot;
    Object.assign(tab, { previewUrl: null, previewRevision: null, previewTheme: null });
    this.installModel(documentSnapshot);
    view.notice = false;
    this.updateChrome();
    if (!hasMarkdownPreview(documentSnapshot)) return;
    const ready = await preview.ensure(session.revision);
    if (ready && session.surface === 'viewer') await preview.position(session.anchor, session.revision);
  };
  private countLines(text: string): number { return text.length === 0 ? 1 : text.split(/\r\n|\r|\n/).length; }
  private pathUnder(candidate: string, root: string): boolean {
    return candidate === root || candidate.startsWith(`${root}/`) || candidate.startsWith(`${root}\\`);
  }
}
