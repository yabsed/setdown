import type { DocumentSnapshot } from '../../core/document/document';
import { readLargeText } from '../editor/large-text';
import type { DesktopPort } from '../ports/desktop-port';

const desktop = window.marktex;
const text = (snapshot: DocumentSnapshot | null) => snapshot ? readLargeText(desktop, snapshot) : snapshot;
/** A document the main process opened by itself has no caller to tell that its text could not be read. */
const failed = (error: unknown) => {
  const reason = (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  window.alert(`Could not open the file.\n${reason}`);
};

/** 브라우저 전역을 애플리케이션 경계의 명시적인 포트로 바꾼다.
 * A large text file arrives from the main process as a description without text. Its text is read
 * here, in pieces, so every document the application receives is ready for an editor model. */
export const electronDesktop: DesktopPort = desktop && { ...desktop,
  getDocument: async () => {
    try { return await text(await desktop.getDocument()); }
    catch (error) { failed(error); return null; }
  },
  openDocument: async () => text(await desktop.openDocument()),
  readDocumentLocation: async (location, content = true) => {
    const snapshot = await desktop.readDocumentLocation(location);
    return content ? readLargeText(desktop, snapshot) : snapshot;
  },
  reloadDocument: async () => text(await desktop.reloadDocument()),
  onDocumentOpened: listener => desktop.onDocumentOpened(snapshot => { void readLargeText(desktop, snapshot).then(listener, failed); }),
};
