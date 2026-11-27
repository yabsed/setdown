import { describe, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { METAFILE_MODULES, METAFILE_WORKERS, isMetafileModule, patchMetafileOutlines } from '../../../scripts/office-metafile-patch.mjs';
import { OUTLINE_SAMPLE, deckWithMetafile, emfBytes, type MetafileCall } from '../../../test/support/media/metafile-fixture';

// File Viewer's EMF converter is corrected when the application is built. These tests run the corrected
// converters themselves, as published in the installed packages, on a metafile written for the purpose.

const require = createRequire(import.meta.url);
const { size: SIZE, calls: OUTLINES, figures: FIGURES } = OUTLINE_SAMPLE;
/** Outside a path: a polyline and a curve of their own do not move the position the next line starts from. */
const STROKES: MetafileCall[] = [{ moveTo: [10, 10] }, { polyline: [[50, 50], [60, 60]] }, { polyBezier: [[70, 70], [80, 70], [80, 80], [90, 90]] }, { lineTo: [10, 90] },
  { polylineTo: [[40, 90]] }, { lineTo: [40, 60] }];

const outline = (svg: string) => [...svg.matchAll(/<path d="([^"]*)"/g)].map(match => match[1].replace(/\s+/g, ' ').trim());
const lines = (svg: string) => [...svg.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g)].map(match => match.slice(1).map(Number));

type Converter = (mime: string, bytes: Uint8Array) => { bytes: Uint8Array } | null;
/** One of the converter modules, as published or corrected, loaded from a copy that names its neighbours by address. */
async function converterModule([name, file]: readonly [string, string], corrected: boolean): Promise<Converter> {
  const source = path.join(path.dirname(require.resolve(`${name}/package.json`)), file);
  expect(isMetafileModule(source)).toBe(true);
  const published = await readFile(source, 'utf8');
  const text = (corrected ? patchMetafileOutlines(published) : published)
    .replace(/from '(\.\.?\/[^']+)'/g, (_all: string, relative: string) => `from '${pathToFileURL(path.resolve(path.dirname(source), relative)).href}'`);
  const folder = await mkdtemp(path.join(os.tmpdir(), 'setdown-metafile-'));
  try {
    const copy = path.join(folder, 'vector.mjs');
    await writeFile(copy, text);
    return (await import(/* @vite-ignore */ pathToFileURL(copy).href) as { convertMetafileToSvg: Converter }).convertMetafileToSvg;
  } finally { await rm(folder, { recursive: true, force: true }); }
}
const drawn = (convert: Converter, calls: readonly MetafileCall[]) => {
  const result = convert('image/emf', emfBytes(SIZE.width, SIZE.height, calls));
  if (!result) throw Error('The converter drew nothing.');
  return new TextDecoder().decode(result.bytes);
};

/** The PPTX worker script run as a worker runs it; answers the SVG of every metafile picture, slide by slide. */
async function slidePictures(script: string, deck: Buffer): Promise<string[][]> {
  const { resolvePptxEngineOptions } = await import(/* @vite-ignore */ pathToFileURL(path.join(path.dirname(require.resolve('@file-viewer/pptx/package.json')), 'dist/options.js')).href) as
    { resolvePptxEngineOptions(options: undefined): unknown };
  const messages: Array<{ type: string; data: unknown }> = [];
  let finish = () => {};
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const self = Object.assign(Object.create(globalThis) as Record<string, unknown>, {
    postMessage(message: { type: string; data: unknown }) { messages.push(message); if (message.type === 'ExecutionTime' || message.type === 'ERROR') finish(); },
    importScripts() {}, addEventListener() {}, onmessage: null as null | ((event: { data: unknown }) => void), onerror: null });
  const log = console.log;
  console.log = () => {};
  try {
    new Function('self', script)(self);
    self.onmessage?.({ data: { type: 'processPPTX', data: deck.buffer.slice(deck.byteOffset, deck.byteOffset + deck.byteLength), IE11: false, options: resolvePptxEngineOptions(undefined) } });
    await finished;
  } finally { console.log = log; }
  const failure = messages.find(message => message.type === 'ERROR');
  if (failure) throw Error(`The PPTX worker failed: ${JSON.stringify(failure.data)}`);
  return messages.filter(message => message.type === 'slide').map(message =>
    [...(typeof message.data === 'string' ? message.data : JSON.stringify(message.data)).matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)].map(match => Buffer.from(match[1], 'base64').toString('utf8')));
}

describe('EMF outlines in the Office viewers', () => {
  test.each(METAFILE_MODULES.map(module => [module.join('/'), module] as const))('%s builds each figure as GDI does', async (_name, module) => {
    const convert = await converterModule(module, true);
    const [d, ...more] = outline(drawn(convert, OUTLINES));
    expect(more).toEqual([]);
    expect(d).toBe(FIGURES.join(' '));
    // The first line starts where MoveToEx left the position; the later ones where the lines before them ended.
    expect(lines(drawn(convert, STROKES))).toEqual([[10, 10, 10, 90], [40, 90, 40, 60]]);
  });

  test.each(METAFILE_MODULES.map(module => [module.join('/'), module] as const))('%s as published splits a figure at every curve and joins others, which is what the correction is for', async (_name, module) => {
    const convert = await converterModule(module, false);
    const [d] = outline(drawn(convert, OUTLINES));
    expect(d).not.toBe(FIGURES.join(' '));
    // Four figures drawn as five pieces, two of them joined to the figure before.
    expect(d.match(/M /g)).toHaveLength(5);
    expect(d).toContain('L 100,20 M 100,20 C');
    expect(d).toContain('Z L 280,20');
    expect(lines(drawn(convert, STROKES))[0]).toEqual([90, 90, 10, 90]);
  });

  test('the legacy PowerPoint converter keeps an arc that continues a figure inside it', async () => {
    // Only this copy reads the arc records. A quarter of the circle around 100,100, from 150,100 down to 100,150.
    const calls: MetafileCall[] = [{ brush: 0xc8102e }, 'beginPath', { moveTo: [100, 20] }, { lineTo: [150, 20] },
      { arcTo: { box: [50, 50, 150, 150], from: [150, 100], to: [100, 150] } }, { lineTo: [20, 150] }, 'closeFigure', 'endPath', 'fillPath'];
    const ppt = METAFILE_MODULES.find(([name]) => name === '@file-viewer/ppt')!;
    const [d, ...more] = outline(drawn(await converterModule(ppt, true), calls));
    expect(more).toEqual([]);
    expect(d).toMatch(/^M 100,20 L 150,20 L ?150,100 C[^MZ]+ L 20,150 Z$/);
    // As published, the arc is a piece of its own.
    expect(outline(drawn(await converterModule(ppt, false), calls))[0].match(/M/g)).toHaveLength(2);
  });

  test('the PPTX worker draws an EMF picture of a slide with each figure whole', async () => {
    const deck = deckWithMetafile(await readFile(new URL('../../../test/fixtures/office/deck.pptx', import.meta.url)), emfBytes(SIZE.width, SIZE.height, OUTLINES), SIZE);
    const script = await readFile(require.resolve(METAFILE_WORKERS.pptx), 'utf8');
    const [first, ...rest] = await slidePictures(patchMetafileOutlines(script), deck);
    expect(first).toHaveLength(1);
    expect(rest.flat()).toEqual([]);
    expect(outline(first[0])).toEqual([FIGURES.join(' ')]);
    expect(first[0]).toContain('fill="#c8102e"');
    const [published] = await slidePictures(script, deck);
    expect(outline(published[0])[0].match(/M /g)).toHaveLength(5);
  });

  test('the legacy PowerPoint worker carries the corrected converter and is still a script', async () => {
    const script = await readFile(require.resolve(METAFILE_WORKERS.ppt), 'utf8'), corrected = patchMetafileOutlines(script);
    // The worker bundles the module tested above: the same places are found in it, once each, and corrected alike.
    const [name, file] = METAFILE_MODULES.find(([module]) => module === '@file-viewer/ppt')!;
    const twin = patchMetafileOutlines(await readFile(path.join(path.dirname(require.resolve(`${name}/package.json`)), file), 'utf8'));
    const marks = (text: string) => [...text.matchAll(/[^\n]*setdownFigure[^\n]*/g)].map(match => match[0].trim());
    expect(marks(corrected)).toEqual(marks(twin));
    expect(marks(corrected).length).toBeGreaterThan(6);
    expect(corrected.split('\n')).toHaveLength(script.split('\n').length);
    expect(() => new vm.Script(corrected)).not.toThrow();
  });

  test('a converter that is not the one the correction was written for is refused, and so is a corrected one', async () => {
    const script = await readFile(require.resolve(METAFILE_WORKERS.pptx), 'utf8');
    expect(() => patchMetafileOutlines(script.replace(/case \w+\.EMR_MOVETOEX:/, 'case 27:')))
      .toThrow('"MoveToEx starts a new figure" was found 0 times');
    expect(() => patchMetafileOutlines(patchMetafileOutlines(script))).toThrow('found 0 times');
    expect(() => patchMetafileOutlines('self.onmessage = () => {};')).toThrow('The EMF converter cannot be patched');
  });

  test('only the two converter modules are corrected while the application is bundled', () => {
    for (const file of ['/app/node_modules/@file-viewer/doc/dist/msdoc/vector.js', 'C:\\app\\node_modules\\@file-viewer\\ppt\\dist\\core\\vector.js', '/app/node_modules/@file-viewer/ppt/dist/core/vector.js?v=1'])
      expect([file, isMetafileModule(file)]).toEqual([file, true]);
    for (const file of ['/app/node_modules/@file-viewer/ppt/dist/core/vector-font.js', '/app/node_modules/@file-viewer/pptx/dist/vector.js', '/app/src/renderer/vector.js', '/app/node_modules/@file-viewer/doc/dist/msdoc/vector.json'])
      expect([file, isMetafileModule(file)]).toEqual([file, false]);
  });
});
