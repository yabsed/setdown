import path from 'node:path';
import { pathDialog } from '../dialogs/path-picker';
import { isEditableOfficeDocument } from '../../core/document/document-profile';
import type { DiskVersion, DocumentSnapshot, SaveResult } from '../../protocol/desktop-api';
import type { DocxFontRequest, DocxSaveRequest, DocxSource } from '../../protocol/docx-edit';
import type { WindowIpc } from '../ipc/window-ipc';
import type { WindowState } from '../windows/window-state';
import type { DocumentManager } from './document-manager';
import { canonicalPath, canonicalSavePath, sameDiskVersion, serializeFileSave } from './file-system';
import { docxPackageError, docxVersion, wordPackageProblem, writeDocx } from './docx-save';
import { MAX_OFFICE_BYTES, readOfficeBytes } from './office-file';
import { SystemFonts } from './system-fonts';

const owned = (state: WindowState, file: string) => !state.window.isDestroyed()
  && (state.currentDocument?.path === file || state.rendererTabs.some(tab => tab.path === file && !tab.isUntitled));

/**
 * The renderer's engine owns the edited document; main owns the file. A save
 * receives a complete package, checks that it still is one, and replaces the file
 * only when the destination is the version the tab was editing.
 */
export async function saveDocx(state: WindowState, documents: Pick<DocumentManager, 'writeWatchedFile' | 'watch'>, request: DocxSaveRequest): Promise<SaveResult> {
  const doc = request?.document, bytes = request?.bytes;
  if (!doc || doc.kind !== 'office' || typeof doc.path !== 'string' || !isEditableOfficeDocument(doc.path) || doc.isUntitled
    || !owned(state, doc.path) || !(bytes instanceof Uint8Array) || !Number.isSafeInteger(request.revision) || request.revision < 0)
    throw Error('Invalid document save request.');
  if (bytes.length > MAX_OFFICE_BYTES) throw Error('Office documents must be 128 MiB or smaller.');
  const invalid = docxPackageError(bytes);
  if (invalid) throw Error(invalid);
  const source = canonicalPath(doc.path);
  let target = source;
  if (request.saveAs) {
    const selected = await pathDialog.showSaveDialog(state.window, { title: 'Save document as', defaultPath: doc.path,
      filters: [{ name: 'Word document', extensions: ['docx'] }] });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    target = canonicalSavePath(path.extname(selected.filePath) ? selected.filePath : `${selected.filePath}.docx`);
    if (!isEditableOfficeDocument(target)) throw Error('Save Word documents with the .docx extension.');
    if (target !== source && state.rendererTabs.some(tab => tab.path === target))
      throw Error('Close the other tab for this destination before saving over it.');
  }
  const alive = () => owned(state, doc.path);
  return serializeFileSave(target, async () => {
    if (!alive()) throw Error('The document is no longer open.');
    const current = await docxVersion(target);
    // Saving in place continues from the version this tab read. Save As replaces whatever the reader just confirmed.
    if (target === source && (!current || !sameDiskVersion(current, doc.diskVersion)))
      throw Error('This document changed on disk. Reload it or use Save As with a different filename.');
    const version = await documents.writeWatchedFile(state, target, () => writeDocx(target, bytes, current, alive));
    const saved: DocumentSnapshot = { ...doc, path: target, name: path.basename(target), diskVersion: version,
      revision: request.revision, savedRevision: request.revision, text: '', savedText: '', isUntitled: false };
    if (state.currentDocument?.path === doc.path) { state.currentDocument = saved; state.activeRoot = path.dirname(target); documents.watch(state); }
    return { canceled: false, document: saved };
  });
}

/** The bytes of an open `.docx` at the version the tab holds, with the verdict on what they really are. */
export async function openDocx(state: WindowState, file: string, version: DiskVersion): Promise<DocxSource> {
  if (typeof file !== 'string' || !isEditableOfficeDocument(file) || !owned(state, file)) throw Error('Document is not open in this window.');
  const bytes = await readOfficeBytes(canonicalPath(file), version);
  return { bytes, word: wordPackageProblem(bytes) === null };
}

export function installDocxEditIpc(channels: WindowIpc, documents: DocumentManager): void {
  const fonts = new SystemFonts();
  channels.handle('docx-edit:open', openDocx);
  channels.handle('docx-edit:fonts', (_state, requests: DocxFontRequest[], held: string[]) => fonts.resolve(requests, held));
  channels.handle('docx-edit:save', (state, request: DocxSaveRequest) => saveDocx(state, documents, request));
}
