import type { BrowserWindow } from 'electron';
import type { DocumentSnapshot, GitReviewState, TabStateSummary } from '../../protocol/desktop-api';

export type WindowState = {
  /** BrowserWindow가 파괴된 뒤에도 안전하게 사용할 수 있는 불변 식별자. */
  webContentsId: number;
  window: BrowserWindow;
  currentDocument: DocumentSnapshot | null;
  activeRoot: string | null;
  projectRoot: string | null;
  watchedPath: string | null;
  closeAfterConfirmation: boolean;
  closePromptOpen: boolean;
  rendererTabs: TabStateSummary[];
  rendererGitReview: GitReviewState | null;
};
