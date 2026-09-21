import { constants, promises as fs } from 'node:fs';
import type { DiskVersion } from '../../core/document/document';
import { isImageDocument } from '../../core/document/document-profile';

export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
async function openImage(file: string) {
  if (!isImageDocument(file)) throw new Error('Unsupported image format.');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Only regular image files can be opened.');
    if (stat.size > MAX_IMAGE_BYTES) throw new Error('Images must be 64 MiB or smaller.');
    return { handle, diskVersion: { size: stat.size, mtimeMs: stat.mtimeMs } };
  } catch (error) { await handle.close(); throw error; }
}
export async function readImageMetadata(file: string) {
  const { handle, diskVersion } = await openImage(file);
  await handle.close();
  return { kind: 'image' as const, text: '', diskVersion };
}
export async function readImageBytes(file: string, version: DiskVersion): Promise<Uint8Array> {
  const { handle, diskVersion } = await openImage(file);
  try {
    if (!version || version.size !== diskVersion.size || version.mtimeMs !== diskVersion.mtimeMs)
      throw new Error('The image changed. Reload it to read the latest version.');
    const bytes = Buffer.alloc(diskVersion.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('The image changed while reading.');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== diskVersion.size || after.mtimeMs !== diskVersion.mtimeMs)
      throw new Error('The image changed while reading.');
    return bytes;
  } finally { await handle.close(); }
}
