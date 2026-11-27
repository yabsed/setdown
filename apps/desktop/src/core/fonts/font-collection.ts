/**
 * One face of a font collection (`.ttc`, `.otc`) as a font file of its own.
 *
 * The presentation engine draws only the first face of a file, so 굴림체 inside gulim.ttc or the Korean
 * face of a pan-CJK collection would be refused. The face's tables are copied unchanged: glyphs, names
 * and metrics are the collection's own. Only the table directory and the file checksum are written anew.
 * Nothing here touches the file system.
 */
const tag = (text: string) => (text.charCodeAt(0) << 24 | text.charCodeAt(1) << 16 | text.charCodeAt(2) << 8 | text.charCodeAt(3)) >>> 0;
const TTCF = tag('ttcf'), HEAD = tag('head'), DSIG = tag('DSIG');
// TrueType outlines, CFF outlines, and Apple's TrueType tag.
const SFNT = new Set([0x00010000, tag('OTTO'), tag('true')]);
const MAX_FACES = 64, MAX_TABLES = 128;
/** The value every font file sums to, as 32-bit words, once `head.checkSumAdjustment` is set. */
const FILE_CHECKSUM = 0xb1b0afba;

/** Whether the bytes are a collection of several faces. */
export const isFontCollection = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) === TTCF;

/**
 * The face at `index` as a single font. A file that is not a collection is its own face 0 and is
 * returned as it is. Null for a face that is not there and for a damaged collection.
 */
export function standaloneFontFace(bytes: Uint8Array, index: number): Uint8Array | null {
  if (!Number.isInteger(index) || index < 0) return null;
  if (!isFontCollection(bytes)) return index === 0 ? bytes : null;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const faces = data.getUint32(8);
  if (index >= faces || faces > MAX_FACES || 12 + faces * 4 > bytes.length) return null;
  const base = data.getUint32(12 + index * 4);
  if (base + 12 > bytes.length) return null;
  const version = data.getUint32(base), count = data.getUint16(base + 4);
  if (!SFNT.has(version) || !count || count > MAX_TABLES || base + 12 + count * 16 > bytes.length) return null;

  const tables: { tag: number; checksum: number; offset: number; length: number }[] = [];
  for (let record = base + 12; record < base + 12 + count * 16; record += 16) {
    const table = { tag: data.getUint32(record), checksum: data.getUint32(record + 4), offset: data.getUint32(record + 8), length: data.getUint32(record + 12) };
    if (table.offset + table.length > bytes.length) return null;
    // A signature covers the file it was made for, which this no longer is.
    if (table.tag !== DSIG) tables.push(table);
  }
  if (!tables.length) return null;
  const directory = 12 + tables.length * 16;
  const font = new Uint8Array(tables.reduce((size, table) => size + ((table.length + 3) & ~3), directory)), view = new DataView(font.buffer);
  const selector = Math.floor(Math.log2(tables.length)), range = 2 ** selector * 16;
  view.setUint32(0, version); view.setUint16(4, tables.length);
  view.setUint16(6, range); view.setUint16(8, selector); view.setUint16(10, tables.length * 16 - range);
  let at = directory, head = -1;
  for (const [position, table] of tables.entries()) {
    font.set(bytes.subarray(table.offset, table.offset + table.length), at);
    const record = 12 + position * 16;
    view.setUint32(record, table.tag); view.setUint32(record + 4, table.checksum); view.setUint32(record + 8, at); view.setUint32(record + 12, table.length);
    if (table.tag === HEAD && table.length >= 12) head = at;
    at += (table.length + 3) & ~3;
  }
  if (head >= 0) {
    // The adjustment is computed over the whole file with the field itself at zero.
    view.setUint32(head + 8, 0);
    let sum = 0;
    for (let offset = 0; offset < font.length; offset += 4) sum = (sum + view.getUint32(offset)) >>> 0;
    view.setUint32(head + 8, (FILE_CHECKSUM - sum) >>> 0);
  }
  return font;
}
