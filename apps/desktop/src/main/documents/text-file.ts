import { promises as fs } from 'node:fs';
import { isTextCandidate } from '../../core/document/document-profile';
import { decodeTextBytes, MAX_TEXT_FILE_BYTES } from '../../core/document/text-codec';

/** Bound allocation even if the file grows between stat and read. Reject devices/FIFOs. */
export async function readTextFile(filePath: string) {
  if (!isTextCandidate(filePath)) throw new Error('This file type is binary and cannot be edited as text.');
  const before = await fs.stat(filePath);
  if (!before.isFile()) throw new Error('Only regular text files can be opened.');
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Only regular text files can be opened.');
    if (stat.size > MAX_TEXT_FILE_BYTES) throw new Error('This file exceeds the 16 MiB text editing limit.');
    const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_TEXT_FILE_BYTES + 1));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > stat.size) throw new Error('The file changed while it was being opened. Please retry.');
    const after = await handle.stat();
    if (after.size !== offset || after.mtimeMs !== stat.mtimeMs) throw new Error('The file changed while it was being opened. Please retry.');
    return { ...decodeTextBytes(bytes.subarray(0, offset)), diskVersion: { mtimeMs: after.mtimeMs, size: after.size } };
  } finally { await handle.close(); }
}
