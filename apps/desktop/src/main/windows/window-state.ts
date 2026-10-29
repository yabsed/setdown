import type { BrowserWindow } from 'electron';
import type { DocumentSnapshot, GitReviewState, TabStateSummary } from '../../protocol/desktop-api';
import { isDirty } from '../../core/document/document-state';

export type WindowState = {
  disposeDocumentWatchers?: () => void;
  checkDocumentVersions?: () => void;
  explorerEditTarget?: boolean;
  /** BrowserWindow가 파괴된 뒤에도 안전하게 사용할 수 있는 불변 식별자. */
  webContentsId: number;
  window: BrowserWindow;
  currentDocument: DocumentSnapshot | null;
  activeRoot: string | null;
  /** Last real document directory; draft asset roots are never save locations. */
  documentDirectory?: string;
  projectRoot: string | null;
  gitRoot?: string | null;
  gitRepositories?: string[];
  watchedPath: string | null;
  closeAfterConfirmation: boolean;
  closePromptOpen: boolean;
  closePromptFingerprint?: string;
  rendererTabs: TabStateSummary[];
  rendererTabsReady?: boolean;
  rendererGitReview: GitReviewState | null;
};

export function windowDirtyFingerprint(state: WindowState): string {
  const entries = state.rendererTabs.filter(tab => tab.dirty).map(tab => [tab.path, tab.revision ?? 0]);
  if (state.rendererGitReview?.dirty && !entries.some(entry => entry[0] === state.rendererGitReview!.path))
    entries.push([state.rendererGitReview.path, state.currentDocument?.revision ?? 0]);
  if (!state.rendererTabs.length && state.currentDocument && isDirty(state.currentDocument))
    entries.push([state.currentDocument.path, state.currentDocument.revision]);
  return JSON.stringify(entries.sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
