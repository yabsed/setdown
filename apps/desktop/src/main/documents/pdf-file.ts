import { constants, promises as fs } from 'node:fs';
import type { DiskVersion } from '../../core/document/document';

export async function readPdfMetadata(file: string) {
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Only regular PDF files can be opened.');
    const header = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!header.subarray(0, bytesRead).includes(Buffer.from('%PDF-'))) throw new Error('This file is not a PDF document.');
    return { kind: 'pdf' as const, text: '', diskVersion: { size: stat.size, mtimeMs: stat.mtimeMs } };
  } finally { await handle.close(); }
}

export async function readPdfRange(file: string, begin: number, end: number, version: DiskVersion): Promise<Uint8Array> {
  if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin
    || end - begin > 4 * 1024 * 1024) throw new Error('Invalid PDF byte range.');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !version || stat.size !== version.size || stat.mtimeMs !== version.mtimeMs) {
      throw new Error('The PDF changed. Reopen it to read the latest version.');
    }
    if (end > stat.size) throw new Error('PDF range exceeds file size.');
    const bytes = Buffer.alloc(end - begin);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, begin + offset);
      if (!bytesRead) throw new Error('The PDF changed while reading.');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('The PDF changed while reading.');
    return bytes;
  } finally { await handle.close(); }
}
