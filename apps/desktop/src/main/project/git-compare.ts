// Each side of a comparison, read for display.
//
// A document that is edited is decoded strictly (`text-codec.ts`): bytes that are not UTF-8, mixed
// line endings and control characters are refused, so that saving never rewrites what was not
// understood. A comparison is only read. VS Code compares such files as text (its diff input is
// two read-only resources; `src/vs/workbench/common/editor/diffEditorInput.ts`), and `git diff`
// prints them. So here the refusals of the strict decoder become a note beside the text, the
// comparison is read-only, and the person is told what was done to show it. Only what is no text
// at all (a NUL byte) or too long to hold is left without text, with its size and the reason.
import { promises as fs } from 'node:fs';
import { isMarkdownDocument, isOfficeDocument, isPdfDocument, isTextCandidate } from '../../core/document/document-profile';
import { decodeTextBytes, MAX_TEXT_FILE_BYTES, textLineEnding } from '../../core/document/text-codec';
import type { GitFileVersion, GitSideNote } from '../../protocol/desktop-api';
import { GitCli } from './engines/git-cli';

/** The most bytes of one version handed to a reader, as for images (`image-file.ts`). */
export const MAX_COMPARED_FILE_BYTES = 64 * 1024 * 1024;
export type ComparedText = { text: string | null; note: GitSideNote };
/** A version that does not exist: an added file's left side, a deleted file's right side. */
export const missingSide: ComparedText = Object.freeze({ text: '', note: Object.freeze({ missing: true }) });

/** PDF and Office files have a reader in Setdown, so their two versions are shown side by side. */
export const comparedDocumentKind = (filePath: string): 'pdf' | 'office' | undefined =>
  isPdfDocument(filePath) ? 'pdf' : isOfficeDocument(filePath) ? 'office' : undefined;

/** Text for reading, with what was done to read it. Markdown keeps the reading it always had:
 * its documents are opened as UTF-8 without the strict refusals, so its comparison is too. */
export function comparisonText(bytes: Uint8Array, markdown = false): ComparedText {
  const size = bytes.byteLength;
  if (markdown) return bytes.includes(0) ? { text: null, note: { size, reason: 'binary' } } : { text: Buffer.from(bytes).toString('utf8'), note: { size } };
  if (size > MAX_TEXT_FILE_BYTES) return { text: null, note: { size, reason: 'large' } };
  try { return { text: decodeTextBytes(bytes).text, note: { size } }; } catch { /* Read below as VS Code would. */ }
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : undefined;
  if (utf16) {
    const text = new TextDecoder(utf16).decode(bytes);
    return text.includes('\0') ? { text: null, note: { size, reason: 'binary' } } : { text, note: { size, reason: 'encoding', detail: 'UTF-16' } };
  }
  if (bytes.includes(0)) return { text: null, note: { size, reason: 'binary' } };
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, body = bom ? bytes.subarray(3) : bytes;
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body); }
  catch { return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(body), note: { size, reason: 'encoding' } }; }
  try { textLineEnding(text); } catch { return { text, note: { size, reason: 'line-endings' } }; }
  return { text, note: { size, reason: 'control' } };
}

/** A submodule is recorded as the commit it is at; `git diff` prints it as this line. */
const subproject = (oid: string): ComparedText => ({ text: `Subproject commit ${oid}\n`, note: { submodule: true } });
/** The commit a submodule entry names, for `<revision>:<path>` and for the index (`:<path>`, `:<stage>:<path>`). */
async function gitlink(repository: GitCli, specification: string): Promise<string | undefined> {
  const at = specification.indexOf(':');
  if (at < 0) return undefined;
  const revision = specification.slice(0, at), rest = specification.slice(at + 1);
  try {
    if (revision) return /^160000 commit ([0-9a-f]{40,64})\t/.exec(await repository.run(['ls-tree', revision, '--', rest]))?.[1];
    const staged = /^([1-3]):(.+)$/s.exec(rest), stage = staged?.[1] ?? '0';
    for (const line of (await repository.run(['ls-files', '-s', '--', staged?.[2] ?? rest])).split('\n')) {
      const entry = /^160000 ([0-9a-f]{40,64}) ([0-3])\t/.exec(line);
      if (entry && entry[2] === stage) return entry[1];
    }
  } catch { /* Not an entry of that tree. */ }
  return undefined;
}
async function objectType(repository: GitCli, specification: string): Promise<string | undefined> {
  try { return (await repository.run(['cat-file', '-t', specification])).trim(); } catch { return undefined; }
}
async function blobSize(repository: GitCli, specification: string): Promise<number | undefined> {
  try {
    const size = Number((await repository.run(['cat-file', '-s', specification])).trim());
    return Number.isSafeInteger(size) && size >= 0 ? size : undefined;
  } catch { return undefined; }
}

/** One stored version of a file as text. Git's own "binary" for a change is not asked: it means a NUL
 * among the first bytes, which UTF-16 text has too. The bytes decide here.
 *
 * A file that is there costs two git processes, its size and its bytes, as a comparison did before
 * these notes existed: this is what a Markdown review waits for before it can prepare its reader.
 * Whether the entry is a submodule is asked only when it is not a file: `cat-file -s` and
 * `cat-file blob` both refuse the commit a submodule's entry names. */
export async function gitComparedText(repository: GitCli, specification: string | undefined, filePath: string): Promise<ComparedText> {
  if (!specification) return missingSide;
  const other = async (): Promise<ComparedText> => { const link = await gitlink(repository, specification); return link ? subproject(link) : missingSide; };
  try {
    const size = await blobSize(repository, specification);
    if (size === undefined) return await other();
    const markdown = isMarkdownDocument(filePath);
    // Nothing reads a file that has no text to show, so its kind is asked: a submodule's commit that this repository happens to hold has a size too.
    if (!markdown && !isTextCandidate(filePath)) return await objectType(repository, specification) === 'blob' ? { text: null, note: { size, reason: 'binary' } } : await other();
    if (size > MAX_TEXT_FILE_BYTES) return { text: null, note: { size, reason: 'large' } };
    let bytes: Buffer;
    try { bytes = await repository.runBytes(['cat-file', 'blob', specification]); }
    catch (error) { const link = await gitlink(repository, specification); if (link) return subproject(link); throw error; }
    return comparisonText(bytes, markdown);
  } catch (error) {
    return { text: null, note: { reason: 'unreadable', detail: error instanceof Error ? error.message : String(error) } };
  }
}

/** The file as it is on disk now. */
export async function workingComparedText(filePath: string): Promise<ComparedText> {
  try {
    const entry = await fs.lstat(filePath);
    if (entry.isSymbolicLink()) return { text: await fs.readlink(filePath), note: { size: entry.size } };
    if (entry.isDirectory()) {
      // A submodule's folder: the commit it has checked out.
      const head = await GitCli.run(filePath, ['rev-parse', 'HEAD']).catch(() => '');
      return /^[0-9a-f]{40,64}$/.test(head.trim()) ? subproject(head.trim()) : { text: null, note: { reason: 'unreadable', detail: 'This is a folder.' } };
    }
    if (!entry.isFile()) return { text: null, note: { reason: 'unreadable', detail: 'This is not a regular file.' } };
    if (!isMarkdownDocument(filePath) && !isTextCandidate(filePath)) return { text: null, note: { size: entry.size, reason: 'binary' } };
    if (entry.size > MAX_TEXT_FILE_BYTES) return { text: null, note: { size: entry.size, reason: 'large' } };
    return comparisonText(await fs.readFile(filePath), isMarkdownDocument(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return missingSide;
    return { text: null, note: { reason: 'unreadable', detail: error instanceof Error ? error.message : String(error) } };
  }
}

/** One stored version's bytes for a reader. Never the working file in its place. */
export async function gitComparedFile(repository: GitCli, specification: string | undefined): Promise<GitFileVersion> {
  if (!specification) return null;
  try {
    const size = await blobSize(repository, specification);
    // No size: the file is not in this version.
    if (size === undefined) return null;
    if (size > MAX_COMPARED_FILE_BYTES) throw Error(`This version is ${(size / 1024 / 1024).toFixed(1)} MB. Versions up to 64 MB are shown.`);
    const bytes = await repository.runBytes(['show', specification], 20_000, MAX_COMPARED_FILE_BYTES);
    return { bytes };
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}
export async function workingComparedFile(filePath: string): Promise<GitFileVersion> {
  try {
    const entry = await fs.lstat(filePath);
    if (!entry.isFile()) throw Error('This is not a regular file.');
    if (entry.size > MAX_COMPARED_FILE_BYTES) throw Error(`This file is ${(entry.size / 1024 / 1024).toFixed(1)} MB. Versions up to 64 MB are shown.`);
    return { bytes: await fs.readFile(filePath) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const fileNote = (version: GitFileVersion): GitSideNote => !version ? { missing: true }
  : 'bytes' in version ? { size: version.bytes.byteLength } : { reason: 'unreadable', detail: version.error };
/** The notes of a comparison whose sides are shown by a reader. */
export const fileNotes = (original: GitFileVersion, modified: GitFileVersion) => ({ original: fileNote(original), modified: fileNote(modified) });
/** A comparison is read-only when a side was read past the strict decoder. */
export const readPastStrict = (...sides: ComparedText[]): boolean =>
  sides.some(side => side.note.reason === 'encoding' || side.note.reason === 'line-endings' || side.note.reason === 'control' || side.note.submodule);
