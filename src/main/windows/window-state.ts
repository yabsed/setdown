import type { BrowserWindow } from 'electron';
import type { DocumentSnapshot, TabStateSummary } from '../../shared/contracts';

export type WindowState = {
  window: BrowserWindow;
  currentDocument: DocumentSnapshot | null;
  activeRoot: string | null;
  watchedPath: string | null;
  closeAfterConfirmation: boolean;
  rendererTabs: TabStateSummary[];
};
