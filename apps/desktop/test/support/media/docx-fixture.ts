import { readFile, writeFile } from 'node:fs/promises';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/** A paragraph of plain text, optionally one external hyperlink, or text set in a named font for every script. */
export type FixtureParagraph = string | { text: string; link: string } | { text: string; font: string; bold?: boolean };
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescape = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships';

function zip(parts: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of parts) {
    const raw = Buffer.from(text, 'utf8'), data = deflateRawSync(raw), file = Buffer.from(name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10); header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(file.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12); entry.writeUInt16LE(0x21, 14); entry.writeUInt32LE(crc32(raw), 16);
    entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(file.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(header, file, data); directory.push(entry, file);
    offset += header.length + file.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

/** A minimal, valid WordprocessingML package: A4 pages of 11 pt paragraphs. */
export function docxBytes(paragraphs: readonly FixtureParagraph[]): Buffer {
  const links: string[] = [];
  const body = paragraphs.map(paragraph => {
    if (typeof paragraph === 'string') return `<w:p><w:r><w:t xml:space="preserve">${escape(paragraph)}</w:t></w:r></w:p>`;
    if ('font' in paragraph) {
      const font = escape(paragraph.font);
      return `<w:p><w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>${paragraph.bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${escape(paragraph.text)}</w:t></w:r></w:p>`;
    }
    links.push(paragraph.link);
    return `<w:p><w:hyperlink r:id="rId${links.length}"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${escape(paragraph.text)}</w:t></w:r></w:hyperlink></w:p>`;
  }).join('');
  return zip([
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/document.xml', `${XML}<w:document xmlns:w="${WORD}" xmlns:r="${RELATIONSHIPS}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`],
    ['word/_rels/document.xml.rels', `${XML}<Relationships xmlns="${PACKAGE}">${links.map((link, index) =>
      `<Relationship Id="rId${index + 1}" Type="${RELATIONSHIPS}/hyperlink" Target="${escape(link)}" TargetMode="External"/>`).join('')}</Relationships>`],
  ]);
}
export const writeDocxFixture = (file: string, paragraphs: readonly FixtureParagraph[]) => writeFile(file, docxBytes(paragraphs));

/** The decoded parts of a package, read from its central directory. Throws on anything that is not a readable archive. */
export function docxParts(bytes: Buffer): Map<string, Buffer> {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw Error('Not a ZIP archive.');
  const parts = new Map<string, Buffer>();
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0, count = bytes.readUInt16LE(end + 10); index < count; index++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw Error('Damaged ZIP directory.');
    const method = bytes.readUInt16LE(offset + 10), size = bytes.readUInt32LE(offset + 20), local = bytes.readUInt32LE(offset + 42);
    const nameLength = bytes.readUInt16LE(offset + 28), name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    const data = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(data, data + size);
    parts.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return parts;
}
/** The main document part as saved, for assertions about markup. */
export async function docxXml(file: string): Promise<string> {
  const part = docxParts(await readFile(file)).get('word/document.xml');
  if (!part) throw Error('The package has no word/document.xml.');
  return part.toString('utf8');
}
/** Every paragraph of the main part with its text and its markup. */
export async function docxParagraphs(file: string): Promise<Array<{ text: string; xml: string }>> {
  return [...(await docxXml(file)).matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(paragraph => ({ xml: paragraph[0],
    text: [...paragraph[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(run => unescape(run[1])).join('') }));
}
/** Body text as a reader sees it: one line per paragraph. */
export async function docxText(file: string): Promise<string> {
  return (await docxParagraphs(file)).map(paragraph => paragraph.text).join('\n');
}
