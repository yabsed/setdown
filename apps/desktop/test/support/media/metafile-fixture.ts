/**
 * An enhanced metafile (EMF) small enough to write in a test, as the GDI calls it records, and a
 * presentation that shows it as a picture. The records are the ones a drawing program writes for an
 * outline: a path bracket of moves, lines and curves that is then filled.
 */
import { docxParts, zip } from './docx-fixture';

export type MetafilePoint = readonly [x: number, y: number];
export type MetafileCall =
  /** Creates a solid brush of the colour (0xRRGGBB) and selects it. */
  | { brush: number }
  | 'beginPath' | 'endPath' | 'closeFigure' | 'fillPath'
  | { moveTo: MetafilePoint } | { lineTo: MetafilePoint }
  /** Continue from the current position and move it. */
  | { polylineTo: readonly MetafilePoint[] } | { polyBezierTo: readonly MetafilePoint[] }
  /** A line to where the ray through `from` leaves the ellipse inside `box`, then along the ellipse to the ray through `to`. */
  | { arcTo: { box: readonly [left: number, top: number, right: number, bottom: number]; from: MetafilePoint; to: MetafilePoint } }
  /** Figures of their own; they neither use nor move the current position. */
  | { polyline: readonly MetafilePoint[] } | { polygon: readonly MetafilePoint[] } | { polyBezier: readonly MetafilePoint[] };

const RECORD = { header: 1, eof: 14, moveTo: 27, selectObject: 37, createBrush: 39, lineTo: 54, arcTo: 55, beginPath: 59, endPath: 60, closeFigure: 61, fillPath: 62,
  polyBezier: 85, polygon: 86, polyline: 87, polyBezierTo: 88, polylineTo: 89 } as const;
function record(type: number, ...values: number[]): Buffer {
  const bytes = Buffer.alloc(8 + values.length * 4);
  bytes.writeUInt32LE(type, 0); bytes.writeUInt32LE(bytes.length, 4);
  values.forEach((value, at) => bytes.writeInt32LE(value | 0, 8 + at * 4));
  return bytes;
}
/** A record of 16-bit points: bounds, count, then the points. */
function points(type: number, list: readonly MetafilePoint[], width: number, height: number): Buffer {
  const bytes = Buffer.alloc(28 + list.length * 4);
  bytes.writeUInt32LE(type, 0); bytes.writeUInt32LE(bytes.length, 4);
  bytes.writeInt32LE(width, 16); bytes.writeInt32LE(height, 20); bytes.writeUInt32LE(list.length, 24);
  list.forEach(([x, y], at) => { bytes.writeInt16LE(x, 28 + at * 4); bytes.writeInt16LE(y, 30 + at * 4); });
  return bytes;
}

/** A metafile `width` by `height` units, one unit a pixel, holding the calls in order. */
export function emfBytes(width: number, height: number, calls: readonly MetafileCall[]): Buffer {
  const records: Buffer[] = [];
  let handles = 1;
  for (const call of calls) {
    if (call === 'beginPath' || call === 'endPath' || call === 'closeFigure') records.push(record(RECORD[call]));
    else if (call === 'fillPath') records.push(record(RECORD.fillPath, 0, 0, width, height));
    else if ('brush' in call) {
      const colour = ((call.brush >> 16) & 0xff) | (call.brush & 0xff00) | ((call.brush & 0xff) << 16);
      records.push(record(RECORD.createBrush, handles, 0, colour, 0), record(RECORD.selectObject, handles));
      handles += 1;
    }
    else if ('moveTo' in call) records.push(record(RECORD.moveTo, ...call.moveTo));
    else if ('lineTo' in call) records.push(record(RECORD.lineTo, ...call.lineTo));
    else if ('arcTo' in call) records.push(record(RECORD.arcTo, ...call.arcTo.box, ...call.arcTo.from, ...call.arcTo.to));
    else for (const [name, list] of Object.entries(call) as ['polylineTo' | 'polyBezierTo' | 'polyline' | 'polygon' | 'polyBezier', readonly MetafilePoint[]][]) records.push(points(RECORD[name], list, width, height));
  }
  records.push(record(RECORD.eof, 0, 16, 20));
  const header = Buffer.alloc(88), size = 88 + records.reduce((sum, bytes) => sum + bytes.length, 0);
  header.writeUInt32LE(RECORD.header, 0); header.writeUInt32LE(88, 4);
  header.writeInt32LE(width, 16); header.writeInt32LE(height, 20);
  // The frame in hundredths of a millimetre, at 96 units to the inch.
  header.writeInt32LE(Math.round(width * 2540 / 96), 32); header.writeInt32LE(Math.round(height * 2540 / 96), 36);
  header.write(' EMF', 40, 'latin1'); header.writeUInt32LE(0x00010000, 44);
  header.writeUInt32LE(size, 48); header.writeUInt32LE(records.length + 1, 52); header.writeUInt16LE(handles, 56);
  header.writeInt32LE(1920, 72); header.writeInt32LE(1080, 76); header.writeInt32LE(508, 80); header.writeInt32LE(286, 84);
  return Buffer.concat([header, ...records]);
}

/**
 * Filled outlines as a drawing program records them, with what GDI makes of them: the figures of the
 * one path, and points of the picture that are painted and that are not.
 */
export const OUTLINE_SAMPLE = {
  size: { width: 300, height: 200 },
  colour: 0xc8102e,
  calls: [
    { brush: 0xc8102e }, 'beginPath',
    // A line, a curve and a line are one figure.
    { moveTo: [20, 20] }, { polylineTo: [[100, 20]] }, { polyBezierTo: [[160, 20], [160, 180], [100, 180]] }, { lineTo: [20, 180] }, 'closeFigure',
    // A figure of LineTo records starts where MoveToEx put the position, not at the figure before.
    { moveTo: [200, 20] }, { lineTo: [280, 20] }, { lineTo: [280, 100] }, 'closeFigure',
    // A polygon is a figure of its own and leaves the position at 280,100; the records after it start there.
    { polygon: [[200, 120], [240, 120], [240, 160], [200, 160]] },
    { lineTo: [290, 150] }, { polyBezierTo: [[290, 170], [270, 190], [250, 190]] }, { polylineTo: [[250, 170]] }, 'closeFigure',
    'endPath', 'fillPath',
  ] as MetafileCall[],
  figures: [
    'M 20,20 L 100,20 C 160,20 160,180 100,180 L 20,180 Z',
    'M 200,20 L 280,20 L 280,100 Z',
    'M 200,120 L 240,120 L 240,160 L 200,160 Z',
    'M 280,100 L 290,150 C 290,170 270,190 250,190 L 250,170 Z',
  ],
  /** Inside the first figure's straight part, its curved part, and the three other figures. The first and the last are left out when a figure is drawn as its pieces. */
  painted: [[40, 40], [130, 100], [270, 40], [220, 140], [270, 150]] as MetafilePoint[],
  /** Outside every figure. The second is painted when the second figure is joined to the first. */
  clear: [[10, 10], [180, 30], [215, 170]] as MetafilePoint[],
};

const IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
/**
 * The presentation with the metafile placed as a picture on its first slide, `widthMm` wide and as
 * tall as the metafile's proportions make it.
 */
export function deckWithMetafile(deck: Buffer, emf: Buffer, size: { width: number; height: number }, widthMm = 150): Buffer {
  const parts = docxParts(deck), text = (name: string) => { const part = parts.get(name); if (!part) throw Error(`The presentation has no ${name}.`); return part.toString('utf8'); };
  const cx = Math.round(widthMm * 36000), cy = Math.round(cx * size.height / size.width);
  const picture = `<p:pic><p:nvPicPr><p:cNvPr id="90" name="Outline"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="rIdOutline"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm><a:off x="720000" y="1980000"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const changed = new Map<string, string | Buffer>([
    ['[Content_Types].xml', text('[Content_Types].xml').replace('<Default Extension="png"', '<Default Extension="emf" ContentType="image/x-emf"/><Default Extension="png"')],
    ['ppt/slides/slide1.xml', text('ppt/slides/slide1.xml').replace('</p:spTree>', `${picture}</p:spTree>`)],
    ['ppt/slides/_rels/slide1.xml.rels', text('ppt/slides/_rels/slide1.xml.rels').replace('</Relationships>', `<Relationship Id="rIdOutline" Type="${IMAGE}" Target="../media/outline.emf"/></Relationships>`)],
  ]);
  for (const [name, content] of changed) if (content === text(name)) throw Error(`The picture could not be added to ${name}.`);
  return zip([...[...parts].map(([name, bytes]) => [name, changed.get(name) ?? bytes] as const), ['ppt/media/outline.emf', emf]]);
}
