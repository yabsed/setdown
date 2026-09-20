import { constants, promises as fs } from 'node:fs';
import { isTextCandidate } from '../../core/document/document-profile';
import { decodeTextBytes, MAX_TEXT_FILE_BYTES } from '../../core/document/text-codec';

/** Bounded read on the opened handle; O_NONBLOCK prevents a raced FIFO from hanging. */
export async function readTextFile(filePath: string, limit = MAX_TEXT_FILE_BYTES) {
  if (!isTextCandidate(filePath)) throw new Error('This file type is binary and cannot be edited as text.');
  const before = await fs.stat(filePath);
  if (!before.isFile()) throw new Error('Only regular text files can be opened.');
  const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Only regular text files can be opened.');
    const maximum = Math.min(MAX_TEXT_FILE_BYTES, Math.max(0, limit));
    if (stat.size > maximum) throw new Error('This file exceeds the text reading limit.');
    const bytes = Buffer.alloc(Math.min(stat.size + 1, maximum + 1));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset > stat.size || after.size !== offset || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      throw new Error('The file changed while it was being opened. Please retry.');
    }
    return { ...decodeTextBytes(bytes.subarray(0, offset)), diskVersion: { mtimeMs: after.mtimeMs, size: after.size } };
  } finally { await handle.close(); }
}
