import { documentIdentity, type DocumentContent } from '../../core/workspace/document-store';
import { editorInputKey } from '../../core/workspace/workspace-state';
import { copyDisplayOptions } from '../editor/tools/view-display';
import { TabNavigationController } from './tab-navigation-controller';
import type { DocumentSessions } from './document-sessions';
import { isNotebookDocument } from '../../core/document/document-profile';
import { hasMarkdownPreview } from '../../core/document/document-capabilities';
import { documentSurface, isMarkdownDocument } from '../../core/document/document-profile';
import { retainUnsavedRevision } from '../../core/document/document-save';
import { fileLocation } from '../../core/document/file-location';
import { recordVisit } from '../../core/workspace/tab-navigation';
import { GOLDEN_TOP_RATIO, type ViewportAnchor } from '../../core/preview/viewport-anchor';
import { createWorkspaceTab, isDocumentTab, tabTitle, tabLocation, type DocumentTab, type TabSession, type WorkspaceState, type WorkspaceTab } from '../../core/workspace/workspace-state';
import type { ClaimedTabTransfer, CloseDecision, DocumentSnapshot, TransferableTab } from '../../protocol/desktop-api';
import type { MonacoEditor } from '../adapters/monaco-editor';
import type { SurfaceController } from './surface-controller';
import type { DesktopPort } from '../ports/desktop-port';
import type { PreviewSession } from '../reader/preview-session';
import type { ReaderController } from '../reader/reader-controller';
import { view } from './workspace-view.svelte';
import type { WorkingTreeEdit } from '../../core/document/text-edit';
import { restoredOutlineOpen } from '../shell/layout-session';
import { tick } from 'svelte';
import { MediaCache } from './media-cache';
import { groupLayout, type EditorGroupPlacement, type EditorOpenOptions } from '../../core/workspace/editor-groups';

type Options = {
  activateReview?(id: string): Promise<void>;
  closeReview?(id: string, confirmed?: boolean): Promise<void>;
  copyReview?(id: string, groupId: string, direction: import('../../core/workspace/editor-groups').SplitDirection | null): Promise<void>;
  documents: DocumentSessions;
  publishDocuments?(): void;
  desktop: DesktopPort; workspace: WorkspaceState; session: TabSession; shell: HTMLElement;
  editor: MonacoEditor; reader: ReaderController; preview: PreviewSession; surfaces: SurfaceController;
  capturePosition?(tab?: DocumentTab): void;
  shouldSchedulePreview(): boolean;
  confirmClose(names: string[]): Promise<CloseDecision>;
  workspaceChanged(): void;
  groupsChanged?(): void;
  shouldFocusWeb?(): boolean;
  reviewZoomId?(): string | null;
  autoSave?: { schedule(tab: DocumentContent): void; cancel(tabId?: string): void };
};
const TRANSFER_ANNOUNCE_GRACE_MS = 150;

export class TabController {
  private activation = 0;
  private readonly media = new MediaCache();
  private terminalNumber = 0;
  private readonly removalApprovals = new Map<string, Map<string, number>>();
  private readonly navigation: TabNavigationController;
  constructor(private readonly options: Options) {
    this.navigation = new TabNavigationController({
      ...options,
      confirmClose: names => options.confirmClose(names),
      capturePosition: tab => options.capturePosition?.(tab),
      text: tab => this.text(tab), dirty: tab => this.dirty(tab), acceptSaved: (tab, saved) => this.acceptSaved(tab, saved),
      documentTab: (id, snapshot) => this.documentTab(id, snapshot),
      restoreDocumentTab: tab => this.restoreDocumentTab(tab),
      saveActiveState: () => this.saveActiveState(), release: tab => this.release(tab),
      activate: (id, presentation, fresh) => this.activate(id, presentation, fresh), render: () => this.render(),
      invalidateActive: () => { ++this.activation; options.preview.newSession(); },
    });
  }
  text = (tab: WorkspaceTab | DocumentContent): string => 'document' in tab ? this.options.documents.text(tab) : '';
  dirty = (tab: WorkspaceTab | DocumentContent): boolean => {
    if ('document' in tab) return this.options.documents.dirty(tab);
    const content = tab.kind === 'diff' && tab.documentId ? this.options.workspace.documentStore.get(tab.documentId) : null;
    return !!content && this.options.documents.dirty(content);
  };
  currentText = (): string | null => {
    const tab = this.options.workspace.activeContent;
    return tab ? this.text(tab) : this.options.session.document?.text ?? null;
  };
  documentBuffer = (path: string): string | null => {
    const tab = this.options.workspace.contents.find((candidate) => !candidate.document.isUntitled && candidate.document.path === path);
    return tab ? this.text(tab) : null;
  };
  activateWorkingTreePath = async (path: string): Promise<boolean> => {
    const tab = this.options.workspace.documents.find((candidate) => !candidate.document.isUntitled && candidate.document.path === path);
    if (!tab) return false;
    this.pin(tab.id);
    await this.activate(tab.id, 'review');
    return true;
  };
  acceptWorkingTreeBuffer = (path: string, text: string, edits?: WorkingTreeEdit[]): void => {
    const { desktop, editor, preview, workspace } = this.options;
    const tab = workspace.documents.find((candidate) => !candidate.document.isUntitled && candidate.document.path === path);
    if (!tab || this.text(tab) === text) return;
    workspace.groups.pin(tab.id);
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

  reloadDocumentPaths = async (paths: string[], preserveChanges = false): Promise<void> => {
    const selected = new Set(paths);
    const { desktop, preview, reader, workspace } = this.options;
    const targets = workspace.contents.filter((tab) => !tab.document.isUntitled && selected.has(tab.document.path));
    let activeReloaded = false;
    for (const tab of targets) {
      const revision = tab.revision;
      if (preserveChanges && this.dirty(tab)) continue;
      let diskDocument: DocumentSnapshot | null = null;
      try { diskDocument = await desktop.readDocumentLocation(fileLocation(tab.document.path)); }
      catch (error) {
        // Decoder/permission failures must not masquerade as a discarded file.
        if (/ENOENT|no such file/i.test(String(error))) {
          for (const candidate of [...workspace.tabs]) if ('documentId' in candidate && candidate.documentId === documentIdentity(tab) || candidate.id === tab.id) await this.close(candidate.id, true);
        }
        else throw error;
        continue;
      }
      if (!diskDocument || (!workspace.documentStore.contains(tab) && workspace.find(tab.id) !== tab)
        || (preserveChanges && (this.dirty(tab) || tab.revision !== revision))) continue;
      const active = workspace.activeContent && documentIdentity(workspace.activeContent) === documentIdentity(tab);
      tab.document = diskDocument;
      for (const candidate of workspace.documents) if (documentIdentity(candidate) === documentIdentity(tab))
        Object.assign(candidate, { previewUrl: null, previewRevision: null, previewTheme: null });
      this.options.documents.replace(tab, diskDocument);
      if (active) {
        if (hasMarkdownPreview(diskDocument)) preview.reset();
        view.notice = false;
        activeReloaded = true;
      }
    }
    const active = workspace.activeDocument;
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
    return tab && isDocumentTab(tab) ? this.options.editor.lineCount(tab) : this.countLines(this.currentText() ?? '');
  };
  private saveActiveState(): void {
    const tab = this.options.workspace.active;
    if (!tab || !isDocumentTab(tab) || !this.options.session.document) return;
    this.options.capturePosition?.(tab);
    this.options.documents.saveView(tab);
    if (hasMarkdownPreview(tab.document) && this.options.preview.readyRevision !== null) {
      tab.previewRevision = this.options.preview.readyRevision;
    }
  }
  addWeb = async (page: import('../../protocol/browser').BrowserPage, background = false): Promise<void> => {
    const { workspace } = this.options;
    if (!workspace.find(page.id)) workspace.add({ kind: 'web', id: page.id, surface: 'web', page });
    this.render();
    if (!background) await this.activate(page.id);
  };
  openTerminal = async (cwd = ''): Promise<void> => {
    const id = crypto.randomUUID();
    const session = { id, title: `Terminal ${++this.terminalNumber}`, cwd, exited: false };
    this.options.workspace.terminals.set(id, session);
    this.options.workspace.add({ ...session, kind: 'terminal', sessionId: id, surface: 'terminal' });
    this.render(); await this.activate(id);
  };
  openTerminalSession = async (sessionId: string): Promise<void> => {
    const { workspace } = this.options;
    const session = workspace.terminals.get(sessionId);
    if (!session) return;
    const existing = workspace.tabs.find(tab => tab.kind === 'terminal' && (tab.sessionId ?? tab.id) === sessionId);
    if (existing) return this.activate(existing.id);
    if (workspace.activeId) { await this.navigateLocation(workspace.activeId, `terminal://${sessionId}`); return; }
    const id = crypto.randomUUID();
    workspace.add({ ...session, kind: 'terminal', id, sessionId, surface: 'terminal' });
    this.render(); await this.activate(id);
  };
  closeTerminalSession = async (sessionId: string): Promise<void> => {
    const { workspace, desktop } = this.options;
    for (const tab of [...workspace.tabs]) if (tab.kind === 'terminal' && (tab.sessionId ?? tab.id) === sessionId) await this.close(tab.id);
    workspace.terminals.delete(sessionId);
    desktop.terminal.close(sessionId);
    this.render();
  };
  terminalChanged = (id: string, info: { title?: string; cwd?: string; exited?: boolean }): void => {
    const { workspace } = this.options;
    const session = workspace.terminals.get(id);
    if (!session) return;
    // A shell's executable/window title does not rename its numbered session.
    if (info.cwd !== undefined) session.cwd = info.cwd;
    if (info.exited !== undefined) session.exited = info.exited;
    for (const tab of workspace.tabs) if (tab.kind === 'terminal' && (tab.sessionId ?? tab.id) === id) {
      tab.title = session.title; tab.cwd = session.cwd; tab.exited = session.exited;
    }
    this.updateChrome();
  };
  openWeb = async (input = 'https://www.google.com/', background = false): Promise<void> => {
    const page = await this.options.desktop.browser.create(crypto.randomUUID(), input);
    await this.addWeb(page, background);
  };
  browserClosed = (id: string): void => {
    // Closing a native page during a resource change must not close its tab.
    if (!this.navigation.isReplacing(id) && this.options.workspace.find(id)?.kind === 'web') void this.close(id, true);
  };
  canGoBack = (id: string): boolean => this.navigation.canGoBack(id);
  canGoForward = (id: string): boolean => this.navigation.canGoForward(id);
  webNavigated = (id: string): void => this.navigation.webNavigated(id);
  navigateHistory = (id: string, direction: -1 | 1): Promise<boolean> => this.navigation.navigateHistory(id, direction);
  navigateLocation = (id: string, input: string, historyIndex?: number): Promise<boolean> => this.navigation.navigateLocation(id, input, historyIndex);
  transferable = (tab: WorkspaceTab): TransferableTab => {
    if (tab.kind === 'diff') throw Error('Git review tabs can be moved between groups in this window. Cross-window transfer is not supported.');
    if (tab.kind === 'terminal') return { kind: 'terminal', id: tab.id, sessionId: tab.sessionId ?? tab.id,
      title: tab.title, cwd: tab.cwd, exited: tab.exited, navigation: tab.navigation };
    if (tab.kind === 'web') return { kind: 'web', id: tab.id, page: { ...tab.page }, navigation: tab.navigation };
    if (tab.id === this.options.workspace.activeId) this.saveActiveState();
    else this.options.documents.saveView(tab);
    const markdown = hasMarkdownPreview(tab.document);
    return { id: tab.id, document: tab.document, text: this.text(tab), revision: tab.revision, navigation: tab.navigation,
      surface: documentSurface(tab.document.path, tab.surface), anchor: tab.anchor, readingPosition: tab.readingPosition,
      editorViewState: this.options.editor.exportView(tab.id), viewerScrollRatio: markdown ? tab.viewerScrollRatio : null,
      previewUrl: markdown ? tab.previewUrl : null, previewRevision: markdown ? tab.previewRevision : null,
      previewTheme: markdown ? tab.previewTheme : null, tocOpen: markdown && tab.tocOpen };
  };
  render = (): void => {
    const { desktop, shell, workspace } = this.options;
    const summaries = workspace.tabs.map((tab) => {
      const dirty = this.dirty(tab);
      // Dirty documents never remain eligible for replacement, including shared models.
      if (dirty) workspace.groups.pin(tab.id);
      return { id: tab.id, name: tabTitle(tab), path: tabLocation(tab), kind: tab.kind,
        canGoBack: this.canGoBack(tab.id), canGoForward: this.canGoForward(tab.id),
        ...(tab.kind === 'web' ? { page: { ...tab.page } } : {}),
        ...(tab.kind === 'terminal' ? { exited: tab.exited, sessionId: tab.sessionId ?? tab.id } : {}),
        active: tab.id === workspace.activeId, dirty, preview: !workspace.groups.isPinned(tab.id) };
    });
    const visibleGroups = new Set(groupLayout(workspace.groups.displayTree).groups.map(group => group.id));
    view.groups = workspace.groups.groups.filter(group => visibleGroups.has(group.id)).map(group => ({ ...group, tabs: [...group.tabs] }));
    view.groupTree = structuredClone(workspace.groups.displayTree);
    view.focusedGroupId = workspace.groups.focusedId;
    view.tabs = summaries;
    this.options.publishDocuments?.();
    view.terminalSessions = [...workspace.terminals.values()].map(session => ({ ...session }));
    const review = this.options.reviewZoomId?.() ?? null;
    desktop.setZoomTabs?.([...workspace.tabs.map(tab => tab.id), ...(review ? [review] : [])], review ?? workspace.activeId);
    void tick().then(() => this.options.groupsChanged?.());
    view.hwpTabs = workspace.documents.filter(tab => tab.document.kind === 'hwp');
    view.mediaTabs = this.media.sync(workspace.documents, workspace.activeId, workspace.groups.groups.flatMap(g => g.activeId ? [g.activeId] : []));
    view.activeMediaId = workspace.activeDocument?.document.kind ? workspace.activeId : null;
    shell.dataset.tabs = summaries.length > 0 ? 'true' : 'false';
    shell.dataset.dirtyTabs = String(summaries.filter((tab) => tab.dirty).length);
    desktop.updateTabState(workspace.contents.map((tab) => ({ name: tab.document.name, path: tab.document.path,
      dirty: this.dirty(tab), isUntitled: tab.document.isUntitled })));
    this.options.workspaceChanged();
  };
  pin = (tabId: string): void => { if (this.options.workspace.groups.pin(tabId)) this.render(); };
  updateChrome = (): void => {
    const { document: activeDocument } = this.options.session;
    if (!activeDocument) { document.title = `${this.options.workspace.active ? tabTitle(this.options.workspace.active) + ' — ' : ''}Setdown`; this.render(); return; }
    const dirty = this.options.workspace.activeDocument ? this.dirty(this.options.workspace.activeDocument) : false;
    document.title = `${dirty ? '• ' : ''}${activeDocument.name} — Setdown`;
    this.render();
  };

  activate = async (tabId: string, presentation: 'document' | 'review' = 'document', fresh = false): Promise<void> => {
    const { desktop, editor, preview, reader, session, surfaces, workspace } = this.options;
    const next = workspace.find(tabId);
    if (!next) return;
    if (next.kind === 'diff') {
      ++this.activation;
      if (workspace.activeId !== next.id) { this.saveActiveState(); preview.newSession(); }
      workspace.activeId = next.id;
      reader.setSuspended(true);
      surfaces.set('diff');
      const content = workspace.activeContent;
      if (content) await desktop.activateDocument(content.document, content.text, content.revision);
      await this.options.activateReview?.(next.id);
      view.notice = false; this.updateChrome();
      return;
    }
    if (next.kind === 'terminal') {
      ++this.activation;
      if (workspace.activeId !== next.id) { this.saveActiveState(); this.options.autoSave?.cancel(); preview.newSession(); }
      workspace.activeId = next.id;
      editor.selectGroup(workspace.groups.focusedId);
      surfaces.set('terminal'); view.notice = false; this.updateChrome();
      await tick();
      if (workspace.activeId === next.id) window.dispatchEvent(new CustomEvent('setdown:focus-terminal', { detail: next.id }));
      return;
    }
    if (next.kind === 'web') {
      const activation = ++this.activation;
      if (workspace.activeId !== next.id) { this.saveActiveState(); this.options.autoSave?.cancel(); preview.newSession(); }
      workspace.activeId = next.id;
      editor.selectGroup(workspace.groups.focusedId);
      surfaces.set('web'); view.notice = false; this.updateChrome();
      try {
        next.page = await desktop.browser.create(next.id, next.page.url);
        this.render();
        if (activation === this.activation && workspace.activeId === next.id) {
          await tick(); this.options.groupsChanged?.();
          // Activating an inactive split starts on pointerdown, before the
          // address input takes focus. Recheck after the async create/layout:
          // a newer address/find edit owns the keyboard, not the page below it.
          await desktop.browser.command(next.id, this.options.shouldFocusWeb?.() === false ? 'activate' : 'focus');
        }
      } catch (error) { next.page.error = String(error); this.render(); }
      return;
    }
    const reviewing = presentation === 'review';
    // Review needs the live document/session, not its ordinary reader. Suspend
    // before resetting sessions or updating UI, which can otherwise show it.
    if (reviewing) reader.setSuspended(true);
    next.surface = documentSurface(next.document.path, next.surface);
    if (tabId === workspace.activeId && !fresh) {
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
    // Focusing a continuously mounted text editor must retain its live scroll
    // and the caret placed by this click, even if its saved position is older.
    // Check before loading/selecting the group: a newly mounted editor still
    // needs restoration against the final shell geometry.
    const preserveEditorView = next.surface === 'editor' && !hasMarkdownPreview(next.document) && editor.hasLiveView(next);
    const restoreAnchor = next.readingPosition?.kind === 'text' ? { ...next.anchor } : null;
    next.restoringPosition = !!restoreAnchor && !preserveEditorView;
    if (!reviewing && next.surface === 'editor') await editor.load();
    if (activation !== this.activation || workspace.find(next.id) !== next) return;
    if (!fresh) this.saveActiveState();
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
      if (!preserveEditorView && next.surface === 'editor' && next.readingPosition?.kind === 'text' && next.readingPosition.editorView) {
        // The empty shell hides Monaco and removes its chrome inset. Restore
        // only against the mounted group's final height, including its address
        // bar, so a clamped hidden viewport cannot shift the saved first line.
        await tick();
        if (activation !== this.activation || workspace.activeId !== next.id) return;
        editor.restoreView(next);
      }
      if (!preserveEditorView && restoreAnchor && next.surface === 'editor'
        && !(next.readingPosition?.kind === 'text' && next.readingPosition.editorView)) editor.reveal(restoreAnchor);
      next.restoringPosition = false;
      // Newly mounted editors suppress position recording during restoration.
      // Capture the final view once that fence opens.
      if (next.surface === 'editor') this.options.capturePosition?.(next);
      return;
    }
    if (preview.readyRevision === session.revision) { next.restoringPosition = false; preview.updateUi(); return; }
    const ready = await preview.ensure(session.revision);
    if (ready && next.surface === 'viewer' && activation === this.activation) {
      await preview.position(restoreAnchor ?? session.anchor, session.revision);
    }
    next.restoringPosition = false;
  };

  close = async (tabId: string, confirmed = false): Promise<boolean> => {
    const replacing = this.navigation.cancel(tabId);
    if (replacing) await replacing.catch(() => false);
    const { desktop, editor, preview, session, surfaces, workspace } = this.options;
    let index = workspace.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return true;
    const tab = workspace.tabs[index];
    if (tab.kind === 'diff') { await this.options.closeReview?.(tab.id, confirmed); return !workspace.find(tab.id); }
    if (tab.kind === 'web') {
      if (!confirmed) {
        try { if (!await desktop.browser.close(tab.id, true)) return false; }
        catch (error) { tab.page.error = String(error); this.render(); return false; }
      }
    }
    if (isDocumentTab(tab) && this.dirty(tab) && !confirmed
      && (!tab.documentId || (workspace.documentStore.get(tab.documentId)?.references.size ?? 0) <= 1)) {
      const revision = tab.revision;
      const decision = await this.options.confirmClose([tab.document.name]);
      if (decision === 'cancel') return false;
      if (decision === 'discard' && tab.revision !== revision) return false;
      if (decision === 'save') {
        await this.options.documents.beforeSave(tab);
        if (workspace.find(tab.id) !== tab) return true;
        const result = await this.options.documents.save(tab);
        if (result.canceled || !result.document) return false;
        await this.acceptSaved(tab, result.document);
        if (this.dirty(tab)) return false;
      }
    }
    if (isDocumentTab(tab) && tab.document.isUntitled
      && (!tab.documentId || (workspace.documentStore.get(tab.documentId)?.references.size ?? 0) <= 1)) await desktop.discardDocument(tab.document);
    index = workspace.tabs.findIndex((candidate) => candidate.id === tabId);
    if (index < 0 || workspace.tabs[index] !== tab) return true;
    if (workspace.activeId === tab.id) this.saveActiveState();
    const removed = workspace.remove(tab.id);
    if (!removed) return true;
    this.release(tab);
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
    this.removalApprovals.delete(entryPath);
    const affected = this.options.workspace.contents.filter((tab) => this.pathUnder(tab.document.path, entryPath));
    const dirty = affected.filter(this.dirty);
    if (dirty.length) {
      const decision = await this.options.confirmClose(dirty.map((tab) => tab.document.name));
      if (decision === 'cancel') return false;
      if (decision === 'save') for (const tab of dirty) {
        await this.options.documents.beforeSave(tab);
        if (!this.options.workspace.contents.includes(tab)) continue;
        const result = await this.options.documents.save(tab);
        if (result.canceled || !result.document) return false;
        await this.acceptSaved(tab, result.document);
        if (this.dirty(tab)) return false;
      }
    }
    this.removalApprovals.set(entryPath, new Map(affected.map(tab => [tab.id, tab.revision])));
    return true;
  };

  commitRemove = async (entryPath: string): Promise<void> => {
    const approved = this.removalApprovals.get(entryPath);
    this.removalApprovals.delete(entryPath);
    const affected = this.options.workspace.contents.filter(tab => this.pathUnder(tab.document.path, entryPath));
    // New edits made while the OS trash job was pending were never approved for
    // discard. Retain their buffer; autosave skips the now-missing backing file.
    for (const content of affected) if (approved?.get(content.id) === content.revision) {
      const views = this.options.workspace.tabs.filter(tab => isDocumentTab(tab) ? documentIdentity(tab) === documentIdentity(content) : tab.kind === 'diff' && tab.documentId === documentIdentity(content));
      for (const tab of views) await this.close(tab.id, true);
    }
  };

  /** One path-change boundary for Save As and Explorer rename/move. */
  private async retarget(tab: DocumentTab, previousPath: string): Promise<void> {
    const { desktop, editor, preview, reader, surfaces, workspace } = this.options;
    const wasMarkdown = isMarkdownDocument(previousPath);
    const markdown = hasMarkdownPreview(tab.document);
    if (wasMarkdown && !markdown) reader.destroy(tab.id);
    if (!wasMarkdown && markdown) reader.create(tab.id);
    Object.assign(tab, { previewUrl: null, previewRevision: null, previewTheme: null });
    if (!markdown) Object.assign(tab, { surface: documentSurface(tab.document.path), tocOpen: false, headings: [], activeHeadingId: null,
      viewerScrollRatio: null, find: { open: false, query: '', activeMatch: 0, matches: 0 } });
    // Publish ownership of the new path before any language-server open IPC.
    this.updateChrome();
    this.options.documents.retarget(tab);
    if (workspace.activeId !== tab.id) return;
    if (wasMarkdown || markdown) preview.reset();
    if (!markdown && tab.surface === 'editor' && tab.document.kind === undefined && !editor.loaded) await editor.load();
    if (workspace.activeId !== tab.id || !workspace.find(tab.id)) return;
    surfaces.set(tab.surface);
    await desktop.activateDocument(tab.document, this.text(tab), tab.revision);
    if (workspace.activeId !== tab.id || !hasMarkdownPreview(tab.document)) return;
    if (tab.surface === 'viewer') await preview.ensure(tab.revision);
    else preview.schedule(tab.revision);
  }

  acceptSaved = async (tab: DocumentContent, saved: DocumentSnapshot): Promise<void> => {
    const workspace = this.options.workspace;
    if (!workspace.documentStore.contains(tab) && workspace.find(tab.id) !== tab) return;
    const views = workspace.documents.filter(view => documentIdentity(view) === documentIdentity(tab));
    for (const view of views) workspace.groups.pin(view.id);
    const oldPath = tab.document.path;
    const text = this.text(tab);
    const revision = tab.revision;
    tab.document = retainUnsavedRevision(saved, text, revision);
    tab.revision = tab.document.revision;
    tab.text = tab.document.text;
    // Only actual draft-asset text rewriting replaces content, not a pure rename.
    if (text !== tab.document.text) this.options.documents.replace(tab, tab.document);
    if (oldPath !== saved.path) {
      for (const view of views) await this.retarget(view, oldPath);
      this.options.editor.retarget(tab);
    }
    this.options.documents.saved(tab);
    this.updateChrome();
  };

  relocatePath = async (from: string, to: string): Promise<void> => {
    const { workspace } = this.options;
    for (const content of workspace.contents) {
      if (!this.pathUnder(content.document.path, from)) continue;
      const previousPath = content.document.path;
      const nextPath = `${to}${previousPath.slice(from.length)}`;
      const collision = workspace.contents.find(other => other.id !== content.id && other.document.path === nextPath);
      if (collision) throw Error('The destination is already open as another document. Close that document before moving this file.');
      const views = workspace.documents.filter(tab => documentIdentity(tab) === documentIdentity(content));
      content.text = this.text(content);
      content.document = { ...content.document, path: nextPath,
        name: nextPath.split(/[\\/]/).at(-1) || content.document.name };
      for (const tab of views) await this.retarget(tab, previousPath);
      this.options.editor.retarget(content);
    }
    this.updateChrome();
  };
  removeTransferred = async (tabId: string): Promise<void> => {
    const { desktop, preview, session, surfaces, workspace } = this.options;
    const removed = workspace.remove(tabId);
    if (!removed) return;
    const { tab } = removed;
    if (tab.kind === 'terminal') workspace.terminals.delete(tab.sessionId ?? tab.id);
    if (!removed.wasActive) { this.release(tab); return this.render(); }
    const replacement = workspace.replacement(removed.index);
    if (replacement) { await this.activate(replacement.id); this.release(tab); return; }
    this.release(tab);
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
  editorChanged = (tab: DocumentContent, text: string): void => {
    const { desktop, preview, workspace } = this.options;
    if (!workspace.documentStore.contains(tab) && workspace.find(tab.id) !== tab) return;
    const views = workspace.documents.filter(view => documentIdentity(view) === documentIdentity(tab));
    for (const view of views) workspace.groups.pin(view.id);
    tab.text = text;
    tab.revision += 1;
    const active = workspace.activeDocument;
    const ownsActive = workspace.activeContent && documentIdentity(workspace.activeContent) === documentIdentity(tab);
    if (ownsActive) desktop.updateText(text, tab.revision);
    this.updateChrome();
    if (ownsActive && hasMarkdownPreview(tab.document) && active?.surface === 'editor' && this.options.shouldSchedulePreview()) preview.schedule(tab.revision);
    this.options.autoSave?.schedule(tab);
  };
  installModel = (documentSnapshot: DocumentSnapshot): void => {
    const tab = this.options.workspace.active;
    if (tab && isDocumentTab(tab)) this.options.documents.replace(tab, documentSnapshot);
  };
  /** Load a language edit target as an ordinary, unsaved-capable tab without stealing focus. */
  prepareLanguageDocument = async (path: string, groupId?: string): Promise<DocumentTab> => {
    const { workspace } = this.options;
    const inGroup = (tab: DocumentTab) => !groupId || workspace.groups.owner(tab.id)?.id === groupId;
    const existing = workspace.documents.find(tab => inGroup(tab) && tab.document.path === path && !tab.document.isUntitled);
    if (existing) { if (isNotebookDocument(path)) throw Error('Edit notebook cells in the notebook tab.'); return existing; }
    const document = await this.options.desktop.readDocumentLocation(fileLocation(path));
    if (document.kind !== undefined || isNotebookDocument(path)) throw new Error('Language edits require an ordinary text document.');
    // A concurrent definition/rename may have opened it during the disk read.
    if (groupId && !workspace.groups.groups.some(group => group.id === groupId)) throw Error('The requesting editor group was closed.');
    const opened = workspace.documents.find(tab => inGroup(tab) && tab.document.path === document.path);
    if (opened) return opened;
    const tab = this.documentTab(crypto.randomUUID(), document, 'editor');
    const activeId = workspace.activeId;
    workspace.add(tab, true, groupId ?? workspace.groups.focusedId);
    if (activeId) workspace.groups.activate(activeId);
    this.restoreDocumentTab(tab);
    this.render(); this.updateChrome();
    return tab;
  };
  show = async (documentSnapshot: DocumentSnapshot, initialSurface: 'viewer' | 'editor' | 'pdf' | 'image' | 'video' | 'notebook' = 'viewer',
    presentation: 'document' | 'review' = 'document', placement?: EditorGroupPlacement, openOptions: EditorOpenOptions = {}): Promise<void> => {
    const { editor, workspace } = this.options;
    const requested = placement?.groupId ?? openOptions.groupId ?? workspace.groups.focusedId;
    if (!workspace.groups.groups.some(group => group.id === requested)) return;
    // Singleton content owners must be resolved before allocating a split.
    if (!documentSnapshot.isUntitled && (documentSnapshot.kind || isNotebookDocument(documentSnapshot.path))) {
      const singleton = workspace.documents.find(tab => tab.document.path === documentSnapshot.path);
      if (singleton) return void await this.activate(singleton.id, presentation);
    }
    const target = placement?.direction ? workspace.groups.split(requested, placement.direction)
      : openOptions.side ? workspace.groups.side(requested) : workspace.groups.groups.find(group => group.id === requested)!;
    if (!documentSnapshot.isUntitled) {
      const existing = workspace.documents.find(tab => target.tabs.includes(tab.id)
        && !tab.document.isUntitled && tab.document.path === documentSnapshot.path);
      if (existing) {
        if (openOptions.pinned !== false || placement || presentation === 'review') this.pin(existing.id);
        return void await this.activate(existing.id, presentation);
      }
    }
    const id = crypto.randomUUID();
    const created = this.documentTab(id, documentSnapshot, initialSurface);
    this.restoreDocumentTab(created);
    const pinned = openOptions.pinned !== false || !!placement || presentation === 'review'
      || documentSnapshot.isUntitled || this.dirty(created);
    const previous = pinned ? null : workspace.find(target.previewId ?? '');
    if (previous && this.dirty(previous)) workspace.groups.pin(previous.id);
    if (previous?.id === workspace.activeId) this.saveActiveState();
    const replaced = workspace.add(created, pinned, target.id);
    if (replaced) {
      created.navigation = this.navigation.history(replaced);
      const outgoing = this.navigation.visit(replaced);
      if (outgoing) created.navigation.entries[created.navigation.index] = outgoing;
      const incoming = this.navigation.visit(created);
      if (incoming) recordVisit(created.navigation, incoming);
      this.release(replaced);
    }
    if (placement?.index !== undefined) workspace.groups.move(id, target.id, null, placement.index);
    this.render();
    await this.activate(id, presentation);
    if (presentation === 'document' && created.surface === 'viewer' && hasMarkdownPreview(documentSnapshot)) window.setTimeout(() => {
      void editor.load().catch((error) => console.error('Failed to load editor', error));
    }, 0);
  };
  copyToGroup = async (id: string, groupId: string, direction: import('../../core/workspace/editor-groups').SplitDirection | null = null): Promise<void> => {
    const { workspace, editor } = this.options;
    const source = workspace.find(id);
    if (source?.kind === 'diff') { await this.options.copyReview?.(id, groupId, direction); return; }
    if (!source || !isDocumentTab(source) || !source.documentId || !workspace.groups.groups.some(group => group.id === groupId)) return;
    if (!direction && workspace.groups.owner(id)?.id === groupId) { await this.activate(id); return; }
    editor.saveView(source);
    const initialView = editor.exportView(source.id);
    const target = direction ? workspace.groups.split(groupId, direction) : workspace.groups.groups.find(group => group.id === groupId)!;
    const existing = workspace.documents.find(tab => target.tabs.includes(tab.id) && tab.documentId === source.documentId);
    if (existing) { this.pin(existing.id); await this.activate(existing.id); return; }
    const copy = this.documentTab(crypto.randomUUID(), source.document, source.surface);
    copyDisplayOptions(source.id, copy.id);
    copy.anchor = { ...source.anchor }; copy.surface = source.surface;
    workspace.add(copy, true, target.id);
    this.restoreDocumentTab(copy);
    editor.importView(copy.id, initialView);
    this.render(); await this.activate(copy.id);
  };
  moveToGroup = async (id: string, placement: EditorGroupPlacement): Promise<void> => {
    const { workspace } = this.options;
    const source = workspace.find(id), target = workspace.groups.groups.find(group => group.id === placement.groupId);
    if (!source || !target) return;
    const existing = !placement.direction && workspace.tabs.find(tab => tab.id !== id && target.tabs.includes(tab.id)
      && editorInputKey(tab) === editorInputKey(source));
    if (existing) {
      // The destination already retains the same content. Closing the source
      // cannot discard its buffer or ask for a redundant save.
      await this.close(id); await this.activate(existing.id); return;
    }
    if (isDocumentTab(source)) this.options.documents.saveView(source);
    workspace.groups.move(id, placement.groupId, placement.direction, placement.index);
    this.render(); await this.activate(id);
  };
  convertReviewToFile = (id: string): void => {
    const { workspace } = this.options;
    const review = workspace.find(id);
    const content = review?.kind === 'diff' && review.documentId ? workspace.documentStore.get(review.documentId) : null;
    if (!review || !content) return;
    const group = workspace.groups.owner(id);
    const existing = workspace.documents.find(tab => group?.tabs.includes(tab.id) && documentIdentity(tab) === content.id);
    if (existing) {
      const wasActive = workspace.activeId === id;
      workspace.remove(id); workspace.documentStore.release(content.id, id);
      if (wasActive) void this.activate(existing.id);
      this.render(); return;
    }
    const tab = this.documentTab(id, content.document, 'editor');
    workspace.documentStore.attach(tab);
    workspace.tabs[workspace.tabs.indexOf(review)] = tab;
    this.restoreDocumentTab(tab); this.render();
    if (workspace.activeId === id) void this.activate(id, 'document', true);
  };
  private documentTab(id: string, snapshot: DocumentSnapshot, surface: DocumentTab['surface'] = 'viewer'): DocumentTab {
    const saved = snapshot.readingPosition;
    const tab = createWorkspaceTab(id, snapshot,
      documentSurface(snapshot.path, saved?.kind === 'text' ? saved.surface : surface), {
        sourceLine: 1, yRatio: GOLDEN_TOP_RATIO, reason: 'empty-document', confidence: 'fallback',
      });
    if (saved?.kind === 'text') tab.anchor = { ...saved.anchor, sourceLine: Math.min(saved.anchor.sourceLine, this.countLines(tab.text)) };
    tab.tocOpen = hasMarkdownPreview(snapshot) && restoredOutlineOpen();
    return tab;
  }
  private restoreDocumentTab(tab: DocumentTab): void {
    if (hasMarkdownPreview(tab.document)) this.options.reader.create(tab.id);
    const saved = tab.readingPosition;
    if (saved?.kind === 'text' && saved.editorView) this.options.editor.importView(tab.id, saved.editorView);
  }
  private release(tab: WorkspaceTab): void {
    if (!isDocumentTab(tab)) return;
    if (!tab.documentId || (this.options.workspace.documentStore.get(tab.documentId)?.references.size ?? 0) <= 1)
      this.options.autoSave?.cancel(documentIdentity(tab));
    if (hasMarkdownPreview(tab.document)) this.options.reader.destroy(tab.id);
    this.options.documents.release(tab.id);
    if (tab.documentId) this.options.workspace.documentStore.release(tab.documentId, tab.id);
  }
  installTransferred = async (transfer: ClaimedTabTransfer, placement?: EditorGroupPlacement): Promise<void> => {
    const { desktop, editor, preview, reader, shell, surfaces, workspace } = this.options;
    const incoming = transfer.tab;
    if (incoming.kind !== 'web' && incoming.kind !== 'terminal'
      && workspace.contents.some(content => content.document.path === incoming.document.path)) {
      desktop.cancelTabTransfer(transfer.transferId);
      window.alert('This file is already open in this window. The source tab and its unsaved content were kept.');
      return;
    }
    if (incoming.kind === 'terminal') {
      if (!await desktop.adoptTabTransfer(transfer.transferId)) return;
      const sessionId = incoming.sessionId ?? incoming.id;
      workspace.terminals.set(sessionId, { id: sessionId, title: incoming.title, cwd: incoming.cwd, exited: incoming.exited });
      this.terminalNumber = Math.max(this.terminalNumber, Number(incoming.title.match(/^Terminal (\d+)$/)?.[1] ?? 0));
      workspace.add({ ...incoming, surface: 'terminal' });
      if (placement) workspace.groups.move(incoming.id, placement.groupId, placement.direction, placement.index);
      this.render(); await this.activate(incoming.id); desktop.completeTabTransfer(transfer.transferId); return;
    }
    if (incoming.kind === 'web') {
      if (!await desktop.adoptTabTransfer(transfer.transferId)) return;
      workspace.add({ kind: 'web', id: incoming.id, surface: 'web', page: incoming.page, navigation: incoming.navigation });
      if (placement) workspace.groups.move(incoming.id, placement.groupId, placement.direction, placement.index);
      this.render(); await this.activate(incoming.id); desktop.completeTabTransfer(transfer.transferId); return;
    }
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
    restored.navigation = incoming.navigation;
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
    const tab = this.options.workspace.activeDocument;
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
