import { isNotebookDocument } from '../../core/document/document-profile';
import type { DocumentTab, WorkspaceState } from '../../core/workspace/workspace-state';
import type { DocumentContentOwner } from '../ports/document-content';
import { notebooks } from './notebook-store';
export type { NotebookEntry } from './notebook-store';
export function notebookHasCell(tab: DocumentTab, id: string): boolean {
  return isNotebookDocument(tab.document.path) && notebooks.get(tab).document.cells.some(cell => cell.id === id);
}

export const notebookContent: DocumentContentOwner = {
  accepts: tab => isNotebookDocument(tab.document.path),
  text: tab => notebooks.get(tab).document.serialize(),
  dirty: tab => notebooks.get(tab).document.dirty,
  saved: tab => notebooks.get(tab).document.markSaved(tab.document.savedText),
  replace: (tab, snapshot) => {
    notebooks.dispose(tab.id);
    tab.text = snapshot.text; tab.revision = snapshot.revision;
  },
  release: id => notebooks.dispose(id),
  releaseAll: () => notebooks.disposeAll(),
};

/** Publish existing sessions without making their lifetime depend on Svelte mount. */
export function notebookViews(workspace: WorkspaceState, changed: (tab: DocumentTab, refresh: boolean) => void) {
  return workspace.documents.filter(notebookContent.accepts).map(tab => {
    const entry = notebooks.get(tab);
    const publishedDirty = entry.document.dirty;
    entry.changed = event => {
      if (workspace.find(tab.id) !== tab) return;
      workspace.groups.pin(tab.id); tab.revision++;
      changed(tab, event !== 'output' || publishedDirty !== entry.document.dirty);
    };
    return { id: tab.id, entry, path: tab.document.path };
  });
}
