import type { DiskVersion } from '../core/document/document';
import type { SaveResult } from './desktop-api';
import type { DocxEditApi, DocxSaveRequest } from './docx-edit';

/** `bytes` is the complete .pptx package the renderer's engine serialized at `revision`. */
export type PptxSaveRequest = DocxSaveRequest;
/** The file's bytes, and whether they are a presentation package. A `.pptx` name alone proves nothing. */
export type PptxSource = { bytes: Uint8Array; presentation: boolean };
export type PptxEditApi = {
  open(path: string, version: DiskVersion): Promise<PptxSource>;
  save(request: PptxSaveRequest): Promise<SaveResult>;
  /** Installed fonts for the faces a presentation names, answered as for the Word editor. */
  fonts: DocxEditApi['fonts'];
};
