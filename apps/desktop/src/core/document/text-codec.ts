export type TextEncoding = 'utf8' | 'utf8-bom';
export type TextEol = 'lf' | 'crlf';
/** The largest text held as one string: read whole, sent whole, compared whole. */
export const MAX_TEXT_FILE_BYTES = 16 * 1024 * 1024;
/** Above `MAX_TEXT_FILE_BYTES` a text file is read and saved in pieces, as VS Code streams every
 * file into its piece tree. VS Code asks before opening a local file past 1024 MB; that is the
 * most Setdown opens. */
export const MAX_LARGE_TEXT_FILE_BYTES = 1024 * 1024 * 1024;

const UTF16 = 'UTF-16/UTF-32 is not supported for editing yet. Convert a copy to UTF-8 first.';
const BINARY = 'This is a binary file or an unsupported text encoding.';
const INVALID_UTF8 = 'The file is not valid UTF-8. It was not opened or modified; convert a copy before editing.';
const CONTROL = 'This file contains binary control characters and cannot be edited as text.';
const BARE_CR = 'Bare CR line endings are not supported for text editing. Convert a copy to LF or CRLF first.';
const MIXED_EOL = 'Mixed line endings cannot be edited without normalization. Convert a copy to LF or CRLF first.';

/** Monaco normalizes mixed/bare-CR endings. Refuse instead of silently rewriting bytes. */
export function textLineEnding(text: string): TextEol {
  let lf = false;
  let crlf = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 13) {
      if (text.charCodeAt(index + 1) !== 10) throw new Error(BARE_CR);
      crlf = true; index += 1;
    } else if (text.charCodeAt(index) === 10) lf = true;
    if (lf && crlf) throw new Error(MIXED_EOL);
  }
  return crlf ? 'crlf' : 'lf';
}

/** Strict decoding; invalid UTF-8 never becomes U+FFFD in an editable document. */
export function decodeTextBytes(bytes: Uint8Array): { text: string; encoding: TextEncoding; eol: TextEol } {
  if (bytes.byteLength > MAX_TEXT_FILE_BYTES) throw new Error('This file exceeds the 16 MiB text editing limit.');
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new Error(UTF16);
  }
  if (bytes.includes(0)) throw new Error(BINARY);
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes); }
  catch { throw new Error(INVALID_UTF8); }
  // Reject binary control bytes while allowing common text whitespace.
  if (/[\u0001-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) throw new Error(CONTROL);
  return { text, encoding: bom ? 'utf8-bom' : 'utf8', eol: textLineEnding(text) };
}

/** The refusals of `decodeTextBytes` for a text that arrives in pieces: what one piece cannot
 * decide (a CR at its end, the line ending of the whole) is carried to the next. */
export class TextStreamCheck {
  private crs = 0;
  private lfs = 0;
  private pendingCr = false;
  accept(text: string): void {
    if (!text) return;
    if (text.includes('\0')) throw new Error(BINARY);
    if (/[\u0001-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) throw new Error(CONTROL);
    if (this.pendingCr && text.charCodeAt(0) !== 10) throw new Error(BARE_CR);
    this.pendingCr = false;
    for (let at = text.indexOf('\r'); at !== -1; at = text.indexOf('\r', at + 1)) {
      if (at === text.length - 1) this.pendingCr = true;
      else if (text.charCodeAt(at + 1) !== 10) throw new Error(BARE_CR);
      this.crs += 1;
    }
    for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) this.lfs += 1;
    // Every CR seen so far is followed by an LF, except one still waiting for its piece.
    if (this.crs && this.lfs > this.crs - (this.pendingCr ? 1 : 0)) throw new Error(MIXED_EOL);
  }
  end(): TextEol {
    if (this.pendingCr) throw new Error(BARE_CR);
    return this.crs ? 'crlf' : 'lf';
  }
  /** Lines so far, as an editor counts them: one more than the line endings. */
  get lines(): number { return this.lfs + 1; }
}

/** `decodeTextBytes` for a file read in pieces. */
export class TextStreamDecoder {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  private readonly check = new TextStreamCheck();
  /** The first bytes, until there are enough to tell a byte order mark. */
  private head: Uint8Array | null = new Uint8Array(0);
  private bom = false;
  write(bytes: Uint8Array): string {
    if (this.head) {
      const head = new Uint8Array(this.head.byteLength + bytes.byteLength);
      head.set(this.head); head.set(bytes, this.head.byteLength);
      // Held only while the bytes could still become a mark. Such a start is no text by itself,
      // so `end` never has text left to hand over.
      const utf8Mark = head.byteLength < 3 && head[0] === 0xef && (head.byteLength === 1 || head[1] === 0xbb);
      const utf16Mark = head.byteLength === 1 && (head[0] === 0xff || head[0] === 0xfe);
      if (!head.byteLength || utf8Mark || utf16Mark) { this.head = head; return ''; }
      bytes = this.start(head);
    }
    return this.decode(bytes);
  }
  end(): { encoding: TextEncoding; eol: TextEol; lines: number } {
    if (this.head) this.decode(this.start(this.head));
    // A sequence cut off by the end of the file is as invalid as one in its middle.
    try { this.decoder.decode(); } catch { throw new Error(INVALID_UTF8); }
    return { encoding: this.bom ? 'utf8-bom' : 'utf8', eol: this.check.end(), lines: this.check.lines };
  }
  private start(head: Uint8Array): Uint8Array {
    this.head = null;
    if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) throw new Error(UTF16);
    this.bom = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
    return this.bom ? head.subarray(3) : head;
  }
  private decode(bytes: Uint8Array): string {
    if (bytes.includes(0)) throw new Error(BINARY);
    let text: string;
    try { text = this.decoder.decode(bytes, { stream: true }); }
    catch { throw new Error(INVALID_UTF8); }
    this.check.accept(text);
    return text;
  }
}

export function encodedText(text: string, encoding?: TextEncoding): string {
  return encoding === 'utf8-bom' ? `\uFEFF${text}` : text;
}
