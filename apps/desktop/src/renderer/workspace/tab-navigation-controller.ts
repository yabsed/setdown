import { fileLocation, isFileLocation } from '../../core/document/file-location';
import { browserURL } from '../../core/browser/browser-url';
import { hasMarkdownPreview } from '../../core/document/document-capabilities';
import { recordVisit, type TabNavigation, type TabVisit } from '../../core/workspace/tab-navigation';
import { isDocumentTab, tabLocation, type DocumentTab, type TerminalTab, type WorkspaceState, type WorkspaceTab } from '../../core/workspace/workspace-state';
import type { DocumentSnapshot } from '../../core/document/document';
import type { CloseDecision } from '../../protocol/desktop-api';
import type { DesktopPort } from '../ports/desktop-port';
import type { DocumentSessions } from './document-sessions';
import type { MonacoEditor } from '../adapters/monaco-editor';

type Options = {
  workspace: WorkspaceState;
  desktop: Pick<DesktopPort, 'browser' | 'readDocumentLocation' | 'saveTabDocument' | 'discardDocument'>;
  editor: Pick<MonacoEditor, 'load'>;
  documents: DocumentSessions;
  capturePosition?(tab?: DocumentTab): void;
  confirmClose(names: string[]): Promise<CloseDecision>;
  text(tab: WorkspaceTab): string;
  dirty(tab: WorkspaceTab): boolean;
  acceptSaved(tab: DocumentTab, saved: DocumentSnapshot): Promise<void>;
  documentTab(id: string, snapshot: DocumentSnapshot): DocumentTab;
  restoreDocumentTab(tab: DocumentTab): void;
  saveActiveState(): void;
  release(tab: WorkspaceTab): void;
  activate(id: string, presentation?: 'document' | 'review', fresh?: boolean): Promise<void>;
  invalidateActive(): void;
  render(): void;
};

/** Serializes resource replacement and cross-resource Back/Forward per tab.
 * The workspace owns presentation; this coordinator owns navigation requests.
 */
export class TabNavigationController {
  private readonly navigationRequests = new Map<string, symbol>();
  private readonly navigationTasks = new Map<string, Promise<boolean>>();
  private readonly historyTasks = new Map<string, Promise<boolean>>();
  private readonly replacing = new Set<string>();
  constructor(private readonly options: Options) {}
  isReplacing(id: string): boolean { return this.replacing.has(id); }
  cancel(id: string): Promise<boolean> | undefined {
    this.navigationRequests.delete(id);
    return this.replacing.has(id) ? (this.navigationTasks.get(id) ?? Promise.resolve(false)) : undefined;
  }
  visit(tab: WorkspaceTab): TabVisit | null {
    if (tab.kind === 'terminal') return { kind: 'terminal', url: tabLocation(tab) };
    if (tab.kind === 'web') return { kind: 'web', url: tab.page.url };
    return tab.document.isUntitled ? null : { kind: 'file', url: fileLocation(tab.document.path), position: tab.readingPosition };
  }
  history(tab: WorkspaceTab): TabNavigation {
    if (!tab.navigation) {
      const visit = this.visit(tab);
      tab.navigation = { entries: visit ? [visit] : [], index: visit ? 0 : -1 };
    }
    return tab.navigation;
  }
  canGoBack = (id: string): boolean => {
    const tab = this.options.workspace.find(id);
    return !!tab && ((tab.kind === 'web' && tab.page.canGoBack) || this.history(tab).index > 0);
  };
  canGoForward = (id: string): boolean => {
    const tab = this.options.workspace.find(id);
    return !!tab && ((tab.kind === 'web' && tab.page.canGoForward)
      || this.history(tab).index < this.history(tab).entries.length - 1);
  };
  webNavigated = (id: string): void => {
    const tab = this.options.workspace.find(id);
    if (tab?.kind !== 'web') return;
    const navigation = this.history(tab);
    navigation.entries.splice(navigation.index + 1);
    this.options.render();
  };
  navigateHistory = (id: string, direction: -1 | 1): Promise<boolean> => {
    const previous = this.historyTasks.get(id) ?? Promise.resolve(false);
    const task = previous.catch(() => false).then(async () => {
      await this.navigationTasks.get(id)?.catch(() => false);
      const tab = this.options.workspace.find(id);
      if (!tab) return false;
      if (tab.kind === 'web' && await this.options.desktop.browser.command(id, direction < 0 ? 'back' : 'forward')) return true;
      const navigation = this.history(tab), index = navigation.index + direction;
      const visit = navigation.entries[index];
      return visit ? this.navigateLocation(id, visit.url, index) : false;
    });
    this.historyTasks.set(id, task);
    const cleanup = () => { if (this.historyTasks.get(id) === task) this.historyTasks.delete(id); };
    void task.then(cleanup, cleanup);
    return task;
  };
  navigateLocation = (id: string, input: string, historyIndex?: number): Promise<boolean> => {
    const { desktop, workspace } = this.options;
    const request = Symbol();
    this.navigationRequests.set(id, request);
    let prepared: Promise<string | DocumentSnapshot | TerminalTab>;
    try {
      if (/^terminal:/i.test(input.trim())) {
        const url = new URL(input.trim());
        const session = workspace.terminals.get(url.hostname);
        if (!session || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) throw Error('This terminal session is no longer available.');
        prepared = Promise.resolve({ ...session, kind: 'terminal', id, sessionId: session.id, surface: 'terminal' });
      } else prepared = isFileLocation(input) ? desktop.readDocumentLocation(input.trim()) : Promise.resolve(browserURL(input));
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
      let destination = result.value;
      const tab = workspace.find(id)!;
      if (typeof destination !== 'string' && destination.kind === 'terminal') {
        const sessionId = destination.sessionId;
        const existing = workspace.tabs.find(other => other.id !== id && other.kind === 'terminal'
          && (other.sessionId ?? other.id) === sessionId);
        if (existing) { await this.options.activate(existing.id); return true; }
        if (tab.kind === 'terminal' && (tab.sessionId ?? tab.id) === destination.sessionId) return true;
      }
      const navigation = this.history(tab), target = historyIndex === undefined ? null : navigation.entries[historyIndex];
      if (historyIndex !== undefined && !target) return false;
      if (typeof destination !== 'string' && destination.kind !== 'terminal' && target?.kind === 'file' && target.position) {
        destination = { ...destination, readingPosition: target.position };
      }
      if (typeof destination === 'string' && tab.kind === 'web') {
        workspace.groups.pin(id);
        await desktop.browser.navigate(id, destination);
        return true;
      }
      if (typeof destination !== 'string' && destination.kind !== 'terminal' && isDocumentTab(tab) && destination.path === tab.document.path) {
        if (historyIndex !== undefined) { navigation.index = historyIndex; this.options.render(); }
        return true;
      }
      this.replacing.add(id);
      let createdWeb = false;
      let outgoingWeb: TabVisit | undefined;
      try {
        if (isDocumentTab(tab) && this.options.dirty(tab)) {
          const decision = await this.options.confirmClose([tab.document.name]);
          if (!current() || decision === 'cancel') return false;
          if (decision === 'save') {
            await this.options.documents.beforeSave(tab);
            if (!current() || workspace.find(id) !== tab) return false;
            const saved = await desktop.saveTabDocument(tab.document, this.options.text(tab), tab.revision);
            if (saved.canceled || !saved.document) return false;
            await this.options.acceptSaved(tab, saved.document);
            if (!current() || this.options.dirty(tab)) return false;
          }
        }
        if (!current() || workspace.find(id) !== tab) return false;
        let replacement: WorkspaceTab;
        if (typeof destination === 'string') {
          const page = await desktop.browser.create(id, destination, target?.kind === 'web' ? target.history : undefined);
          createdWeb = true;
          if (!current()) { await desktop.browser.close(id); return false; }
          replacement = { kind: 'web', id, surface: 'web', page };
        } else {
          if (tab.kind === 'web') {
            const history = await desktop.browser.history(id);
            if (!current()) return false;
            if (historyIndex === undefined) history.entries.splice(history.index + 1);
            outgoingWeb = { kind: 'web', url: history.entries[history.index].url, history };
          }
          // A rejected beforeunload leaves the live web page and tab intact.
          if (tab.kind === 'web' && !await desktop.browser.close(id)) return false;
          replacement = destination.kind === 'terminal' ? destination : this.options.documentTab(id, destination);
        }
        if (workspace.activeId === id) this.options.saveActiveState();
        else if (isDocumentTab(tab)) { this.options.capturePosition?.(tab); this.options.documents.saveView(tab); }
        if (isDocumentTab(tab)) {
          const outgoing = this.visit(tab);
          if (outgoing) {
            if (navigation.index < 0) recordVisit(navigation, outgoing);
            else navigation.entries[navigation.index] = outgoing;
          }
        }
        if (isDocumentTab(tab) && tab.document.isUntitled) await desktop.discardDocument(tab.document);
        const index = workspace.tabs.indexOf(tab);
        if (index < 0) return false;
        const active = workspace.activeId === id;
        if (active) this.options.invalidateActive();
        this.options.release(tab);
        if (outgoingWeb) navigation.entries[navigation.index] = outgoingWeb;
        replacement.navigation = navigation;
        if (historyIndex === undefined) {
          const visit = this.visit(replacement);
          if (visit) recordVisit(navigation, visit);
        } else navigation.index = historyIndex;
        workspace.tabs[index] = replacement;
        if (historyIndex === undefined) workspace.groups.pin(id);
        if (isDocumentTab(replacement)) this.options.restoreDocumentTab(replacement);
        this.options.render();
        if (active) await this.options.activate(id, 'document', true);
        if (isDocumentTab(replacement) && replacement.surface === 'viewer' && hasMarkdownPreview(replacement.document)) {
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
}
