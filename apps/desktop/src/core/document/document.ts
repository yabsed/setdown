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
