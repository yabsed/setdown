/** PDF.js may coalesce several chunks for a large image; keep each IPC bounded. */
export async function readPdfBytes(begin: number, end: number, size: number,
  read: (begin: number, end: number) => Promise<Uint8Array>): Promise<Uint8Array> {
  if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > size) {
    throw new Error('Invalid PDF byte range.');
  }
  const bytes = new Uint8Array(end - begin);
  for (let offset = begin; offset < end; offset += 4 * 1024 * 1024) {
    const limit = Math.min(end, offset + 4 * 1024 * 1024);
    const chunk = await read(offset, limit);
    if (chunk.length !== limit - offset) throw new Error('Incomplete PDF byte range.');
    bytes.set(chunk, offset - begin);
  }
  return bytes;
}
