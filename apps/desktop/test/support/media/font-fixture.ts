/**
 * Font files small enough to write in a test: the table directory with `name`, `OS/2` and, when asked,
 * `fvar`. They carry no glyphs. They state what an installed font states about itself, which is all
 * the font index reads.
 */
export type FixtureFace = {
  /** Windows names (ID 1): the family as four-style applications list it. */
  family: string[];
  /** Windows names (ID 16): the family of every weight, when the design is not one of the four styles. */
  typographic?: string[];
  /** A Macintosh name (ID 1), which groups every weight under one family. */
  mac?: string;
  weight?: number; bold?: boolean; italic?: boolean; variable?: boolean;
};

const utf16be = (text: string) => { const bytes = Buffer.alloc(text.length * 2); for (let at = 0; at < text.length; at++) bytes.writeUInt16BE(text.charCodeAt(at), at * 2); return bytes; };
function nameTable(face: FixtureFace): Buffer {
  const records: { platform: number; encoding: number; language: number; id: number; bytes: Buffer }[] = [];
  for (const family of face.family) records.push({ platform: 3, encoding: 1, language: /[^\x00-\x7f]/.test(family) ? 0x412 : 0x409, id: 1, bytes: utf16be(family) });
  for (const family of face.typographic ?? []) records.push({ platform: 3, encoding: 1, language: /[^\x00-\x7f]/.test(family) ? 0x412 : 0x409, id: 16, bytes: utf16be(family) });
  if (face.mac) records.push({ platform: 1, encoding: 0, language: 0, id: 1, bytes: Buffer.from(face.mac, 'latin1') });
  const header = Buffer.alloc(6 + records.length * 12);
  header.writeUInt16BE(0, 0); header.writeUInt16BE(records.length, 2); header.writeUInt16BE(header.length, 4);
  let offset = 0;
  records.forEach((record, at) => {
    const base = 6 + at * 12;
    header.writeUInt16BE(record.platform, base); header.writeUInt16BE(record.encoding, base + 2); header.writeUInt16BE(record.language, base + 4);
    header.writeUInt16BE(record.id, base + 6); header.writeUInt16BE(record.bytes.length, base + 8); header.writeUInt16BE(offset, base + 10);
    offset += record.bytes.length;
  });
  return Buffer.concat([header, ...records.map(record => record.bytes)]);
}
function os2Table(face: FixtureFace): Buffer {
  const table = Buffer.alloc(96);
  table.writeUInt16BE(4, 0); table.writeUInt16BE(face.weight ?? (face.bold ? 700 : 400), 4);
  table.writeUInt16BE((face.italic ? 1 : 0) | (face.bold ? 0x20 : 0) | (!face.italic && !face.bold ? 0x40 : 0), 62);
  return table;
}
const tables = (face: FixtureFace): [string, Buffer][] =>
  [['OS/2', os2Table(face)], ...(face.variable ? [['fvar', Buffer.alloc(16)] as [string, Buffer]] : []), ['name', nameTable(face)]];

/** One face's directory and tables, with table offsets counted from `origin` (its place in the file). */
function sfnt(face: FixtureFace, origin = 0): Buffer {
  const parts = tables(face), directory = Buffer.alloc(12 + parts.length * 16);
  directory.writeUInt32BE(0x00010000, 0); directory.writeUInt16BE(parts.length, 4);
  let offset = origin + directory.length;
  parts.forEach(([tag, data], at) => {
    const base = 12 + at * 16;
    directory.write(tag, base, 'latin1'); directory.writeUInt32BE(offset, base + 8); directory.writeUInt32BE(data.length, base + 12);
    offset += data.length;
  });
  return Buffer.concat([directory, ...parts.map(([, data]) => data)]);
}

/** A single font file (`.ttf`). */
export const fontFile = (face: FixtureFace): Buffer => sfnt(face);
/** A font collection (`.ttc`) holding the faces in order. */
export function fontCollection(faces: FixtureFace[]): Buffer {
  const header = Buffer.alloc(12 + faces.length * 4);
  header.write('ttcf', 0, 'latin1'); header.writeUInt32BE(0x00010000, 4); header.writeUInt32BE(faces.length, 8);
  const bodies: Buffer[] = [];
  let offset = header.length;
  faces.forEach((face, at) => { const body = sfnt(face, offset); header.writeUInt32BE(offset, 12 + at * 4); bodies.push(body); offset += body.length; });
  return Buffer.concat([header, ...bodies]);
}
