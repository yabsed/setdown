import type { TextEncoding, TextEol } from './text-codec';

export type DiskVersion = {
  mtimeMs: number;
  size: number;
};

export type DocumentSnapshot = {
  /** PDF, image and video snapshots carry metadata only; no text model is created. */
  kind?: 'pdf' | 'image' | 'video';
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
};
