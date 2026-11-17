import { isNotebookDocument } from '../../core/document/document-profile';
import type { DocumentTab, WorkspaceState } from '../../core/workspace/workspace-state';
import type { DocumentContent } from '../../core/workspace/document-store';
import type { DocumentContentOwner } from '../ports/document-content';
import { NotebookDocument } from '../../core/notebook/notebook-document';
import { notebooks } from './notebook-store';
export type { NotebookEntry } from './notebook-store';
/** What the tab holds: its session's document, or the tab's own text read without one. */
function content(tab: DocumentContent): NotebookDocument {
  const open = notebooks.find(tab.id)?.document;
  if (open) return open;
  const document = new NotebookDocument(tab.text);
  document.markSaved(tab.document.savedText);
  return document;
}
export function notebookHasCell(tab: DocumentTab, id: string): boolean {
  return isNotebookDocument(tab.document.path) && content(tab).cells.some(cell => cell.id === id);
}

export const notebookContent: DocumentContentOwner = {
  accepts: tab => isNotebookDocument(tab.document.path),
  text: tab => content(tab).serialize(),
  // A tab just read from disk is asked before it has a session: equal text needs no parsing.
  dirty: tab => (notebooks.find(tab.id) || tab.text !== tab.document.savedText) ? content(tab).dirty : false,
  saved: tab => notebooks.find(tab.id)?.document.markSaved(tab.document.savedText),
  replace: (tab, snapshot) => {
    const entry = notebooks.find(tab.id);
    entry?.execution?.prepareReload();
    entry?.document.replace(snapshot.text);
    entry?.document.markSaved(snapshot.savedText);
    tab.text = snapshot.text; tab.revision = snapshot.revision;
  },
  release: id => notebooks.dispose(id),
  releaseAll: () => notebooks.disposeAll(),
};

/** Publish the listed tabs' sessions, opening those that have none, without making
 * their lifetime depend on Svelte mount. */
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
