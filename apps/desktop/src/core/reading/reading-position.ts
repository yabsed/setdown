import type { DiskVersion } from '../document/document';
import type { ViewportAnchor } from '../preview/viewport-anchor';

export type TextReadingPosition = {
  kind: 'text'; surface: 'editor' | 'viewer'; anchor: ViewportAnchor;
  editorView?: unknown;
};
export type PdfReadingPosition = {
  kind: 'pdf'; page: number; left: number; top: number;
  zoom: number | 'page-width' | 'page-fit' | 'auto'; rotation: number;
};
export type ImageReadingPosition = {
  kind: 'image'; zoom: number | 'fit' | 'fit-width'; rotation: number; centerX: number; centerY: number;
};
export type VideoReadingPosition = {
  kind: 'video'; time: number;
};
export type ReadingPosition = TextReadingPosition | PdfReadingPosition | ImageReadingPosition | VideoReadingPosition;
export type ReadingRecord = {
  version: 1; path: string; diskVersion: DiskVersion; position: ReadingPosition; observedAt: number;
};

export function validReadingRecord(value: unknown): value is ReadingRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as ReadingRecord;
  if (r.version !== 1 || typeof r.path !== 'string' || r.path.length > 8192
    || !Number.isFinite(r.observedAt) || r.observedAt <= 0
    || !r.diskVersion || !Number.isFinite(r.diskVersion.mtimeMs)
    || !Number.isFinite(r.diskVersion.size) || r.diskVersion.size < 0 || !r.position) return false;
  const p = r.position;
  if (p.kind === 'video') return Number.isFinite(p.time) && p.time >= 0 && p.time <= 86400;
  if (p.kind === 'image') return [0, 90, 180, 270].includes(p.rotation)
    && (p.zoom === 'fit' || p.zoom === 'fit-width' || (typeof p.zoom === 'number' && Number.isFinite(p.zoom) && p.zoom >= .1 && p.zoom <= 8))
    && Number.isFinite(p.centerX) && p.centerX >= 0 && p.centerX <= 1
    && Number.isFinite(p.centerY) && p.centerY >= 0 && p.centerY <= 1;
  if (p.kind === 'pdf') return Number.isInteger(p.page) && p.page >= 1 && p.page <= 1_000_000
    && Number.isFinite(p.left) && Number.isFinite(p.top) && Math.abs(p.left) < 1e8 && Math.abs(p.top) < 1e8
    && [0, 90, 180, 270].includes(p.rotation)
    && (['page-width', 'page-fit', 'auto'].includes(String(p.zoom))
      || (typeof p.zoom === 'number' && p.zoom >= .1 && p.zoom <= 10));
  let viewLength: number;
  try { viewLength = JSON.stringify(p.kind === 'text' ? p.editorView ?? null : null).length; }
  catch { return false; }
  return p.kind === 'text' && ['editor', 'viewer'].includes(p.surface) && !!p.anchor
    && Number.isInteger(p.anchor.sourceLine) && p.anchor.sourceLine >= 1
    && Number.isFinite(p.anchor.yRatio) && p.anchor.yRatio >= 0 && p.anchor.yRatio <= 1
    && viewLength <= 65536;
}

/** Layout-dependent Monaco state is only reusable against the exact saved file. */
export function positionForVersion(record: ReadingRecord, disk: DiskVersion): ReadingPosition {
  const position = structuredClone(record.position);
  if (position.kind === 'text' && (record.diskVersion.size !== disk.size || record.diskVersion.mtimeMs !== disk.mtimeMs)) {
    delete position.editorView;
  }
  return position;
}
