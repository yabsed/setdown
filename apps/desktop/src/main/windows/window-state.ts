import type { BrowserWindow } from 'electron';
import type { DocumentSnapshot, TabStateSummary } from '../../protocol/desktop-api';

export type WindowState = {
  window: BrowserWindow;
  currentDocument: DocumentSnapshot | null;
  activeRoot: string | null;
  watchedPath: string | null;
  closeAfterConfirmation: boolean;
  rendererTabs: TabStateSummary[];
};
