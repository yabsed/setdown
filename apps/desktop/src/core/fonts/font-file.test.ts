import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fontCollection, fontFile, type FixtureFace } from '../../../test/support/media/font-fixture';
import { readFontFaces, type FontRangeReader } from './font-file';
import { fontFamilyKey, nearestFace } from './font-match';
import { koreanFontClass, koreanLineBox, koreanStandIns } from './korean-fonts';

const reader = (bytes: Uint8Array): FontRangeReader => async (offset, length) => bytes.subarray(offset, offset + length);
const faces = (bytes: Uint8Array) => readFontFaces(reader(bytes));
const names = async (face: FixtureFace) => (await faces(fontFile(face)))[0]?.names.map(name => `${name.family}@${name.weight}${name.italic ? 'i' : ''}`);

describe('what a font file says about itself', () => {
  test('a face is listed under each of its family names, in every language', async () => {
    expect(await names({ family: ['Malgun Gothic', '맑은 고딕'] })).toEqual(['Malgun Gothic@400', '맑은 고딕@400']);
    expect(await names({ family: ['Batang', '바탕'], bold: true })).toEqual(['Batang@700', '바탕@700']);
    expect(await names({ family: ['Carlito'], italic: true, bold: true })).toEqual(['Carlito@700i']);
  });

  test('a weight outside the four styles is its own family and a weight of the whole family', async () => {
    // "NanumGothic ExtraBold" is listed by Word as a family with one regular face; fontconfig and browsers
    // know it as weight 800 of "NanumGothic".
    expect(await names({ family: ['NanumGothic ExtraBold', '나눔고딕 ExtraBold'], typographic: ['NanumGothic', '나눔고딕'], weight: 800 }))
      .toEqual(['NanumGothic ExtraBold@400', '나눔고딕 ExtraBold@400', 'NanumGothic@800', '나눔고딕@800']);
    const [light] = await faces(fontFile({ family: ['NanumGothic Light'], typographic: ['NanumGothic'], weight: 300 }));
    expect(light.names).toEqual([{ family: 'NanumGothic Light', weight: 400, design: 300, linked: true, italic: false },
      { family: 'NanumGothic', weight: 300, design: 300, linked: false, italic: false }]);
    // NanumGothicBold.ttf states 600 and is still the bold that the family's regular face is linked to.
    const [boldFace] = await faces(fontFile({ family: ['NanumGothic'], bold: true, weight: 600 }));
    expect(boldFace.names).toEqual([{ family: 'NanumGothic', weight: 700, design: 600, linked: true, italic: false }]);
  });

  test('a Macintosh family name does not put a light face in the regular place of its family', async () => {
    // The Macintosh record of NanumGothicLight.ttf says "NanumGothic"; read as a four-style family it would
    // claim to be that family's regular face.
    expect(await names({ family: ['NanumGothic Light'], typographic: ['NanumGothic'], mac: 'NanumGothic', weight: 300 }))
      .toEqual(['NanumGothic Light@400', 'NanumGothic@300']);
    // A font with nothing but Macintosh names is still found.
    expect(await names({ family: [], mac: 'Old Mac Font' })).toEqual(['Old Mac Font@400']);
  });

  test('a collection lists every face with its position, and a variable face says so', async () => {
    const found = await faces(fontCollection([{ family: ['Batang', '바탕'] }, { family: ['Gungsuh', '궁서'] }, { family: ['Noto Sans CJK KR'], variable: true }]));
    expect(found.map(face => [face.index, face.variable, face.names[0].family])).toEqual([[0, false, 'Batang'], [1, false, 'Gungsuh'], [2, true, 'Noto Sans CJK KR']]);
  });

  test('anything that is not a font, or is cut short, has no faces', async () => {
    expect(await faces(new Uint8Array(0))).toEqual([]);
    expect(await faces(Buffer.from('PK\x03\x04 not a font at all'))).toEqual([]);
    expect(await faces(Buffer.from('wOFF' + '\0'.repeat(40), 'latin1'))).toEqual([]);
    const whole = fontFile({ family: ['Malgun Gothic'] });
    for (const length of [4, 12, 20, 60, whole.length - 5]) expect(await faces(whole.subarray(0, length))).toEqual([]);
    // A collection that claims more faces than any real one, and a reader that fails.
    const huge = Buffer.alloc(16); huge.write('ttcf', 0, 'latin1'); huge.writeUInt32BE(100_000, 8);
    expect(await faces(huge)).toEqual([]);
    expect(await readFontFaces(async () => { throw Error('read failed'); })).toEqual([]);
  });

  test('the fonts shipped with the Word engine are read as their real families', async () => {
    const assets = (name: string) => path.join(path.dirname(createRequire(import.meta.url).resolve(`${name}/package.json`)), 'assets');
    const carlito = await faces(await readFile(path.join(assets('@docx-editor.dev/fonts'), 'Carlito-BoldItalic.ttf')));
    expect(carlito).toHaveLength(1);
    expect(carlito[0]).toMatchObject({ index: 0, variable: false });
    expect(carlito[0].names).toContainEqual({ family: 'Carlito', weight: 700, design: 700, linked: true, italic: true });
    // CFF outlines ("OTTO") with Japanese and English names.
    const cjk = await faces(await readFile(path.join(assets('@docx-editor.dev/fonts-cjk'), 'NotoSansCJKjp-Regular.otf')));
    expect(cjk[0].names.map(name => name.family)).toContain('Noto Sans CJK JP');
    expect(cjk[0].names.every(name => name.weight === 400 && !name.italic)).toBe(true);
  });
});

describe('matching a document font name to a face', () => {
  test('names match without regard to case, spacing or character width', () => {
    expect(fontFamilyKey('  Malgun   GOTHIC ')).toBe('malgun gothic');
    expect(fontFamilyKey('ＭＳ 明朝')).toBe(fontFamilyKey('MS 明朝'));
    expect(fontFamilyKey('맑은 고딕')).toBe('맑은 고딕');
  });

  test('a face answers only for its own slant and its own half of the weights', () => {
    const family = [{ weight: 300, italic: false }, { weight: 400, italic: false }, { weight: 700, italic: false }, { weight: 800, italic: false }];
    expect(nearestFace(family, 400, false)?.weight).toBe(400);
    expect(nearestFace(family, 700, false)?.weight).toBe(700);
    expect(nearestFace(family, 500, false)?.weight).toBe(400);
    expect(nearestFace(family, 900, false)?.weight).toBe(800);
    expect(nearestFace(family, 400, true)).toBeUndefined();
    expect(nearestFace([{ weight: 400, italic: false }], 700, false)).toBeUndefined();
    expect(nearestFace([{ weight: 800, italic: false }], 400, false)).toBeUndefined();
  });
});

describe('Korean font families', () => {
  test('the families of Windows, Microsoft Office and Hancom Office keep their class', () => {
    for (const gothic of ['맑은 고딕', 'Malgun Gothic', '굴림', '굴림체', '돋움', 'Dotum', 'HY견고딕', 'HY헤드라인M', 'HYGothic-Extra', '휴먼고딕', '함초롬돋움', 'HCR Dotum',
      '한컴 고딕', '나눔고딕', 'NanumGothic', 'Noto Sans CJK KR', 'Apple SD Gothic Neo', '휴먼엑스포'])
      expect([gothic, koreanFontClass(gothic)]).toEqual([gothic, 'sans']);
    for (const myeongjo of ['바탕', 'Batang', 'BatangChe', '궁서', 'Gungsuh', 'HY신명조', 'HY견명조', 'HYSinMyeongJo-Medium', 'HYGungSo-Bold', '휴먼명조', '한양신명조',
      '함초롬바탕', 'HCR Batang', '한컴바탕', '나눔명조', 'NanumMyeongjo', 'Noto Serif CJK KR', 'AppleMyungjo'])
      expect([myeongjo, koreanFontClass(myeongjo)]).toEqual([myeongjo, 'serif']);
  });

  test('other families get no Korean stand-in', () => {
    for (const other of ['Calibri', 'Times New Roman', 'Arial', 'Microsoft Sans Serif', 'Wingdings', 'SimSun', 'MS Mincho', 'ＭＳ 明朝', '宋体', 'Noto Sans CJK JP', 'constructor', ''])
      expect([other, koreanFontClass(other)]).toEqual([other, null]);
  });

  test('a stand-in comes from the same class first, then from the other', () => {
    expect(koreanStandIns('serif').slice(0, 3)).toEqual(['Batang', 'AppleMyungjo', 'NanumMyeongjo']);
    expect(koreanStandIns('serif')).toContain('NanumGothic');
    expect(koreanStandIns('sans')[0]).toBe('Malgun Gothic');
    expect(koreanStandIns('sans').indexOf('NanumGothic')).toBeLessThan(koreanStandIns('sans').indexOf('NanumMyeongjo'));
    // A pan-CJK family of another region draws the same Hangul: after every Korean family of the class, before the other class.
    const sans = koreanStandIns('sans');
    expect(sans.indexOf('Noto Sans CJK JP')).toBeGreaterThan(sans.indexOf('Noto Sans CJK KR'));
    expect(sans.indexOf('Noto Sans CJK JP')).toBeLessThan(sans.indexOf('Batang'));
    expect(koreanStandIns('serif').indexOf('Noto Serif CJK JP')).toBeLessThan(koreanStandIns('serif').indexOf('Malgun Gothic'));
  });

  test('a missing family keeps the line Word gives it', () => {
    // 맑은 고딕: a 1.33 em box, single-spaced at 1.3 times that.
    expect(koreanLineBox('맑은 고딕').heightEm).toBeCloseTo(1.7291, 4);
    expect(koreanLineBox('Malgun Gothic')).toEqual(koreanLineBox('맑은 고딕'));
    expect(koreanLineBox('바탕').heightEm).toBeCloseTo(1.3, 6);
    expect(koreanLineBox('HY신명조')).toEqual(koreanLineBox('바탕'));
    // The glyphs sit in the middle of the extra space.
    for (const family of ['맑은 고딕', '바탕']) { const box = koreanLineBox(family); expect(box.baselineEm).toBeGreaterThan(box.heightEm / 2); expect(box.baselineEm).toBeLessThan(box.heightEm); }
  });
});
