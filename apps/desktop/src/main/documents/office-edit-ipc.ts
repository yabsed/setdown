import path from 'node:path';
import { pathDialog } from '../dialogs/path-picker';
import { officeEditorFor, type OfficeEditor } from '../../core/document/document-profile';
import type { DiskVersion, DocumentSnapshot, SaveResult } from '../../protocol/desktop-api';
import type { DocxFontRequest, DocxSaveRequest, DocxSource } from '../../protocol/docx-edit';
import type { PptxSaveRequest, PptxSource } from '../../protocol/pptx-edit';
import type { WindowIpc } from '../ipc/window-ipc';
import type { WindowState } from '../windows/window-state';
import type { DocumentManager } from './document-manager';
import { canonicalPath, canonicalSavePath, sameDiskVersion, serializeFileSave } from './file-system';
import { OFFICE_PACKAGES, officePackageError, officePackageProblem, packageVersion, writeOfficePackage } from './office-package';
import { MAX_OFFICE_BYTES, readOfficeBytes } from './office-file';
import { SystemFonts } from './system-fonts';

const owned = (state: WindowState, file: string) => !state.window.isDestroyed()
  && (state.currentDocument?.path === file || state.rendererTabs.some(tab => tab.path === file && !tab.isUntitled));
type Documents = Pick<DocumentManager, 'writeWatchedFile' | 'watch'>;

/**
 * The renderer's engine owns the edited document; main owns the file. A save
 * receives a complete package, checks that it still is one of that editor's, and
 * replaces the file only when the destination is the version the tab was editing.
 */
async function savePackage(editor: OfficeEditor, state: WindowState, documents: Documents, request: DocxSaveRequest): Promise<SaveResult> {
  const doc = request?.document, bytes = request?.bytes, format = OFFICE_PACKAGES[editor];
  if (!doc || doc.kind !== 'office' || typeof doc.path !== 'string' || officeEditorFor(doc.path) !== editor || doc.isUntitled
    || !owned(state, doc.path) || !(bytes instanceof Uint8Array) || !Number.isSafeInteger(request.revision) || request.revision < 0)
    throw Error('Invalid document save request.');
  if (bytes.length > MAX_OFFICE_BYTES) throw Error('Office documents must be 128 MiB or smaller.');
  const invalid = officePackageError(bytes, editor);
  if (invalid) throw Error(invalid);
  const source = canonicalPath(doc.path);
  let target = source;
  if (request.saveAs) {
    const selected = await pathDialog.showSaveDialog(state.window, { title: `Save ${format.noun} as`, defaultPath: doc.path,
      filters: [{ name: format.name, extensions: [format.extension] }] });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    target = canonicalSavePath(path.extname(selected.filePath) ? selected.filePath : `${selected.filePath}.${format.extension}`);
    if (officeEditorFor(target) !== editor) throw Error(`Save ${format.plural} with the .${format.extension} extension.`);
    if (target !== source && state.rendererTabs.some(tab => tab.path === target))
      throw Error('Close the other tab for this destination before saving over it.');
  }
  const alive = () => owned(state, doc.path);
  return serializeFileSave(target, async () => {
    if (!alive()) throw Error('The document is no longer open.');
    const current = await packageVersion(target);
    // Saving in place continues from the version this tab read. Save As replaces whatever the reader just confirmed.
    if (target === source && (!current || !sameDiskVersion(current, doc.diskVersion)))
      throw Error('This document changed on disk. Reload it or use Save As with a different filename.');
    const version = await documents.writeWatchedFile(state, target, () => writeOfficePackage(target, bytes, current, alive, editor));
    const saved: DocumentSnapshot = { ...doc, path: target, name: path.basename(target), diskVersion: version,
      revision: request.revision, savedRevision: request.revision, text: '', savedText: '', isUntitled: false };
    if (state.currentDocument?.path === doc.path) { state.currentDocument = saved; state.activeRoot = path.dirname(target); documents.watch(state); }
    return { canceled: false, document: saved };
  });
}

/** The bytes of an open document at the version the tab holds, with the verdict on what they really are. */
async function openPackage(editor: OfficeEditor, state: WindowState, file: string, version: DiskVersion) {
  if (typeof file !== 'string' || officeEditorFor(file) !== editor || !owned(state, file)) throw Error('Document is not open in this window.');
  const bytes = await readOfficeBytes(canonicalPath(file), version);
  return { bytes, genuine: officePackageProblem(bytes, editor) === null };
}

export const saveDocx = (state: WindowState, documents: Documents, request: DocxSaveRequest) => savePackage('word', state, documents, request);
export async function openDocx(state: WindowState, file: string, version: DiskVersion): Promise<DocxSource> {
  const { bytes, genuine } = await openPackage('word', state, file, version);
  return { bytes, word: genuine };
}
export const savePptx = (state: WindowState, documents: Documents, request: PptxSaveRequest) => savePackage('presentation', state, documents, request);
export async function openPptx(state: WindowState, file: string, version: DiskVersion): Promise<PptxSource> {
  const { bytes, genuine } = await openPackage('presentation', state, file, version);
  return { bytes, presentation: genuine };
}

export function installOfficeEditIpc(channels: WindowIpc, documents: DocumentManager): void {
  // One index of the installed fonts serves both editors.
  const fonts = new SystemFonts();
  const resolve = (_state: WindowState, requests: DocxFontRequest[], held: string[]) => fonts.resolve(requests, held);
  channels.handle('docx-edit:open', openDocx);
  channels.handle('docx-edit:fonts', resolve);
  channels.handle('docx-edit:save', (state, request: DocxSaveRequest) => saveDocx(state, documents, request));
  channels.handle('pptx-edit:open', openPptx);
  channels.handle('pptx-edit:fonts', resolve);
  channels.handle('pptx-edit:save', (state, request: PptxSaveRequest) => savePptx(state, documents, request));
}
