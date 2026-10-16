import type { DocumentSnapshot } from '../../core/document/document';
import { hasUnsavedText } from '../../core/document/document-state';
import type { DocumentTab } from '../../core/workspace/workspace-state';
import type { DocumentContentOwner } from '../ports/document-content';
import type { MonacoEditor } from '../adapters/monaco-editor';

type TextDocuments = Pick<MonacoEditor, 'text' | 'beforeSave' | 'replace' | 'retarget' | 'saveView' | 'dispose'>
  & Partial<Pick<MonacoEditor, 'saved'>>;

/** Routes content operations to their owner; never owns or evicts UI surfaces. */
export class DocumentSessions {
  constructor(private readonly editor: TextDocuments, private readonly owners: readonly DocumentContentOwner[] = []) {}
  private owner(tab: DocumentTab) { return this.owners.find(owner => owner.accepts(tab)); }
  text = (tab: DocumentTab): string => this.owner(tab)?.text(tab) ?? this.editor.text(tab);
  dirty = (tab: DocumentTab): boolean => this.owner(tab)?.dirty(tab) ?? hasUnsavedText(tab.document, this.text(tab));
  beforeSave = (tab: DocumentTab, reason: 1 | 2 = 1): Promise<void> => this.editor.beforeSave(tab, reason);
  saved(tab: DocumentTab): void {
    const owner = this.owner(tab);
    if (owner) owner.saved(tab); else this.editor.saved?.(tab);
  }
  replace(tab: DocumentTab, snapshot: DocumentSnapshot): void {
    const owner = this.owner(tab);
    if (owner) owner.replace(tab, snapshot); else this.editor.replace(tab, snapshot);
  }
  retarget(tab: DocumentTab): void {
    for (const owner of this.owners) if (!owner.accepts(tab)) owner.release(tab.id);
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
