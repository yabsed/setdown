import { constants, promises as fs } from 'node:fs';
import { isVideoDocument } from '../../core/document/document-profile';

export async function readVideoMetadata(file: string) {
  if (!isVideoDocument(file)) throw new Error('Unsupported video format.');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Only regular video files can be opened.');
    return { kind: 'video' as const, text: '', diskVersion: { size: stat.size, mtimeMs: stat.mtimeMs } };
  } finally { await handle.close(); }
}
