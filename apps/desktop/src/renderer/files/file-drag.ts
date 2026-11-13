import type { FilesApi } from '../../protocol/files';

/**
 * A folder tab drags its files as an OS file drag, not an HTML drag: only that
 * hands real files to a web page, the desktop or another application. The OS
 * payload is just `Files`, so targets in this window recognize their own drag,
 * and keep its move/open meaning, through this record.
 */
const record = { paths: [] as string[], documents: [] as string[], serial: 0 };

export const FILE_DRAG_END = 'setdown:file-drag-end';

export const fileDrag = {
  /** Top-level paths of this window's drag; empty when none is in progress. */
  get paths(): readonly string[] { return record.paths; },
  /** The dragged paths that open as document tabs. */
  get documents(): readonly string[] { return record.documents; },
  /** Whether a `Files` drag event belongs to this window's own drag. */
  owns: (event: DragEvent): boolean => record.paths.length > 0 && !!event.dataTransfer?.types.includes('Files'),
  /** The dropped paths themselves prove ownership, so a late record never claims another application's files. */
  dropped: (paths: string[]): boolean => paths.length > 0 && paths.every(path => record.paths.includes(path)),
  async start(files: Pick<FilesApi, 'startDrag' | 'cancelDrag'>, paths: string[], documents: string[]): Promise<void> {
    if (!paths.length) return;
    const serial = ++record.serial;
    record.paths = paths; record.documents = documents;
    // Once the OS drag holds the pointer this window sees no mouseup. Seeing one
    // means the button went up before the drag began, so it must not begin.
    const released = () => files.cancelDrag();
    window.addEventListener('mouseup', released, true);
    // The OS drag never fires dragend here; main replies when it is over. Until
    // then main is inside the drag and answers no other request from this window.
    try { await files.startDrag(paths); }
    finally {
      window.removeEventListener('mouseup', released, true);
      window.dispatchEvent(new Event(FILE_DRAG_END));
      // The drop event and this reply arrive on separate channels: keep the record for a late drop.
      setTimeout(() => { if (record.serial === serial) { record.paths = []; record.documents = []; } }, 1000);
    }
  },
};
