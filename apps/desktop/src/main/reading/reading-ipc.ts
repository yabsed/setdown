import { ipcMain } from 'electron';
import { isPdfDocument, isImageDocument, isVideoDocument } from '../../core/document/document-profile';
import type { DiskVersion } from '../../core/document/document';
import type { WindowIpc } from '../ipc/window-ipc';
import type { WindowState } from '../windows/window-state';
import { canonicalPath } from '../documents/file-system';
import { readPdfRange } from '../documents/pdf-file';
import { readImageBytes } from '../documents/image-file';
import { validReadingRecord } from '../../core/reading/reading-position';
import type { ReadingPositionStore } from './reading-position-store';

export function installReadingIpc(channels: WindowIpc, positions: ReadingPositionStore,
  stateFor: (id: number) => WindowState | null): void {
  const owned = (state: WindowState, file: string) => state.currentDocument?.path === file
    || state.rendererTabs.some((tab) => !tab.isUntitled && tab.path === file);
  channels.on('reading:save', (state, value: unknown) => {
    if (!state.window.isFocused() || !validReadingRecord(value) || !owned(state, value.path)
      || value.observedAt > Date.now() + 1000) return;
    if ((value.position.kind === 'pdf') !== isPdfDocument(value.path)) return;
    if ((value.position.kind === 'image') !== isImageDocument(value.path)) return;
    if ((value.position.kind === 'video') !== isVideoDocument(value.path)) return;
    positions.save({ ...value, path: canonicalPath(value.path) });
  });
  // Used only on close/reload, after the final queued save messages.
  ipcMain.on('reading:flush', (event) => {
    if (stateFor(event.sender.id)) positions.flush();
    event.returnValue = null;
  });
  channels.handle('pdf:range', (state, file: string, begin: number, end: number, version: DiskVersion) => {
    if (typeof file !== 'string' || !isPdfDocument(file) || !owned(state, file)) throw new Error('PDF is not open in this window.');
    return readPdfRange(canonicalPath(file), begin, end, version);
  });
  channels.handle('image:read', (state, file: string, version: DiskVersion) => {
    if (typeof file !== 'string' || !isImageDocument(file) || !owned(state, file)) throw new Error('Image is not open in this window.');
    return readImageBytes(canonicalPath(file), version);
  });
}
