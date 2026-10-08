import { hasUnsavedText } from '../../core/document/document-state';
import { hasMarkdownPreview } from '../../core/document/document-capabilities';
import { documentSurface, isMarkdownDocument } from '../../core/document/document-profile';
import { retainUnsavedRevision } from '../../core/document/document-save';
import { isFileLocation } from '../../core/document/file-location';
import { browserURL } from '../../core/browser/browser-url';
import { GOLDEN_TOP_RATIO, type ViewportAnchor } from '../../core/preview/viewport-anchor';
import { createWorkspaceTab, tabTitle, tabLocation, type DocumentTab, type TabSession, type WorkspaceState, type WorkspaceTab } from '../../core/workspace/workspace-state';
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
import type { EditorGroupPlacement, EditorOpenOptions } from '../../core/workspace/editor-groups';

type Options = {
  desktop: DesktopPort; workspace: WorkspaceState; session: TabSession; shell: HTMLElement;
  editor: MonacoEditor; reader: ReaderController; preview: PreviewSession; surfaces: SurfaceController;
  capturePosition?(tab?: DocumentTab): void;
  shouldSchedulePreview(): boolean;
  confirmClose(names: string[]): Promise<CloseDecision>;
  workspaceChanged(): void;
  groupsChanged?(): void;
  autoSave?: { schedule(tab: DocumentTab): void; cancel(tabId?: string): void };
};
const TRANSFER_ANNOUNCE_GRACE_MS = 150;

export class TabController {
  private activation = 0;
  private readonly media = new MediaCache();
  private readonly navigationRequests = new Map<string, symbol>();
  private readonly navigationTasks = new Map<string, Promise<boolean>>();
  private readonly replacing = new Set<string>();
  constructor(private readonly options: Options) {}
  text = (tab: WorkspaceTab): string => tab.kind === 'web' ? '' : this.options.editor.text(tab);
  dirty = (tab: WorkspaceTab): boolean => tab.kind !== 'web' && hasUnsavedText(tab.document, this.text(tab));
  currentText = (): string | null => {
    const tab = this.options.workspace.active;
    return tab ? this.text(tab) : this.options.session.document?.text ?? null;
  };
  documentBuffer = (path: string): string | null => {
    const tab = this.options.workspace.documents.find((candidate) => !candidate.document.isUntitled && candidate.document.path === path);
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

  reloadDocumentPaths = async (paths: string[]): Promise<void> => {
    const selected = new Set(paths);
    const { desktop, editor, preview, reader, session, workspace } = this.options;
    const targets = workspace.documents.filter((tab) => !tab.document.isUntitled && selected.has(tab.document.path));
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
      if (!diskDocument || workspace.find(tab.id) !== tab) continue;
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
    return tab && tab.kind !== 'web' ? this.options.editor.lineCount(tab) : this.countLines(this.currentText() ?? '');
  };
  private saveActiveState(): void {
    const tab = this.options.workspace.active;
    if (!tab || tab.kind === 'web' || !this.options.session.document) return;
    this.options.capturePosition?.(tab);
    this.options.editor.saveView(tab);
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
  openWeb = async (input = 'about:blank', background = false): Promise<void> => {
    const page = await this.options.desktop.browser.create(crypto.randomUUID(), input);
    await this.addWeb(page, background);
    if (!background && page.url === 'about:blank') window.dispatchEvent(new Event('setdown:focus-location'));
  };
  browserClosed = (id: string): void => {
    // Closing a native page during a resource change must not close its tab.
    if (!this.replacing.has(id) && this.options.workspace.find(id)?.kind === 'web') void this.close(id, true);
  };
  navigateLocation = (id: string, input: string): Promise<boolean> => {
    const { desktop, workspace } = this.options;
    const request = Symbol();
    this.navigationRequests.set(id, request);
    let prepared: Promise<string | DocumentSnapshot>;
    try {
      prepared = isFileLocation(input) ? desktop.readDocumentLocation(input.trim()) : Promise.resolve(browserURL(input));
    } catch (error) {
      if (!this.navigationTasks.has(id)) this.navigationRequests.delete(id);
      return Promise.reject(error);
    }
    // Reads may finish out of order. Commits are serialized per tab so a new
    // request cannot reuse an ID while its old native page is still closing.
    const ready = prepared.then(value => ({ value }), error => ({ error }));
    const previous = this.navigationTasks.get(id) ?? Promise.resolve(false);
    const task = previous.catch(() => false).then(async () => {
      const result = await ready;
      const current = () => workspace.find(id) && this.navigationRequests.get(id) === request;
      if (!current()) return false;
      if ('error' in result) throw result.error;
      const destination = result.value;
      const tab = workspace.find(id)!;
      if (typeof destination === 'string' && tab.kind === 'web') {
        workspace.groups.pin(id);
        await desktop.browser.navigate(id, destination);
        return true;
      }
      if (typeof destination !== 'string' && tab.kind !== 'web' && destination.path === tab.document.path) return true;
      this.replacing.add(id);
      let createdWeb = false;
      try {
        if (tab.kind !== 'web' && this.dirty(tab)) {
          const decision = await this.options.confirmClose([tab.document.name]);
          if (!current() || decision === 'cancel') return false;
          if (decision === 'save') {
            const saved = await desktop.saveTabDocument(tab.document, this.text(tab), tab.revision);
            if (saved.canceled || !saved.document) return false;
            await this.acceptSaved(tab, saved.document);
            if (!current() || this.dirty(tab)) return false;
          }
        }
        if (!current() || workspace.find(id) !== tab) return false;
        let replacement: WorkspaceTab;
        if (typeof destination === 'string') {
          const page = await desktop.browser.create(id, destination);
          createdWeb = true;
          if (!current()) { await desktop.browser.close(id); return false; }
          replacement = { kind: 'web', id, surface: 'web', page };
        } else {
          // A rejected beforeunload leaves the live web page and tab intact.
          if (tab.kind === 'web' && !await desktop.browser.close(id)) return false;
          replacement = this.documentTab(id, destination);
        }
        if (workspace.activeId === id) this.saveActiveState();
        else if (tab.kind !== 'web') { this.options.capturePosition?.(tab); this.options.editor.saveView(tab); }
        if (tab.kind !== 'web' && tab.document.isUntitled) await desktop.discardDocument(tab.document);
        const index = workspace.tabs.indexOf(tab);
        if (index < 0) return false;
        const active = workspace.activeId === id;
        if (active) { ++this.activation; this.options.preview.newSession(); }
        this.release(tab);
        workspace.tabs[index] = replacement;
        workspace.groups.pin(id);
        if (replacement.kind !== 'web') this.restoreDocumentTab(replacement);
        this.render();
        if (active) await this.activate(id, 'document', true);
        if (replacement.kind !== 'web' && replacement.surface === 'viewer' && hasMarkdownPreview(replacement.document)) {
          window.setTimeout(() => void this.options.editor.load().catch(error => console.error('Failed to load editor', error)), 0);
        }
        return true;
      } catch (error) {
        if (createdWeb && workspace.find(id) === tab) await desktop.browser.close(id).catch(() => {});
        throw error;
      } finally { this.replacing.delete(id); }
    });
    this.navigationTasks.set(id, task);
    const cleanup = () => {
      if (this.navigationTasks.get(id) === task) {
        this.navigationTasks.delete(id);
        this.navigationRequests.delete(id);
      }
    };
    void task.then(cleanup, cleanup);
    return task;
  };
  transferable = (tab: WorkspaceTab): TransferableTab => {
    if (tab.kind === 'web') return { kind: 'web', id: tab.id, page: { ...tab.page } };
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
    const summaries = workspace.tabs.map((tab) => {
      const dirty = this.dirty(tab);
      // Dirty documents never remain eligible for replacement, including shared models.
      if (dirty) workspace.groups.pin(tab.id);
      return { id: tab.id, name: tabTitle(tab), path: tabLocation(tab), kind: tab.kind,
        ...(tab.kind === 'web' ? { page: { ...tab.page } } : {}),
        active: tab.id === workspace.activeId, dirty, preview: !workspace.groups.isPinned(tab.id) };
    });
    view.groups = workspace.groups.groups.map(group => ({ ...group, tabs: [...group.tabs] }));
    view.groupTree = structuredClone(workspace.groups.tree);
    view.focusedGroupId = workspace.groups.focusedId;
    view.tabs = summaries;
    void tick().then(() => this.options.groupsChanged?.());
    view.mediaTabs = this.media.sync(workspace.documents, workspace.activeId, workspace.groups.groups.flatMap(g => g.activeId ? [g.activeId] : []));
    view.activeMediaId = workspace.activeDocument?.document.kind ? workspace.activeId : null;
    shell.dataset.tabs = summaries.length > 0 ? 'true' : 'false';
    shell.dataset.dirtyTabs = String(summaries.filter((tab) => tab.dirty).length);
    desktop.updateTabState(workspace.documents.map((tab) => ({ name: tab.document.name, path: tab.document.path,
      dirty: this.dirty(tab), isUntitled: tab.document.isUntitled })));
    this.options.workspaceChanged();
  };
  pin = (tabId: string): void => { if (this.options.workspace.groups.pin(tabId)) this.render(); };
  updateChrome = (): void => {
    const { document: activeDocument } = this.options.session;
    if (!activeDocument) { document.title = `${this.options.workspace.active ? tabTitle(this.options.workspace.active) + ' — ' : ''}Setdown`; this.render(); return; }
    const dirty = hasUnsavedText(activeDocument, this.currentText() ?? activeDocument.text);
    document.title = `${dirty ? '• ' : ''}${activeDocument.name} — Setdown`;
    this.render();
  };

  activate = async (tabId: string, presentation: 'document' | 'review' = 'document', fresh = false): Promise<void> => {
    const { desktop, editor, preview, reader, session, surfaces, workspace } = this.options;
    const next = workspace.find(tabId);
    if (!next) return;
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
          await desktop.browser.command(next.id, 'focus');
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
    const restoreAnchor = next.readingPosition?.kind === 'text' ? { ...next.anchor } : null;
    next.restoringPosition = !!restoreAnchor;
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
      if (next.surface === 'editor' && next.readingPosition?.kind === 'text' && next.readingPosition.editorView) {
        // The empty shell hides Monaco and removes its chrome inset. Restore
        // only against the mounted group's final height, including its address
        // bar, so a clamped hidden viewport cannot shift the saved first line.
        await tick();
        if (activation !== this.activation || workspace.activeId !== next.id) return;
        editor.restoreView(next);
      }
      if (restoreAnchor && next.surface === 'editor' && !(next.readingPosition?.kind === 'text' && next.readingPosition.editorView)) editor.reveal(restoreAnchor);
      next.restoringPosition = false;
      // Cursor/scroll events during activation are deliberately suppressed by
      // the position recorder. Capture the final view once that fence opens.
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
    this.navigationRequests.delete(tabId);
    if (this.replacing.has(tabId)) await this.navigationTasks.get(tabId)?.catch(() => false);
    const { desktop, editor, preview, session, surfaces, workspace } = this.options;
    let index = workspace.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return true;
    const tab = workspace.tabs[index];
    if (tab.kind === 'web') {
      if (!confirmed) {
        try { if (!await desktop.browser.close(tab.id)) return false; }
        catch (error) { tab.page.error = String(error); this.render(); return false; }
      }
    }
    if (tab.kind !== 'web' && this.dirty(tab) && !confirmed) {
      const decision = await this.options.confirmClose([tab.document.name]);
      if (decision === 'cancel') return false;
      if (decision === 'save') {
        const result = await desktop.saveTabDocument(tab.document, this.text(tab), tab.revision);
        if (result.canceled || !result.document) return false;
        await this.acceptSaved(tab, result.document);
        if (this.dirty(tab)) return false;
      }
    }
    if (tab.kind !== 'web' && tab.document.isUntitled) await desktop.discardDocument(tab.document);
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
    const affected = this.options.workspace.documents.filter((tab) => this.pathUnder(tab.document.path, entryPath));
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
  private async retarget(tab: DocumentTab, previousPath: string): Promise<void> {
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

  acceptSaved = async (tab: DocumentTab, saved: DocumentSnapshot): Promise<void> => {
    if (this.options.workspace.find(tab.id) !== tab) return;
    this.options.workspace.groups.pin(tab.id);
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
    for (const tab of workspace.documents) {
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
  editorChanged = (tab: DocumentTab, text: string): void => {
    const { desktop, preview, workspace } = this.options;
    if (workspace.find(tab.id) !== tab) return;
    workspace.groups.pin(tab.id);
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
    if (tab && tab.kind !== 'web') this.options.editor.replace(tab, documentSnapshot);
  };
  show = async (documentSnapshot: DocumentSnapshot, initialSurface: 'viewer' | 'editor' | 'pdf' | 'image' | 'video' = 'viewer',
    presentation: 'document' | 'review' = 'document', placement?: EditorGroupPlacement, openOptions: EditorOpenOptions = {}): Promise<void> => {
    const { editor, workspace } = this.options;
    if (!documentSnapshot.isUntitled) {
      const existing = workspace.documents.find((tab) => !tab.document.isUntitled && tab.document.path === documentSnapshot.path);
      if (existing) {
        // A preview request never demotes an already pinned editor.
        if (openOptions.pinned !== false || placement || presentation === 'review') this.pin(existing.id);
        if (placement) {
          if (existing.id === workspace.activeId) this.saveActiveState(); else editor.saveView(existing);
          workspace.groups.move(existing.id, placement.groupId, placement.direction, placement.index);
          this.render();
        }
        return void await this.activate(existing.id, presentation);
      }
    }
    const id = crypto.randomUUID();
    const created = this.documentTab(id, documentSnapshot, initialSurface);
    this.restoreDocumentTab(created);
    const pinned = openOptions.pinned !== false || !!placement || presentation === 'review'
      || documentSnapshot.isUntitled || this.dirty(created);
    const previous = pinned ? null : workspace.find(workspace.groups.focused.previewId ?? '');
    if (previous && this.dirty(previous)) workspace.groups.pin(previous.id);
    if (previous?.id === workspace.activeId) this.saveActiveState();
    const replaced = workspace.add(created, pinned);
    if (replaced) this.release(replaced);
    if (placement) workspace.groups.move(id, placement.groupId, placement.direction, placement.index);
    this.render();
    await this.activate(id, presentation);
    if (presentation === 'document' && created.surface === 'viewer' && hasMarkdownPreview(documentSnapshot)) window.setTimeout(() => {
      void editor.load().catch((error) => console.error('Failed to load editor', error));
    }, 0);
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
    if (tab.kind === 'web') return;
    this.options.autoSave?.cancel(tab.id);
    if (hasMarkdownPreview(tab.document)) this.options.reader.destroy(tab.id);
    this.options.editor.dispose(tab.id);
  }
  installTransferred = async (transfer: ClaimedTabTransfer, placement?: EditorGroupPlacement): Promise<void> => {
    const { desktop, editor, preview, reader, shell, surfaces, workspace } = this.options;
    const incoming = transfer.tab;
    if (incoming.kind === 'web') {
      if (!await desktop.adoptTabTransfer(transfer.transferId)) return;
      workspace.add({ kind: 'web', id: incoming.id, surface: 'web', page: incoming.page });
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
