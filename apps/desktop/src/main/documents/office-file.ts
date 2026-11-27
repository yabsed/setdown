import { versionFromStat } from './file-system';
import { constants, promises as fs } from 'node:fs';
import type { DiskVersion } from '../../core/document/document';
import { isOfficeDocument, officeEditorFor, type OfficeEditor } from '../../core/document/document-profile';
import { officePackageProblem } from './office-package';

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
async function readAll(handle: fs.FileHandle, size: number): Promise<Uint8Array | null> {
  const bytes = Buffer.alloc(size);
  for (let offset = 0; offset < size;) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
    if (!bytesRead) return null;
    offset += bytesRead;
  }
  return bytes;
}
/** Legacy files may carry HTML, text or XML under an Office extension; the viewer decides, so no signature is required to open one.
 * Only a `.docx` whose bytes are a Word document package and a `.pptx` whose bytes are a presentation package are marked
 * for their editor; anything else under those names stays read-only. */
export async function readOfficeMetadata(file: string): Promise<{ kind: 'office'; text: ''; diskVersion: DiskVersion; officeEditor?: OfficeEditor }> {
  const { handle, diskVersion } = await openOffice(file);
  try {
    const editor = officeEditorFor(file);
    if (!editor) return { kind: 'office', text: '', diskVersion };
    const bytes = await readAll(handle, diskVersion.size);
    return { kind: 'office', text: '', diskVersion, ...(bytes && officePackageProblem(bytes, editor) === null ? { officeEditor: editor } : {}) };
  } finally { await handle.close(); }
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
