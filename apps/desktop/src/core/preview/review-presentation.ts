/** A final presentation intent, not a cache certificate from another process. */
export type ReviewBounds = { x: number; y: number; width: number; height: number };
export type ReviewPosition = {
  sourceLine: number; topRatio: number; sourceSide: 'before' | 'after';
  band: { sourceLine: number; yRatio: number }[]; blockOffset?: number;
};
export type ReviewPresentationRequest = {
  presentationId: number; bounds: ReviewBounds; position: ReviewPosition | null;
};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positiveId = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value > 0;
export function readReviewPresentation(value: unknown): ReviewPresentationRequest | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<ReviewPresentationRequest>;
  const box = input.bounds;
  if (!positiveId(input.presentationId) || !box
    || ![box.x, box.y, box.width, box.height].every(finite)
    || box.width <= 0 || box.height <= 0
    || Math.max(Math.abs(box.x), Math.abs(box.y), box.width, box.height) > 100_000) return null;
  const bounds = { x: box.x, y: box.y, width: box.width, height: box.height };
  if (input.position === null) return { presentationId: input.presentationId, bounds, position: null };
  const pos = input.position;
  if (!pos || !positiveId(pos.sourceLine) || !finite(pos.topRatio) || pos.topRatio < 0 || pos.topRatio > 1
    || !['before', 'after'].includes(pos.sourceSide) || !Array.isArray(pos.band) || pos.band.length > 2048
    || (pos.blockOffset !== undefined && (!finite(pos.blockOffset) || pos.blockOffset < 0 || pos.blockOffset > 1))) return null;
  const band: ReviewPosition['band'] = [];
  for (const line of pos.band) {
    if (!line || !positiveId(line.sourceLine) || !finite(line.yRatio) || line.yRatio < 0 || line.yRatio > 1) return null;
    band.push({ sourceLine: line.sourceLine, yRatio: line.yRatio });
  }
  return { presentationId: input.presentationId, bounds, position: {
    sourceLine: pos.sourceLine, topRatio: pos.topRatio, sourceSide: pos.sourceSide, band,
    ...(pos.blockOffset !== undefined ? { blockOffset: pos.blockOffset } : {}),
  } };
}
