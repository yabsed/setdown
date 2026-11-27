import { describe, expect, test } from 'vitest';
import { isFontCollection, standaloneFontFace } from './font-collection';

const tag = (text: string) => [...text].map(letter => letter.charCodeAt(0));
type Table = { tag: string; bytes: number[] };
const padded = (length: number) => (length + 3) & ~3;
const word = (view: DataView, offset: number) => view.getUint32(offset);
const tableSum = (bytes: Uint8Array) => {
  const copy = new Uint8Array(padded(bytes.length)); copy.set(bytes);
  const view = new DataView(copy.buffer);
  let sum = 0;
  for (let offset = 0; offset < copy.length; offset += 4) sum = (sum + view.getUint32(offset)) >>> 0;
  return sum;
};
/** A collection whose faces share tables the way real ones do: every face's directory points into one pool of tables. */
function collection(faces: Table[][], version = 0x00010000): Uint8Array {
  const header = 12 + faces.length * 4, directories = faces.map(face => 12 + face.length * 16);
  let at = header + directories.reduce((sum, size) => sum + size, 0);
  const placed = new Map<Table, number>();
  for (const table of new Set(faces.flat())) { placed.set(table, at); at += padded(table.bytes.length); }
  const bytes = new Uint8Array(at), view = new DataView(bytes.buffer);
  bytes.set(tag('ttcf')); view.setUint32(4, 0x00010000); view.setUint32(8, faces.length);
  let directory = header;
  faces.forEach((face, index) => {
    view.setUint32(12 + index * 4, directory);
    view.setUint32(directory, version); view.setUint16(directory + 4, face.length);
    face.forEach((table, position) => {
      const record = directory + 12 + position * 16, offset = placed.get(table)!;
      bytes.set(tag(table.tag), record); view.setUint32(record + 4, tableSum(Uint8Array.from(table.bytes)));
      view.setUint32(record + 8, offset); view.setUint32(record + 12, table.bytes.length);
      bytes.set(table.bytes, offset);
    });
    directory += 12 + face.length * 16;
  });
  return bytes;
}
/** The tables of a single font file, by tag. */
function tables(font: Uint8Array) {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength), found = new Map<string, { offset: number; bytes: Uint8Array; checksum: number }>();
  for (let record = 12; record < 12 + view.getUint16(4) * 16; record += 16) {
    const offset = word(view, record + 8), length = word(view, record + 12);
    found.set(String.fromCharCode(...font.subarray(record, record + 4)), { offset, bytes: font.subarray(offset, offset + length), checksum: word(view, record + 4) });
  }
  return found;
}
const head = (mark: number): Table => ({ tag: 'head', bytes: [0, 1, 0, 0, 0, 1, 0, 0, 0xde, 0xad, 0xbe, 0xef, 0x5f, 0x0f, 0x3c, 0xf5, mark, 0, 8, 0] });
const shared: Table = { tag: 'glyf', bytes: [1, 2, 3, 4, 5, 6, 7] };
const first = [head(1), shared, { tag: 'name', bytes: [0x47, 0x75, 0x6c, 0x69, 0x6d] }, { tag: 'DSIG', bytes: [9, 9, 9, 9] }];
const second = [head(2), shared, { tag: 'name', bytes: [0x47, 0x75, 0x6c, 0x69, 0x6d, 0x43, 0x68, 0x65] }, { tag: 'cmap', bytes: [4, 3, 2, 1] }, { tag: 'DSIG', bytes: [9, 9, 9, 9] }];

describe('a face of a font collection as a font of its own', () => {
  test('a single font is its own face 0 and is returned as it is', () => {
    const single = standaloneFontFace(collection([first]), 0)!;
    expect(isFontCollection(single)).toBe(false);
    expect(standaloneFontFace(single, 0)).toBe(single);
    expect(standaloneFontFace(single, 1)).toBeNull();
  });
  test('each face keeps its own tables unchanged, shares none of the other face\'s, and loses the collection\'s signature', () => {
    const file = collection([first, second]);
    expect(isFontCollection(file)).toBe(true);
    for (const [index, face] of [first, second].entries()) {
      const font = standaloneFontFace(file, index)!, found = tables(font), expected = face.filter(table => table.tag !== 'DSIG');
      expect(new DataView(font.buffer).getUint32(0)).toBe(0x00010000);
      expect([...found.keys()]).toEqual(expected.map(table => table.tag));
      for (const table of expected) {
        const copy = found.get(table.tag)!;
        // The adjustment inside `head` is written anew; every other byte is the collection's.
        const bytes = [...copy.bytes]; if (table.tag === 'head') bytes.splice(8, 4, 0xde, 0xad, 0xbe, 0xef);
        expect(bytes).toEqual(table.bytes);
        expect(copy.offset % 4).toBe(0);
        expect(copy.checksum).toBe(tableSum(Uint8Array.from(table.bytes)));
      }
      expect(font.length % 4).toBe(0);
    }
    expect(tables(standaloneFontFace(file, 0)!).get('head')!.bytes[16]).toBe(1);
    expect(tables(standaloneFontFace(file, 1)!).get('head')!.bytes[16]).toBe(2);
  });
  test('the directory header and the file checksum are those of a valid font file', () => {
    const font = standaloneFontFace(collection([first, second]), 1)!, view = new DataView(font.buffer);
    // Four tables: the largest power of two not above the count is 4.
    expect([view.getUint16(4), view.getUint16(6), view.getUint16(8), view.getUint16(10)]).toEqual([4, 64, 2, 0]);
    let sum = 0;
    for (let offset = 0; offset < font.length; offset += 4) sum = (sum + view.getUint32(offset)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
    const three = new DataView(standaloneFontFace(collection([first, second]), 0)!.buffer);
    expect([three.getUint16(4), three.getUint16(6), three.getUint16(8), three.getUint16(10)]).toEqual([3, 32, 1, 16]);
  });
  test('CFF collections keep their outline format', () => {
    const font = standaloneFontFace(collection([first, second], 0x4f54544f), 1)!;
    expect(String.fromCharCode(...font.subarray(0, 4))).toBe('OTTO');
  });
  test('the source may be a view into a larger buffer, and is never changed', () => {
    const file = collection([first, second]), room = new Uint8Array(file.length + 9);
    room.set(file, 5);
    const view = room.subarray(5, 5 + file.length), before = [...room];
    expect([...standaloneFontFace(view, 1)!]).toEqual([...standaloneFontFace(file, 1)!]);
    expect([...room]).toEqual(before);
  });
  test('a face that is not there and a damaged collection give nothing', () => {
    const file = collection([first, second]);
    for (const index of [2, -1, 1.5, Number.NaN]) expect(standaloneFontFace(file, index)).toBeNull();
    expect(standaloneFontFace(file.subarray(0, 40), 0)).toBeNull();
    const cut = file.slice(0, file.length - 8);
    expect(standaloneFontFace(cut, 1)).toBeNull();
    const wrong = file.slice(); new DataView(wrong.buffer).setUint32(new DataView(wrong.buffer).getUint32(12), 0x12345678);
    expect(standaloneFontFace(wrong, 0)).toBeNull();
    const many = file.slice(); new DataView(many.buffer).setUint32(8, 100000);
    expect(standaloneFontFace(many, 0)).toBeNull();
    expect(isFontCollection(new Uint8Array(4))).toBe(false);
  });
});
