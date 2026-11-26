import type { DocumentSnapshot } from '../../core/document/document';
import type { SaveResult } from '../../protocol/desktop-api';
import type { DesktopPort } from '../ports/desktop-port';

type Port = Pick<DesktopPort, 'largeText'>;
/** What a save is sent in: a model hands its text over in runs as short as one typed character. */
const PIECE_LENGTH = 1024 * 1024;

/** The text of a large file between its read and its editor model, held by the snapshot's `large`
 * marker. A snapshot that nobody shows takes its text with it. */
const unclaimed = new WeakMap<object, string[]>();

/** Reads the text a large-file snapshot describes. Any other snapshot is returned as it is. */
export async function readLargeText(port: Port, snapshot: DocumentSnapshot): Promise<DocumentSnapshot> {
  if (!snapshot.large) return snapshot;
  const { id } = await port.largeText.open(snapshot.path);
  const pieces: string[] = [];
  try {
    for (;;) {
      const piece = await port.largeText.read(id);
      if ('end' in piece) {
        const { lines, ...read } = piece.end;
        const large = { bytes: read.diskVersion.size, lines };
        unclaimed.set(large, pieces);
        return { ...snapshot, ...read, large };
      }
      pieces.push(piece.text);
    }
  } catch (error) { port.largeText.close(id); throw error; }
}

/** The text read for this snapshot, once: the editor model that takes it is its only holder. */
export function takeLargeText(document: DocumentSnapshot): string[] | undefined {
  const pieces = document.large && unclaimed.get(document.large);
  if (pieces) unclaimed.delete(document.large!);
  return pieces || undefined;
}

/** Saves a model's snapshot, which stays what it was when taken while later edits go on. */
export async function saveLargeText(port: Port, request: Parameters<Port['largeText']['save']>[0],
  text: { read(): string | null }): Promise<SaveResult> {
  const id = await port.largeText.save(request);
  try {
    let run: string[] = [], length = 0, open = true;
    const send = async () => {
      if (!length) return;
      const piece = run.join('');
      run = []; length = 0;
      open = await port.largeText.write(id, piece);
    };
    for (let piece = text.read(); open && piece !== null; piece = text.read()) {
      run.push(piece); length += piece.length;
      if (length >= PIECE_LENGTH) await send();
    }
    if (open) await send();
  } catch (error) {
    await port.largeText.finish(id, error instanceof Error ? error.message : String(error)).catch(() => {});
    throw error;
  }
  return port.largeText.finish(id);
}
