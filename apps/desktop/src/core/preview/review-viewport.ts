import { GOLDEN_TOP_RATIO, clamp, type BandLine, type ViewportAnchor } from './viewport-anchor';

/** Git's before/after source lines are distinct coordinate systems. */
export type ReviewSourceSide = 'before' | 'after';
export type ReviewViewport = {
  anchor: ViewportAnchor;
  band: BandLine[];
  sourceSide: ReviewSourceSide;
  /** Fraction within the rendered block. Only Viewer bookmarks use this. */
  blockOffset?: number;
};

export function reviewViewport(line = 1): ReviewViewport {
  return {
    anchor: { sourceLine: Math.max(1, Math.round(line) || 1), yRatio: GOLDEN_TOP_RATIO,
      reason: 'scroll-ratio', confidence: 'fallback' },
    band: [], sourceSide: 'after',
  };
}

/** Parse a preview-runtime bookmark without trusting event payloads. */
export function readReviewBookmark(value: unknown): ReviewViewport | null {
  if (!value || typeof value !== 'object') return null;
  const anchor = value as Partial<ViewportAnchor> & {
    sourceSide?: unknown; blockOffset?: unknown;
  };
  if (typeof anchor.sourceLine !== 'number' || !Number.isFinite(anchor.sourceLine)
    || anchor.sourceLine < 1 || typeof anchor.yRatio !== 'number'
    || !Number.isFinite(anchor.yRatio)) return null;
  const result = reviewViewport(anchor.sourceLine);
  result.anchor.yRatio = clamp(anchor.yRatio, 0, 1);
  if (typeof anchor.sourceColumn === 'number' && Number.isFinite(anchor.sourceColumn)
    && anchor.sourceColumn >= 1) result.anchor.sourceColumn = Math.round(anchor.sourceColumn);
  result.sourceSide = anchor.sourceSide === 'before' ? 'before' : 'after';
  if (typeof anchor.blockOffset === 'number' && Number.isFinite(anchor.blockOffset)) {
    result.blockOffset = clamp(anchor.blockOffset, 0, 1);
  }
  return result;
}

export function reviewPositionCommand(viewport: ReviewViewport): Record<string, unknown> {
  return {
    command: 'marktex:position-preview', sourceLine: viewport.anchor.sourceLine,
    topRatio: viewport.anchor.yRatio, band: viewport.band,
    sourceSide: viewport.sourceSide, blockOffset: viewport.blockOffset, settle: false,
  };
}
