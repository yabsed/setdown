import type { DiskVersion, DocumentSnapshot } from '../core/document/document';
import type { SaveResult } from './desktop-api';

/** `bytes` is the complete .docx package the renderer's engine serialized at `revision`. */
export type DocxSaveRequest = { document: DocumentSnapshot; bytes: Uint8Array; revision: number; saveAs: boolean };
/** The file's bytes, and whether they are a Word document package. A `.docx` name alone proves nothing. */
export type DocxSource = { bytes: Uint8Array; word: boolean };
/** A face the document's text needs, in the family name the document wrote. */
export type DocxFontRequest = { family: string; weight: number; style: 'normal' | 'italic' };
/**
 * An installed face that draws `family` at `weight` and `style`. When the wished face is missing the nearest
 * one of the family is stated as what it is (a regular face under 400), so the engine thickens or slants it.
 */
export type DocxFontFace = DocxFontRequest & {
  /** Another installed family that draws it because `family` itself is not installed. */
  standIn?: string;
  /** The line Word gives `family`, kept when a stand-in draws it. Em ratios of the font size. */
  lineBox?: { heightEm: number; baselineEm: number };
  /** The font file among `files`, or one the caller said it already holds, and the face inside a collection. */
  file: string; index: number; bytes: number;
};
export type DocxFontAnswer = { faces: DocxFontFace[]; files: { id: string; bytes: Uint8Array }[] };
export type DocxEditApi = {
  open(path: string, version: DiskVersion): Promise<DocxSource>;
  save(request: DocxSaveRequest): Promise<SaveResult>;
  /** Installed fonts for the faces a document names. `held` lists font files the caller still has, which are not sent again. */
  fonts(requests: DocxFontRequest[], held: string[]): Promise<DocxFontAnswer>;
};
