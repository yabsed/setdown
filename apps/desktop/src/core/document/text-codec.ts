export type TextEncoding = 'utf8' | 'utf8-bom';
export type TextEol = 'lf' | 'crlf';
export const MAX_TEXT_FILE_BYTES = 16 * 1024 * 1024;

/** Monaco normalizes mixed/bare-CR endings. Refuse instead of silently rewriting bytes. */
export function textLineEnding(text: string): TextEol {
  let lf = false;
  let crlf = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 13) {
      if (text.charCodeAt(index + 1) !== 10) throw new Error('Bare CR line endings are not supported for text editing. Convert a copy to LF or CRLF first.');
      crlf = true; index += 1;
    } else if (text.charCodeAt(index) === 10) lf = true;
    if (lf && crlf) throw new Error('Mixed line endings cannot be edited without normalization. Convert a copy to LF or CRLF first.');
  }
  return crlf ? 'crlf' : 'lf';
}

/** Strict decoding; invalid UTF-8 never becomes U+FFFD in an editable document. */
export function decodeTextBytes(bytes: Uint8Array): { text: string; encoding: TextEncoding; eol: TextEol } {
  if (bytes.byteLength > MAX_TEXT_FILE_BYTES) throw new Error('This file exceeds the 16 MiB text editing limit.');
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new Error('UTF-16/UTF-32 is not supported for editing yet. Convert a copy to UTF-8 first.');
  }
  if (bytes.includes(0)) throw new Error('This is a binary file or an unsupported text encoding.');
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes); }
  catch { throw new Error('The file is not valid UTF-8. It was not opened or modified; convert a copy before editing.'); }
  // Reject binary control bytes while allowing common text whitespace.
  if (/[\u0001-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) throw new Error('This file contains binary control characters and cannot be edited as text.');
  return { text, encoding: bom ? 'utf8-bom' : 'utf8', eol: textLineEnding(text) };
}

export function encodedText(text: string, encoding?: TextEncoding): string {
  return encoding === 'utf8-bom' ? `\uFEFF${text}` : text;
}
