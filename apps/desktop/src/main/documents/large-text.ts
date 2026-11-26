import { constants, promises as fs, type Stats } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { LargeTextPiece } from '../../protocol/desktop-api';
import { isMarkdownDocument, isNotebookDocument, isTextCandidate } from '../../core/document/document-profile';
import { MAX_LARGE_TEXT_FILE_BYTES, MAX_TEXT_FILE_BYTES, TextStreamDecoder } from '../../core/document/text-codec';
import { versionFromStat } from './file-system';

/** One piece of a file as it is read. Large enough that a 1 GiB file is a few hundred messages,
 * small enough that no message or string comes near a process limit. */
const PIECE_BYTES = 4 * 1024 * 1024;

/** A text file past the size held as one string is opened in pieces. Markdown keeps its own
 * whole-text reader (its preview is prepared from the whole text) and a notebook is parsed whole. */
export function isLargeTextFile(filePath: string, size: number): boolean {
  return size > MAX_TEXT_FILE_BYTES && isTextCandidate(filePath) && !isMarkdownDocument(filePath) && !isNotebookDocument(filePath);
}

export function assertLargeTextSize(size: number): void {
  if (size > MAX_LARGE_TEXT_FILE_BYTES)
    throw new Error(`This file is ${(size / 1024 ** 3).toFixed(1)} GiB. Text files up to 1 GiB can be opened.`);
}

/** Reads a file front to back in decoded pieces, refusing what `readTextFile` refuses. */
export class LargeTextRead {
  private offset = 0;
  private readonly decoder = new TextStreamDecoder();
  private readonly bytes = Buffer.allocUnsafe(PIECE_BYTES);
  private constructor(private readonly filePath: string, private readonly handle: fs.FileHandle,
    private readonly stat: Stats) {}

  static async open(filePath: string): Promise<LargeTextRead> {
    if (!isTextCandidate(filePath)) throw new Error('This file type is binary and cannot be edited as text.');
    const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Only regular text files can be opened.');
      assertLargeTextSize(stat.size);
      return new LargeTextRead(filePath, handle, stat);
    } catch (error) { await handle.close(); throw error; }
  }

  get size(): number { return this.stat.size; }

  async next(): Promise<LargeTextPiece> {
    let length = 0;
    while (length < PIECE_BYTES) {
      const { bytesRead } = await this.handle.read(this.bytes, length, PIECE_BYTES - length, this.offset + length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    this.offset += length;
    if (length) {
      if (this.offset > this.stat.size) throw new Error('The file changed while it was being opened. Please retry.');
      return { text: this.decoder.write(this.bytes.subarray(0, length)) };
    }
    const after = await this.handle.stat(), current = await fs.stat(this.filePath), before = this.stat;
    if (after.size !== this.offset || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || current.dev !== after.dev || current.ino !== after.ino || current.mtimeMs !== after.mtimeMs || current.ctimeMs !== after.ctimeMs)
      throw new Error('The file changed while it was being opened. Please retry.');
    return { end: { ...this.decoder.end(), diskVersion: versionFromStat(after) } };
  }

  close(): Promise<void> { return this.handle.close(); }
}

/** Text handed over piece by piece to a writer that takes it at its own pace. */
export class TextPieces implements AsyncIterable<string> {
  private readonly offered: { text: string; taken(accepted: boolean): void }[] = [];
  private finished = false;
  private failure: Error | undefined;
  private closed = false;
  private wake: (() => void) | undefined;

  /** Resolves `true` once the reader took the piece, `false` when nobody will take it any more. */
  push(text: string): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    return new Promise(resolve => { this.offered.push({ text, taken: resolve }); this.wake?.(); });
  }
  /** No further pieces: the text is complete. */
  end(): void { this.finished = true; this.wake?.(); }
  /** The source gave up; the reader throws instead of finishing a partial text. */
  fail(error: Error): void { this.failure ??= error; this.wake?.(); }
  /** The reader stopped, whether done, failed or never started. */
  close(): void {
    this.closed = true;
    for (const piece of this.offered.splice(0)) piece.taken(false);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    try {
      for (;;) {
        if (this.failure) throw this.failure;
        const piece = this.offered.shift();
        if (piece) { piece.taken(true); yield piece.text; }
        else if (this.finished) return;
        else await new Promise<void>(resolve => { this.wake = resolve; });
      }
    } finally { this.close(); }
  }
}

type Session<T> = { owner: number; value: T; timer?: ReturnType<typeof setTimeout> };

/** Open reads and saves by id, each owned by the window that started it. `idleMs` ends one its
 * window stopped asking about; a save has none, since it may wait behind a dialog. */
export class LargeTextSessions<T> {
  private readonly sessions = new Map<string, Session<T>>();
  constructor(private readonly abandon: (value: T) => void, private readonly idleMs = 0) {}

  add(owner: number, value: T): string {
    if ([...this.sessions.values()].filter(session => session.owner === owner).length >= 32)
      throw new Error('Too many large files are being read or saved at once.');
    const id = randomUUID();
    this.sessions.set(id, { owner, value, timer: this.idle(id) });
    return id;
  }
  use(owner: number, id: unknown): T {
    const session = typeof id === 'string' ? this.sessions.get(id) : undefined;
    if (!session || session.owner !== owner) throw new Error('This large file transfer is no longer open.');
    clearTimeout(session.timer);
    session.timer = this.idle(id as string);
    return session.value;
  }
  /** Ends the session without abandoning its value: the caller finishes it. */
  forget(owner: number, id: unknown): T | undefined {
    const session = typeof id === 'string' ? this.sessions.get(id) : undefined;
    if (!session || session.owner !== owner) return undefined;
    clearTimeout(session.timer);
    this.sessions.delete(id as string);
    return session.value;
  }
  releaseOwner(owner: number): void {
    for (const [id, session] of this.sessions) if (session.owner === owner) this.drop(id);
  }
  private idle(id: string) { return this.idleMs ? setTimeout(() => this.drop(id), this.idleMs) : undefined; }
  private drop(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    clearTimeout(session.timer);
    this.sessions.delete(id);
    this.abandon(session.value);
  }
}
