import type { DocumentSnapshot } from '../../protocol/desktop-api';
import { hasMarkdownPreview } from '../../core/document/document-capabilities';
import { retainUnsavedRevision } from '../../core/document/document-save';
import type { PreviewSession } from '../reader/preview-session';
import type { WorkspaceTab } from '../../core/workspace/workspace-state';
import type { DesktopPort } from '../ports/desktop-port';
import { view } from '../view-state.svelte';

type Options = {
  desktop: DesktopPort; tabs: WorkspaceTab[]; active: () => WorkspaceTab | null;
  text: (tab: WorkspaceTab) => string; dirty: (tab: WorkspaceTab) => boolean; preview: PreviewSession;
  installModel: (document: DocumentSnapshot) => void;
  acceptSaved?: (tab: WorkspaceTab, document: DocumentSnapshot) => Promise<void>;
  show: (document: DocumentSnapshot, surface?: 'viewer' | 'editor') => Promise<void>;
  reload: (document: DocumentSnapshot) => Promise<void>;
  saved: (document: DocumentSnapshot) => void | Promise<void>;
  renderTabs: () => void; updateChrome: () => void;
};
export class DocumentActions {
  constructor(private readonly options: Options) {}
  private async accept(tab: WorkspaceTab, saved: DocumentSnapshot) {
    if (!this.options.tabs.includes(tab)) return;
    if (this.options.acceptSaved) return this.options.acceptSaved(tab, saved);
    tab.document = retainUnsavedRevision(saved, this.options.text(tab), tab.revision);
    tab.revision = tab.document.revision;
  }
  async save(saveAs = false) {
    const tab = this.options.active();
    if (!tab || tab.document.kind === 'pdf') return false;
    try {
      const text = this.options.text(tab);
      const result = saveAs
        ? await this.options.desktop.saveDocumentAs(text, tab.revision)
        : await this.options.desktop.saveDocument(text, tab.revision);
      if (result.canceled || !result.document) return false;
      await this.accept(tab, result.document);
      await this.options.saved(result.document);
      this.options.updateChrome();
      return true;
    } catch (error) {
      window.alert(`Could not save the document.\n${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  async savePaths(paths: string[]): Promise<boolean> {
    const selected = new Set(paths);
    try {
      for (const tab of [...this.options.tabs]) {
        if (!selected.has(tab.document.path) || !this.options.dirty(tab)) continue;
        const result = await this.options.desktop.saveTabDocument(tab.document, this.options.text(tab), tab.revision);
        if (result.canceled || !result.document) return false;
        await this.accept(tab, result.document);
        await this.options.saved(result.document);
        if (this.options.tabs.includes(tab) && this.options.dirty(tab)) return false;
      }
      this.options.renderTabs(); this.options.updateChrome(); return true;
    } catch (error) {
      window.alert(`Could not save changes before staging.\n${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  async saveAll() {
    try {
      for (const tab of [...this.options.tabs]) {
        if (!this.options.dirty(tab)) continue;
        const result = await this.options.desktop.saveTabDocument(tab.document, this.options.text(tab), tab.revision);
        if (result.canceled || !result.document) { this.options.desktop.finishWindowClose(false); return; }
        await this.accept(tab, result.document);
        await this.options.saved(result.document);
        if (this.options.tabs.includes(tab) && this.options.dirty(tab)) {
          this.options.desktop.finishWindowClose(false);
          return;
        }
      }
      this.options.renderTabs();
      this.options.desktop.finishWindowClose(true);
    } catch (error) {
      window.alert(`Could not save the document.\n${error instanceof Error ? error.message : String(error)}`);
      this.options.desktop.finishWindowClose(false);
    }
  }
  async open() {
    try {
      const document = await this.options.desktop.openDocument();
      if (document) await this.options.show(document);
    } catch (error) { window.alert(`Could not open the file.\n${error instanceof Error ? error.message : String(error)}`); }
  }
  async create() {
    const document = await this.options.desktop.newDocument();
    if (document) await this.options.show(document, 'editor');
  }
  async exportPdf() {
    const tab = this.options.active();
    if (!tab || !hasMarkdownPreview(tab.document)) return;
    try { await this.options.desktop.exportPdf(this.options.text(tab), tab.revision, tab.document.path); }
    catch (error) { window.alert(`Could not export the PDF.\n${error instanceof Error ? error.message : String(error)}`); }
  }
  keepExternalChange() {
    const tab = this.options.active();
    if (!tab) return;
    const { id, revision } = tab;
    const path = tab.document.path;
    const text = this.options.text(tab);
    void this.options.desktop.reloadDocument().then(async (diskDocument) => {
      if (!diskDocument || this.options.active()?.id !== id
        || this.options.active()?.document.path !== path || tab.revision !== revision) return;
      tab.document = { ...diskDocument, text, revision };
      tab.text = text;
      await this.options.desktop.activateDocument(tab.document, text, revision);
      if (this.options.active()?.id !== id) return;
      view.notice = false; this.options.updateChrome();
    }).catch((error) => console.error('Failed to keep current document text', error));
  }
  async reloadExternalChange() {
    const tab = this.options.active();
    if (!tab) return;
    const { id, revision } = tab;
    const document = await this.options.desktop.reloadDocument();
    if (document && this.options.active()?.id === id && tab.revision === revision
      && document.path === tab.document.path) await this.options.reload(document);
  }
}
