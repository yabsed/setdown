import type { PdfReadingPosition } from '../../core/reading/reading-position';

// Navigation-scoped positions are read when a retained surface is remounted.
export const webPdfPositions: Record<string, PdfReadingPosition> = {};
