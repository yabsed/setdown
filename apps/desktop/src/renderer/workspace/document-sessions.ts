import type { DocumentSnapshot } from '../../core/document/document';
import { hasUnsavedText } from '../../core/document/document-state';
import type { DocumentContent } from '../../core/workspace/document-store';
import type { DocumentTab } from '../../core/workspace/workspace-state';
import type { DocumentContentOwner } from '../ports/document-content';
import type { MonacoEditor } from '../adapters/monaco-editor';

type TextDocuments = Pick<MonacoEditor, 'text' | 'beforeSave' | 'replace' | 'retarget' | 'saveView' | 'dispose'>
  & Partial<Pick<MonacoEditor, 'saved'>>;

/** Routes content operations to their owner; never owns or evicts UI surfaces. */
export class DocumentSessions {
  constructor(private readonly editor: TextDocuments, private readonly owners: readonly DocumentContentOwner[] = [],
    private readonly desktop?: Pick<import('../ports/desktop-port').DesktopPort, 'saveDocumentAs' | 'saveTabDocument'>) {}
  private owner(tab: DocumentContent) { return this.owners.find(owner => owner.accepts(tab)); }
  text = (tab: DocumentContent): string => this.owner(tab)?.text(tab) ?? this.editor.text(tab);
  dirty = (tab: DocumentContent): boolean => this.owner(tab)?.dirty(tab) ?? hasUnsavedText(tab.document, this.text(tab));
  beforeSave = (tab: DocumentContent, reason: 1 | 2 = 1): Promise<void> => tab.document.kind ? Promise.resolve() : this.editor.beforeSave(tab, reason);
  save = (tab: DocumentContent, saveAs = false): Promise<import('../../protocol/desktop-api').SaveResult> => {
    const owner = this.owner(tab);
    if (owner?.save) return owner.save(tab, saveAs);
    if (!this.desktop) throw Error('Document saving is unavailable.');
    return saveAs ? this.desktop.saveDocumentAs(this.text(tab), tab.revision)
      : this.desktop.saveTabDocument(tab.document, this.text(tab), tab.revision);
  };
  saved(tab: DocumentContent): void {
    const owner = this.owner(tab);
    if (owner) owner.saved(tab); else this.editor.saved?.(tab);
  }
  replace(tab: DocumentContent, snapshot: DocumentSnapshot): void {
    const owner = this.owner(tab);
    if (owner) owner.replace(tab, snapshot); else this.editor.replace(tab, snapshot);
  }
  retarget(tab: DocumentContent): void {
    for (const owner of this.owners) if (!owner.accepts(tab)) owner.release(tab.id);
    this.owner(tab)?.retarget?.(tab);
    this.editor.retarget(tab);
  }
  saveView(tab: DocumentTab): void {
    this.editor.saveView(tab);
    tab.text = this.text(tab);
  }
  release(id: string): void {
    for (const owner of this.owners) owner.release(id);
    this.editor.dispose(id);
  }
  releaseAll(): void { for (const owner of this.owners) owner.releaseAll(); }
}
