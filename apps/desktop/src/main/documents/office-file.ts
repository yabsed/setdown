import { versionFromStat } from './file-system';
import { constants, promises as fs } from 'node:fs';
import type { DiskVersion } from '../../core/document/document';
import { isOfficeDocument } from '../../core/document/document-profile';

/** The viewer parses the whole file in renderer memory, so the input is bounded. */
export const MAX_OFFICE_BYTES = 128 * 1024 * 1024;
async function openOffice(file: string) {
  if (!isOfficeDocument(file)) throw new Error('Unsupported Office format.');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Only regular Office files can be opened.');
    if (stat.size > MAX_OFFICE_BYTES) throw new Error('Office documents must be 128 MiB or smaller.');
    return { handle, diskVersion: versionFromStat(stat) };
  } catch (error) { await handle.close(); throw error; }
}
/** Legacy files may carry HTML, text or XML under an Office extension; the viewer decides, so no signature is required here. */
export async function readOfficeMetadata(file: string) {
  const { handle, diskVersion } = await openOffice(file);
  await handle.close();
  return { kind: 'office' as const, text: '', diskVersion };
}
export async function readOfficeBytes(file: string, version: DiskVersion): Promise<Uint8Array> {
  const { handle, diskVersion } = await openOffice(file);
  try {
    if (!version || version.size !== diskVersion.size || version.mtimeMs !== diskVersion.mtimeMs)
      throw new Error('The document changed. Reload it to read the latest version.');
    const bytes = Buffer.alloc(diskVersion.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('The document changed while reading.');
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== diskVersion.size || after.mtimeMs !== diskVersion.mtimeMs)
      throw new Error('The document changed while reading.');
    return bytes;
  } finally { await handle.close(); }
}
