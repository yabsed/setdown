import type { TextEncoding, TextEol } from './text-codec';

export type DiskVersion = {
  mtimeMs: number;
  size: number;
  ctimeMs?: number;
  ino?: number;
  dev?: number;
};

export const sameDiskVersion = (a: DiskVersion, b: DiskVersion): boolean => (
  a.mtimeMs === b.mtimeMs && a.size === b.size
  && (a.ctimeMs === undefined || b.ctimeMs === undefined || a.ctimeMs === b.ctimeMs)
  && (a.ino === undefined || b.ino === undefined || a.ino === b.ino)
  && (a.dev === undefined || b.dev === undefined || a.dev === b.dev)
);

export type DocumentSnapshot = {
  /** One-shot save metadata, consumed when merging a draft save into a live buffer. */
  assetRelocation?: import('../markdown/asset-references').AssetRelocation;
  /** Binary document snapshots carry metadata only; no text model is created. */
  kind?: 'pdf' | 'image' | 'video' | 'office';
  /** Set by main when an Office document's bytes are the package its name says: a Word document for `.docx`,
   * a presentation for `.pptx`. That editor opens, edits and saves it. Absent, the read-only Office viewer
   * shows the file whatever it is named. */
  officeEditor?: import('./document-profile').OfficeEditor;
  readingPosition?: import('../reading/reading-position').ReadingPosition;
  path: string;
  name: string;
  text: string;
  /** 마지막으로 확인한 디스크 내용. dirty 여부의 기준이다. */
  savedText: string;
  revision: number;
  savedRevision: number;
  diskVersion: DiskVersion;
  isUntitled: boolean;
  /** Absent on legacy Markdown snapshots. Owned by the document, not the window. */
  encoding?: TextEncoding;
  eol?: TextEol;
  /** A text file read and saved in pieces (`text-codec.ts`). Its text lives only in the editor
   * model: `text` and `savedText` stay empty here and in every message that carries the snapshot. */
  large?: { bytes: number; lines?: number };
};

export const isLargeText = (document: Pick<DocumentSnapshot, 'large'>): boolean => document.large !== undefined;
