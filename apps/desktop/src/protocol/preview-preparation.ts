import type { ReviewPosition } from '../core/preview/review-presentation';

/** CSS pixels until PreviewManager converts to native DIP exactly once. */
export type PreviewBounds = { x: number; y: number; width: number; height: number };
export type PreparationPosition = Pick<ReviewPosition, 'sourceLine'> & Partial<Omit<ReviewPosition, 'sourceLine'>>;
export type PrimeDocumentCommand = { command: 'marktex:prime-document'; bounds: PreviewBounds };
export type PrimeReviewCommand = {
  command: 'marktex:prime-review'; bounds: PreviewBounds; position: PreparationPosition; primeId?: number;
};
export type RuntimePreparationCommand =
  | { command: 'marktex:prepare-document' }
  | ({ command: 'marktex:prime-position'; primeId: number } & PreparationPosition)
  | ({ command: 'marktex:prepare-review'; revision: number; requestId: number | `present:${number}`;
      primeId?: number } & PreparationPosition);

/** IPC is untrusted even when callers use the shared types. Preserve fractions. */
export function readPreviewBounds(value: unknown): PreviewBounds | null {
  if (!value || typeof value !== 'object') return null;
  const bounds = value as PreviewBounds;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(n => typeof n === 'number' && Number.isFinite(n))
    || bounds.width <= 0 || bounds.height <= 0) return null;
  return { x: Math.max(0, Math.min(100_000, bounds.x)), y: Math.max(0, Math.min(100_000, bounds.y)),
    width: Math.min(100_000, bounds.width), height: Math.min(100_000, bounds.height) };
}

export function isRuntimePreparationCommand(value: unknown): value is RuntimePreparationCommand {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (message.command === 'marktex:prepare-document') return true;
  if (typeof message.sourceLine !== 'number' || !Number.isFinite(message.sourceLine) || message.sourceLine <= 0) return false;
  for (const key of ['topRatio', 'blockOffset']) if (message[key] !== undefined
    && (typeof message[key] !== 'number' || !Number.isFinite(message[key]))) return false;
  if (message.sourceSide !== undefined && message.sourceSide !== 'before' && message.sourceSide !== 'after') return false;
  if (message.band !== undefined && (!Array.isArray(message.band) || message.band.length > 2048
    || !message.band.every(sample => sample && typeof sample.sourceLine === 'number' && Number.isFinite(sample.sourceLine)
      && typeof sample.yRatio === 'number' && Number.isFinite(sample.yRatio)))) return false;
  if (message.primeId !== undefined && (!Number.isSafeInteger(message.primeId) || Number(message.primeId) < 0)) return false;
  if (message.command === 'marktex:prime-position') return Number.isSafeInteger(message.primeId) && Number(message.primeId) >= 0;
  return message.command === 'marktex:prepare-review'
    && Number.isSafeInteger(message.revision) && Number(message.revision) >= 0
    && ((Number.isSafeInteger(message.requestId) && Number(message.requestId) > 0)
      || (typeof message.requestId === 'string' && /^present:[1-9]\d*$/.test(message.requestId)));
}
