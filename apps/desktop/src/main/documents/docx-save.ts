import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { sameDiskVersion, versionFromStat } from './file-system';
import type { DiskVersion } from '../../core/document/document';

const END_OF_DIRECTORY = 0x06054b50, DIRECTORY_ENTRY = 0x02014b50, LOCAL_ENTRY = 0x04034b50;
/** The content type of a Word document's main part. Templates and macro-enabled documents declare other types. */
const WORD_MAIN_PART = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const CONTENT_TYPES = '[Content_Types].xml', CONTENT_TYPES_LIMIT = 4 * 1024 * 1024;
type ZipEntry = { name: string; method: number; compressed: number; offset: number };

/** A ZIP archive's entries, read from its central directory only. Null when the bytes are not a readable archive. */
function zipDirectory(view: Buffer): ZipEntry[] | null {
  // The end record is 22 bytes plus a comment of at most 65535 bytes.
  let end = -1;
  for (let offset = view.length - 22, floor = Math.max(0, view.length - 22 - 0xffff); offset >= floor; offset--)
    if (view.readUInt32LE(offset) === END_OF_DIRECTORY) { end = offset; break; }
  if (end < 0) return null;
  const count = view.readUInt16LE(end + 10), size = view.readUInt32LE(end + 12), start = view.readUInt32LE(end + 16);
  // ZIP64 sentinels cannot occur below the 128 MiB document limit.
  if (count === 0xffff || start === 0xffffffff || start + size > end) return null;
  const entries: ZipEntry[] = [];
  let offset = start;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.readUInt32LE(offset) !== DIRECTORY_ENTRY) return null;
    const name = view.readUInt16LE(offset + 28), extra = view.readUInt16LE(offset + 30), comment = view.readUInt16LE(offset + 32);
    if (offset + 46 + name > end) return null;
    entries.push({ name: view.toString('utf8', offset + 46, offset + 46 + name), method: view.readUInt16LE(offset + 10),
      compressed: view.readUInt32LE(offset + 20), offset: view.readUInt32LE(offset + 42) });
    offset += 46 + name + extra + comment;
  }
  return entries;
}
/** One small text entry, inflated with a hard output limit. Null when it is damaged or larger than `limit`. */
function zipEntryText(view: Buffer, entry: ZipEntry, limit: number): string | null {
  if (entry.offset + 30 > view.length || view.readUInt32LE(entry.offset) !== LOCAL_ENTRY) return null;
  const start = entry.offset + 30 + view.readUInt16LE(entry.offset + 26) + view.readUInt16LE(entry.offset + 28);
  if (start + entry.compressed > view.length) return null;
  const data = view.subarray(start, start + entry.compressed);
  try {
    if (entry.method === 0) return data.length > limit ? null : data.toString('utf8');
    return entry.method === 8 ? inflateRawSync(data, { maxOutputLength: limit }).toString('utf8') : null;
  } catch { return null; }
}
const buffer = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const attribute = (element: string, name: string) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(element);
  return match ? match[1] ?? match[2] : undefined;
};

/** Entry names of a ZIP archive, or null when the bytes are not a readable archive. */
export const zipEntryNames = (bytes: Uint8Array): string[] | null => zipDirectory(buffer(bytes))?.map(entry => entry.name) ?? null;

/**
 * Whether `bytes` is a WordprocessingML document package: an archive whose content
 * types declare a Word main document part that is present. The name of a file proves
 * nothing; a spreadsheet, a legacy binary document or a web page can carry `.docx`.
 * Returns what is wrong: not an archive at all, or an archive that is not a Word document.
 */
export function wordPackageProblem(bytes: Uint8Array): 'archive' | 'word' | null {
  const view = buffer(bytes), entries = zipDirectory(view);
  if (!entries) return 'archive';
  const types = entries.find(entry => entry.name === CONTENT_TYPES);
  if (!types) return 'word';
  const xml = zipEntryText(view, types, CONTENT_TYPES_LIMIT);
  if (xml === null) return 'archive';
  // Part names are case-insensitive and written with a leading slash.
  const names = new Set(entries.map(entry => entry.name.toLowerCase()));
  for (const [override] of xml.matchAll(/<Override\b[^>]*>/g)) {
    const part = attribute(override, 'PartName');
    if (attribute(override, 'ContentType') === WORD_MAIN_PART && part && names.has(part.replace(/^\//, '').toLowerCase())) return null;
  }
  return 'word';
}

/** Why `bytes` must not be written as a Word document, or null when it is one. */
export function docxPackageError(bytes: Uint8Array): string | null {
  const problem = wordPackageProblem(bytes);
  return problem === 'archive' ? 'The editor produced data that is not a Word document. Nothing was written.'
    : problem === 'word' ? 'The editor produced a package without a Word document part. Nothing was written.' : null;
}

export async function docxVersion(file: string): Promise<DiskVersion | null> {
  try { return versionFromStat(await fs.stat(file)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

/**
 * Replaces `file` with `bytes` through a sibling temporary file and one rename, so a
 * crash leaves either the previous document or the new one. `expected` is the
 * destination's version this save was prepared against (null: it must not exist);
 * a destination that moved on in the meantime is never overwritten.
 */
export async function writeDocx(file: string, bytes: Uint8Array, expected: DiskVersion | null, valid: () => boolean): Promise<DiskVersion> {
  const invalid = docxPackageError(bytes);
  if (invalid) throw Error(invalid);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const stat = await fs.stat(file).catch(() => null);
    // The bytes are on disk before the rename can make them the document.
    const output = await fs.open(temporary, 'wx', stat?.mode);
    try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
    if (stat) await fs.chmod(temporary, stat.mode);
    const handle = await fs.open(temporary, 'r');
    try {
      const current = await docxVersion(file);
      if (!valid()) throw Error('The document is no longer open.');
      if (!!expected !== !!current || (expected && current && !sameDiskVersion(expected, current)))
        throw Error('The document changed on disk while saving. Reload it or use Save As with a different filename.');
      await fs.rename(temporary, file);
      return versionFromStat(await handle.stat());
    } finally { await handle.close(); }
  } finally { await fs.rm(temporary, { force: true }); }
}
