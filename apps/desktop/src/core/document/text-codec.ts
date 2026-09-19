export type TextEncoding = 'utf8' | 'utf8-bom';
export const MAX_TEXT_FILE_BYTES = 16 * 1024 * 1024;

/** Reject lossy decoding; never replace unrecognised bytes with U+FFFD and save them. */
export function decodeTextBytes(bytes: Uint8Array): { text: string; encoding: TextEncoding } {
  if (bytes.byteLength > MAX_TEXT_FILE_BYTES) throw new Error('This file exceeds the 16 MiB text editing limit.');
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new Error('UTF-16/UTF-32 is not supported for editing yet. Convert a copy to UTF-8 first.');
  }
  if (bytes.includes(0)) throw new Error('This is a binary file or an unsupported text encoding.');
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
    return { text, encoding: bom ? 'utf8-bom' : 'utf8' };
  } catch {
    throw new Error('The file is not valid UTF-8. It was not opened or modified; convert a copy before editing.');
  }
}

/** Document-owned BOM metadata survives save, save-as, reload and window transfer. */
export function encodedText(text: string, encoding?: TextEncoding): string {
  return encoding === 'utf8-bom' ? `\uFEFF${text}` : text;
}
