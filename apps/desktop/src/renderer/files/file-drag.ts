import type { DragLabel, FilesApi } from '../../protocol/files';

/**
 * A folder tab drags its files as an OS file drag, not an HTML drag: only that
 * hands real files to a web page, the desktop or another application. The OS
 * payload is just `Files`, so targets in this window recognize their own drag,
 * and keep its move/open meaning, through this record.
 */
const record = { paths: [] as string[], documents: [] as string[], serial: 0 };

export const FILE_DRAG_END = 'setdown:file-drag-end';

/**
 * The name tag beside the pointer where Setdown runs the drag itself (its X11
 * source on a Wayland desktop). Chromium's drag source draws its own and ignores it.
 */
function dragLabel(paths: readonly string[]): DragLabel | undefined {
  if (typeof document === 'undefined') return undefined;
  try {
    const scale = window.devicePixelRatio || 1, theme = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => theme.getPropertyValue(name).trim() || fallback;
    const name = paths[0].split(/[\\/]/).filter(Boolean).at(-1) ?? paths[0];
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    if (!context) return undefined;
    const font = `${Math.round(12 * scale)}px ${color('--app-font-family', 'sans-serif')}`;
    context.font = font;
    let text = name;
    const more = paths.length > 1 ? `  +${paths.length - 1}` : '', limit = 260 * scale;
    while (text.length > 4 && context.measureText(text + more).width > limit) text = `${text.slice(0, -2)}…`;
    const padding = Math.round(9 * scale), height = Math.round(26 * scale);
    const width = Math.ceil(context.measureText(text + more).width) + padding * 2;
    canvas.width = width; canvas.height = height;
    context.font = font; context.textBaseline = 'middle'; context.lineWidth = Math.max(1, Math.round(scale));
    context.beginPath(); context.roundRect(context.lineWidth / 2, context.lineWidth / 2, width - context.lineWidth, height - context.lineWidth, 6 * scale);
    context.fillStyle = color('--app-raised-surface', '#fff'); context.fill();
    context.strokeStyle = color('--app-strong-border', '#999'); context.stroke();
    context.fillStyle = color('--app-text', '#222'); context.fillText(text + more, padding, height / 2 + scale / 2);
    return { width, height, rgba: new Uint8Array(context.getImageData(0, 0, width, height).data) };
  } catch { return undefined; }
}

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
    // Chromium's drag loop takes Escape itself. Setdown's own X11 source (a Wayland
    // desktop) grabs nothing, so this window still has the keyboard and says so.
    const abandoned = (event: KeyboardEvent) => { if (event.key === 'Escape') files.cancelDrag(true); };
    window.addEventListener('mouseup', released, true);
    window.addEventListener('keydown', abandoned, true);
    // The OS drag never fires dragend here; main replies when it is over. Until
    // then main is inside the drag and answers no other request from this window.
    try { await files.startDrag(paths, dragLabel(paths)); }
    finally {
      window.removeEventListener('mouseup', released, true);
      window.removeEventListener('keydown', abandoned, true);
      window.dispatchEvent(new Event(FILE_DRAG_END));
      // The drop event and this reply arrive on separate channels: keep the record for a late drop.
      setTimeout(() => { if (record.serial === serial) { record.paths = []; record.documents = []; } }, 1000);
    }
  },
};
