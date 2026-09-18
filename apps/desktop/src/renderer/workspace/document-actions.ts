import type { DocumentSnapshot } from '../../shared/contracts';
import type { PreviewSession } from '../reader/preview-session';
import type { DocumentTab } from '../tabs/tab-state';
import { view } from '../view-state.svelte';

type Options = {
  tabs: DocumentTab[];
  active: () => DocumentTab | null;
  text: (tab: DocumentTab) => string;
  dirty: (tab: DocumentTab) => boolean;
  preview: PreviewSession;
  installModel: (document: DocumentSnapshot) => void;
  show: (document: DocumentSnapshot, surface?: 'viewer' | 'editor') => Promise<void>;
  reload: (document: DocumentSnapshot) => Promise<void>;
  renderTabs: () => void;
  updateChrome: () => void;
};

export class DocumentActions {
  constructor(private readonly options: Options) {}

  async save(saveAs = false) {
    const tab = this.options.active();
    if (!tab) return false;
    const text = this.options.text(tab);
    const result = saveAs
      ? await window.marktex.saveDocumentAs(text, tab.revision)
      : await window.marktex.saveDocument(text, tab.revision);
    if (result.canceled || !result.document) return false;

    const pathChanged = result.document.path !== tab.document.path;
    tab.document = result.document;
    tab.revision = result.document.revision;
    if (pathChanged) {
      this.options.preview.reset();
      this.options.installModel(result.document);
      Object.assign(tab, { previewUrl: null, previewRevision: null, previewTheme: null });
      if (tab.surface === 'editor') this.options.preview.schedule(tab.revision);
      else {
        const revision = tab.revision;
        void this.options.preview.ensure(revision).then((ready) => {
          if (ready && this.options.active()?.revision === revision) {
            void this.options.preview.position(tab.anchor, revision);
          }
        });
      }
    }
    this.options.updateChrome();
    return true;
  }

  async saveAll() {
    try {
      for (const tab of this.options.tabs) {
        if (!this.options.dirty(tab)) continue;
        const result = await window.marktex.saveTabDocument(
          tab.document, this.options.text(tab), tab.revision,
        );
        if (result.canceled || !result.document) {
          window.marktex.finishWindowClose(false);
          return;
        }
        tab.document = result.document;
        tab.revision = result.document.revision;
      }
      this.options.renderTabs();
      window.marktex.finishWindowClose(true);
    } catch (error) {
      window.alert(`문서를 저장하지 못했습니다.\n${error instanceof Error ? error.message : String(error)}`);
      window.marktex.finishWindowClose(false);
    }
  }

  async open() {
    const document = await window.marktex.openDocument();
    if (document) await this.options.show(document);
  }

  async create() {
    const document = await window.marktex.newDocument();
    if (document) await this.options.show(document, 'editor');
  }

  async exportPdf() {
    const tab = this.options.active();
    if (!tab) return;
    try {
      await window.marktex.exportPdf(this.options.text(tab), tab.revision, tab.document.path);
    } catch (error) {
      window.alert(`PDF를 내보내지 못했습니다.\n${error instanceof Error ? error.message : String(error)}`);
    }
  }

  keepExternalChange() {
    const tab = this.options.active();
    if (!tab) return;
    const { id, revision } = tab;
    const path = tab.document.path;
    const text = this.options.text(tab);
    void window.marktex.reloadDocument().then(async (diskDocument) => {
      if (!diskDocument || this.options.active()?.id !== id
        || this.options.active()?.document.path !== path) return;
      tab.document = { ...diskDocument, text, revision };
      tab.text = text;
      await window.marktex.activateDocument(tab.document, text, revision);
      if (this.options.active()?.id !== id) return;
      view.notice = false;
      this.options.updateChrome();
    }).catch((error) => console.error('Failed to keep current document text', error));
  }

  async reloadExternalChange() {
    const document = await window.marktex.reloadDocument();
    if (document) await this.options.reload(document);
  }
}
