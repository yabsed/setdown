/**
 * How a document's font name finds an installed face. Word matches family names without regard
 * to case, and a font states its names in several languages and widths ("ＭＳ 明朝" is "MS 明朝").
 */
export const fontFamilyKey = (family: string): string => family.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export type FontFaceWish = { family: string; weight: number; style: 'normal' | 'italic' };
const bold = (weight: number) => weight >= 600;

/**
 * The face of one family that draws `weight` in the wished slant, or undefined. A regular face never
 * answers for bold, nor an upright one for italic: the text engine thickens or slants the nearest face
 * it has, and has to know that it is doing so.
 */
export function nearestFace<T extends { weight: number; italic: boolean }>(faces: readonly T[], weight: number, italic: boolean): T | undefined {
  let best: T | undefined;
  for (const face of faces) {
    if (face.italic !== italic || bold(face.weight) !== bold(weight)) continue;
    if (!best || Math.abs(face.weight - weight) < Math.abs(best.weight - weight)) best = face;
  }
  return best;
}
