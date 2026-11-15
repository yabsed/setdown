import type { DiskVersion, DocumentSnapshot } from '../core/document/document';
import type { SaveResult } from './desktop-api';

/** `bytes` is the complete .docx package the renderer's engine serialized at `revision`. */
export type DocxSaveRequest = { document: DocumentSnapshot; bytes: Uint8Array; revision: number; saveAs: boolean };
/** The file's bytes, and whether they are a Word document package. A `.docx` name alone proves nothing. */
export type DocxSource = { bytes: Uint8Array; word: boolean };
export type DocxEditApi = {
  open(path: string, version: DiskVersion): Promise<DocxSource>;
  save(request: DocxSaveRequest): Promise<SaveResult>;
};
