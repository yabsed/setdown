/**
 * What an installed font file says about itself: the faces it holds and the family names,
 * weight and slant of each. Only the table directory, `name`, `OS/2` and `head` are read, so a
 * 30 MiB collection costs a few kilobytes to describe. Nothing here touches the file system.
 */

/**
 * A face under one of its family names. One face has several: per language, and per naming scheme.
 * `weight` is the place it takes in that family; `design` is the weight the font states for itself.
 * `linked` marks the regular and bold places of a four-style family, which is what Word's bold button
 * switches between: NanumGothicBold.ttf is the linked bold of "NanumGothic" although it states 600,
 * while NanumGothicExtraBold.ttf states 700 and is only a weight of that family.
 */
export type FontFaceName = { family: string; weight: number; design: number; linked: boolean; italic: boolean };
export type FontFileFace = {
  /** Position inside a collection (`.ttc`); 0 for a single font. */
  index: number;
  /** The face has variation axes. One file then draws every weight, which a fixed face cannot state. */
  variable: boolean;
  names: FontFaceName[];
};
/** Reads `length` bytes at `offset`; fewer when the file ends first. */
export type FontRangeReader = (offset: number, length: number) => Promise<Uint8Array>;

const MAX_FACES = 64, MAX_TABLES = 128, MAX_NAME_BYTES = 512 * 1024, MAX_NAME_RECORDS = 4096, MAX_FAMILY_LENGTH = 128;
const tag = (text: string) => (text.charCodeAt(0) << 24 | text.charCodeAt(1) << 16 | text.charCodeAt(2) << 8 | text.charCodeAt(3)) >>> 0;
const TTCF = tag('ttcf'), NAME = tag('name'), OS2 = tag('OS/2'), HEAD = tag('head'), FVAR = tag('fvar');
// TrueType outlines, CFF outlines, and Apple's TrueType tag.
const SFNT = new Set([0x00010000, tag('OTTO'), tag('true')]);
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const utf16be = new TextDecoder('utf-16be');

/** A name-table string as text, or '' when its encoding is not one a family name is matched in. */
function decodeName(platform: number, encoding: number, bytes: Uint8Array): string {
  let text = '';
  // Unicode, and Windows in its Unicode encodings (BMP and full repertoire). Symbol fonts use encoding 0 the same way.
  if (platform === 0 || (platform === 3 && (encoding === 0 || encoding === 1 || encoding === 10))) {
    if (bytes.length % 2) return '';
    text = utf16be.decode(bytes);
  } else if (platform === 1 && encoding === 0) {
    // Mac Roman: its ASCII half is unambiguous, and that is all an English family name needs.
    for (const byte of bytes) { if (byte < 0x20 || byte > 0x7e) return ''; text += String.fromCharCode(byte); }
  }
  text = text.replace(/\0/g, '').trim();
  return text.length && text.length <= MAX_FAMILY_LENGTH ? text : '';
}

async function readFace(read: FontRangeReader, base: number, index: number): Promise<FontFileFace | null> {
  const header = view(await read(base, 12));
  if (header.byteLength < 12 || !SFNT.has(header.getUint32(0))) return null;
  const count = header.getUint16(4);
  if (!count || count > MAX_TABLES) return null;
  const directory = view(await read(base + 12, count * 16));
  if (directory.byteLength < count * 16) return null;
  const tables = new Map<number, { offset: number; length: number }>();
  for (let record = 0; record < count * 16; record += 16)
    tables.set(directory.getUint32(record), { offset: directory.getUint32(record + 8), length: directory.getUint32(record + 12) });

  let weight = 400, bold = false, italic = false;
  const os2 = tables.get(OS2), head = tables.get(HEAD);
  const style = os2 && os2.length >= 64 ? view(await read(os2.offset, 64)) : null;
  if (style && style.byteLength >= 64) {
    const stated = style.getUint16(4), selection = style.getUint16(62);
    if (stated >= 1 && stated <= 1000) weight = stated;
    // fsSelection: bit 0 italic, bit 5 bold, bit 9 oblique.
    italic = (selection & 0x201) !== 0; bold = (selection & 0x20) !== 0;
  } else if (head && head.length >= 46) {
    const stated = view(await read(head.offset + 44, 2));
    // macStyle: bit 0 bold, bit 1 italic.
    if (stated.byteLength >= 2) { bold = (stated.getUint16(0) & 1) !== 0; italic = (stated.getUint16(0) & 2) !== 0; if (bold) weight = 700; }
  }

  const names: FontFaceName[] = [];
  const add = (family: string, as: number, linked: boolean) => {
    if (family && !names.some(name => name.family === family && name.weight === as)) names.push({ family, weight: as, design: weight, linked, italic });
  };
  const table = tables.get(NAME);
  if (table && table.length >= 6) {
    const bytes = await read(table.offset, Math.min(table.length, MAX_NAME_BYTES)), data = view(bytes);
    const records = data.byteLength >= 6 ? Math.min(data.getUint16(2), MAX_NAME_RECORDS) : 0, strings = records ? data.getUint16(4) : 0;
    // Macintosh records group every weight under one family name even in ID 1, so they only speak for a font
    // that has no Windows or Unicode names at all.
    const found = { legacy: [] as string[], typographic: [] as string[], macLegacy: [] as string[], macTypographic: [] as string[] };
    for (let record = 0; record < records; record++) {
      const at = 6 + record * 12;
      if (at + 12 > data.byteLength) break;
      const platform = data.getUint16(at), id = data.getUint16(at + 6);
      // 1: the family as applications with four styles per family list it. 16: the family of every weight.
      if (id !== 1 && id !== 16) continue;
      const start = strings + data.getUint16(at + 10), end = start + data.getUint16(at + 8);
      if (end > bytes.byteLength) continue;
      const family = decodeName(platform, data.getUint16(at + 2), bytes.subarray(start, end));
      if (family) found[platform === 1 ? (id === 1 ? 'macLegacy' : 'macTypographic') : (id === 1 ? 'legacy' : 'typographic')].push(family);
    }
    const own = found.legacy.length || found.typographic.length;
    const legacy = own ? found.legacy : found.macLegacy, typographic = own ? found.typographic : found.macTypographic;
    // A four-style family holds a regular and a bold face whatever weight the design is: "NanumGothic ExtraBold"
    // is its own family with one regular face, and the 800 weight of the family "NanumGothic".
    for (const family of legacy) add(family, bold ? 700 : 400, true);
    for (const family of typographic) if (!legacy.includes(family)) add(family, weight, false);
  }
  return names.length ? { index, variable: tables.has(FVAR), names } : null;
}

/** The faces of a font file or collection. Empty for anything that is not an sfnt font, and for a damaged one. */
export async function readFontFaces(read: FontRangeReader): Promise<FontFileFace[]> {
  try {
    const header = view(await read(0, 12));
    if (header.byteLength < 12) return [];
    let offsets = [0];
    if (header.getUint32(0) === TTCF) {
      const count = header.getUint32(8);
      if (!count || count > MAX_FACES) return [];
      const list = view(await read(12, count * 4));
      if (list.byteLength < count * 4) return [];
      offsets = Array.from({ length: count }, (_, index) => list.getUint32(index * 4));
    }
    const faces: FontFileFace[] = [];
    for (const [index, offset] of offsets.entries()) { const face = await readFace(read, offset, index); if (face) faces.push(face); }
    return faces;
  } catch { return []; }
}
