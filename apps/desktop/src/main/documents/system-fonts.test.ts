import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fontCollection, fontFile, type FixtureFace } from '../../../test/support/media/font-fixture';
import { fontDirectories, MAX_FONT_FILE_BYTES, SystemFonts } from './system-fonts';
import type { DocxFontRequest } from '../../protocol/docx-edit';

let root: string;
beforeAll(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'setdown-system-fonts-')); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

let made = 0;
/** A machine with exactly these font files installed. Padding makes a file bigger without changing what it says. */
async function machine(files: Record<string, FixtureFace | FixtureFace[] | { face: FixtureFace; pad: number }>) {
  const directory = path.join(root, `machine-${made++}`), paths: string[] = [];
  await mkdir(directory);
  for (const [name, content] of Object.entries(files)) {
    const bytes = Array.isArray(content) ? fontCollection(content) : 'face' in content ? Buffer.concat([fontFile(content.face), Buffer.alloc(content.pad)]) : fontFile(content);
    await writeFile(path.join(directory, name), bytes);
    paths.push(path.join(directory, name));
  }
  return { directory, fonts: new SystemFonts({ files: async () => paths }) };
}
const wish = (family: string, weight = 400, style: 'normal' | 'italic' = 'normal'): DocxFontRequest => ({ family, weight, style });
const NANUM = {
  'NanumGothic.ttf': { family: ['NanumGothic', '나눔고딕'] },
  'NanumGothicBold.ttf': { family: ['NanumGothic', '나눔고딕'], bold: true },
  'NanumMyeongjo.ttf': { family: ['NanumMyeongjo', '나눔명조'] },
} satisfies Record<string, FixtureFace>;

describe('fonts installed on this machine, for the Word editor', () => {
  test('an installed family draws itself, whichever of its names the document wrote', async () => {
    const { fonts } = await machine({ 'malgun.ttf': { family: ['Malgun Gothic', '맑은 고딕'] }, 'malgunbd.ttf': { family: ['Malgun Gothic', '맑은 고딕'], bold: true } });
    const answer = await fonts.resolve([wish('맑은 고딕'), wish('맑은 고딕', 700), wish('MALGUN  gothic')], []);
    expect(answer.faces.map(face => [face.family, face.weight, face.style, face.standIn])).toEqual([
      ['맑은 고딕', 400, 'normal', undefined], ['맑은 고딕', 700, 'normal', undefined], ['MALGUN  gothic', 400, 'normal', undefined]]);
    expect(answer.faces.every(face => face.lineBox === undefined)).toBe(true);
    // Two files, sent once each; the regular face serves both spellings.
    expect(answer.files).toHaveLength(2);
    expect(answer.faces[0].file).toBe(answer.faces[2].file);
    expect(Buffer.from(answer.files.find(file => file.id === answer.faces[1].file)!.bytes)).toEqual(fontFile({ family: ['Malgun Gothic', '맑은 고딕'], bold: true }));
  });

  test('a missing Korean family is drawn by an installed one of its class and keeps its own line', async () => {
    const { fonts } = await machine(NANUM);
    const answer = await fonts.resolve([wish('맑은 고딕'), wish('바탕'), wish('HY신명조'), wish('굴림', 700)], []);
    expect(answer.faces.map(face => [face.family, face.weight, face.standIn])).toEqual([
      ['맑은 고딕', 400, 'NanumGothic'], ['바탕', 400, 'NanumMyeongjo'], ['HY신명조', 400, 'NanumMyeongjo'], ['굴림', 700, 'NanumGothic']]);
    expect(answer.faces[0].lineBox!.heightEm).toBeCloseTo(1.7291, 4);
    expect(answer.faces[1].lineBox!.heightEm).toBeCloseTo(1.3, 6);
    expect(answer.files).toHaveLength(3);
  });

  test('with no face of its class installed, a Korean family takes the other class before nothing', async () => {
    const { fonts } = await machine({ 'NanumGothic.ttf': NANUM['NanumGothic.ttf'] });
    expect((await fonts.resolve([wish('바탕')], [])).faces.map(face => face.standIn)).toEqual(['NanumGothic']);
  });

  test('a family that is neither installed nor Korean is left to the packaged fonts', async () => {
    const { fonts } = await machine(NANUM);
    expect(await fonts.resolve([wish('Calibri'), wish('Times New Roman', 700), wish('SimSun'), wish('Wingdings')], [])).toEqual({ faces: [], files: [] });
  });

  test('a face is stated as what it is, so a missing bold or italic is drawn from the regular one', async () => {
    const { fonts } = await machine({ 'NanumMyeongjo.ttf': NANUM['NanumMyeongjo.ttf'], 'only-bold.ttf': { family: ['Heavy Only'], bold: true } });
    const answer = await fonts.resolve([wish('나눔명조', 700), wish('나눔명조', 400, 'italic'), wish('나눔명조', 700, 'italic'), wish('Heavy Only')], []);
    // Three wishes, one regular face; the bold-only family answers a regular wish as bold.
    expect(answer.faces.map(face => [face.family, face.weight, face.style])).toEqual([['나눔명조', 400, 'normal'], ['Heavy Only', 700, 'normal']]);
  });

  test('a light or extra-bold face does not take the regular or bold place of its family', async () => {
    const light = { family: ['NanumGothic Light'], typographic: ['NanumGothic'], mac: 'NanumGothic', weight: 300 };
    // As the real files state themselves: the bold says 600 and the extra-bold says 700, the number a bold wish asks for.
    const extra = { family: ['NanumGothicExtraBold'], typographic: ['NanumGothic'], mac: 'NanumGothic', weight: 700 };
    const bold = { ...NANUM['NanumGothicBold.ttf'], weight: 600 };
    // The other weights are also the smaller files, and are read first.
    const { fonts } = await machine({ 'A-Light.ttf': light, 'B-ExtraBold.ttf': extra,
      'C-Regular.ttf': { face: NANUM['NanumGothic.ttf'], pad: 4000 }, 'D-Bold.ttf': { face: bold, pad: 4000 } });
    const answer = await fonts.resolve([wish('NanumGothic'), wish('NanumGothic', 700), wish('NanumGothic Light'), wish('맑은 고딕', 700)], []);
    const size = (at: number) => answer.files.find(file => file.id === answer.faces[at].file)!.bytes.length;
    expect(size(0)).toBe(fontFile(NANUM['NanumGothic.ttf']).length + 4000);
    expect(size(1)).toBe(fontFile(bold).length + 4000);
    expect(size(2)).toBe(fontFile(light).length);
    // The stand-in's bold is that same linked bold.
    expect(answer.faces[3]).toMatchObject({ standIn: 'NanumGothic', weight: 700, file: answer.faces[1].file });
  });

  test('the same font installed twice is read from the smaller file', async () => {
    const { fonts } = await machine({ 'a-big.ttf': { face: NANUM['NanumGothic.ttf'], pad: 9000 }, 'b-small.ttf': NANUM['NanumGothic.ttf'] });
    const answer = await fonts.resolve([wish('나눔고딕')], []);
    expect(answer.files[0].bytes.length).toBe(fontFile(NANUM['NanumGothic.ttf']).length);
  });

  test('a face inside a collection is answered with its position', async () => {
    const { fonts } = await machine({ 'batang.ttc': [{ family: ['Batang', '바탕'] }, { family: ['BatangChe', '바탕체'] }, { family: ['Gungsuh', '궁서'] }] });
    const answer = await fonts.resolve([wish('궁서'), wish('바탕'), wish('HY견명조')], []);
    expect(answer.faces.map(face => [face.family, face.index, face.standIn])).toEqual([['궁서', 2, undefined], ['바탕', 0, undefined], ['HY견명조', 0, 'Batang']]);
    expect(answer.files).toHaveLength(1);
  });

  test('a variable font and a file above the engine limit are not offered', async () => {
    const { directory, fonts } = await machine({ 'NotoSansCJK-VF.ttc': [{ family: ['Noto Sans CJK KR'], variable: true }, { family: ['Noto Sans CJK JP'], variable: true }],
      'huge.ttf': { family: ['Huge Gothic', '나눔고딕'] }, 'NanumMyeongjo.ttf': NANUM['NanumMyeongjo.ttf'] });
    await truncate(path.join(directory, 'huge.ttf'), MAX_FONT_FILE_BYTES + 1);
    const answer = await fonts.resolve([wish('Noto Sans CJK KR'), wish('Huge Gothic'), wish('맑은 고딕')], []);
    // Noto Sans CJK KR is itself a Korean family, so it and 맑은 고딕 both fall to the only usable Korean face.
    expect(answer.faces.map(face => [face.family, face.standIn])).toEqual([['Noto Sans CJK KR', 'NanumMyeongjo'], ['맑은 고딕', 'NanumMyeongjo']]);
  });

  test('font files the caller already holds are not sent again', async () => {
    const { fonts } = await machine(NANUM);
    const first = await fonts.resolve([wish('맑은 고딕'), wish('바탕')], []);
    expect(first.files).toHaveLength(2);
    const gothic = first.faces[0].file;
    const second = await fonts.resolve([wish('굴림'), wish('궁서')], [gothic]);
    expect(second.faces.map(face => face.file)).toEqual([gothic, first.faces[1].file]);
    expect(second.files.map(file => file.id)).toEqual([first.faces[1].file]);
  });

  test('a font file that disappeared leaves its faces unanswered', async () => {
    const { directory, fonts } = await machine(NANUM);
    await fonts.resolve([wish('나눔고딕')], []);
    await rm(path.join(directory, 'NanumMyeongjo.ttf'));
    const answer = await fonts.resolve([wish('바탕'), wish('맑은 고딕')], []);
    expect(answer.faces.map(face => face.family)).toEqual(['맑은 고딕']);
    expect(answer.files).toHaveLength(1);
  });

  test('a font name is only a key: it cannot name a file, and files that are not fonts are ignored', async () => {
    const { directory, fonts } = await machine(NANUM);
    await writeFile(path.join(directory, 'secret.ttf'), 'not a font');
    const other = new SystemFonts({ files: async () => [path.join(directory, 'secret.ttf'), path.join(directory, 'missing.ttf'), directory] });
    for (const family of [path.join(directory, 'secret.ttf'), '../secret.ttf', 'secret', 'secret.ttf', '/etc/passwd', '__proto__', 'constructor']) {
      expect(await fonts.resolve([wish(family)], [])).toEqual({ faces: [], files: [] });
      expect(await other.resolve([wish(family)], [])).toEqual({ faces: [], files: [] });
    }
  });

  test('a request that is not a list of faces is refused', async () => {
    const { fonts } = await machine(NANUM);
    const bad: unknown[] = [null, 'Malgun Gothic', [null], [{ family: 7, weight: 400, style: 'normal' }], [{ family: '', weight: 400, style: 'normal' }],
      [{ family: 'x'.repeat(129), weight: 400, style: 'normal' }], [wish('바탕', 0)], [wish('바탕', Number.NaN)], [{ family: '바탕', weight: 400, style: 'oblique' }],
      Array.from({ length: 257 }, () => wish('바탕'))];
    for (const requests of bad) await expect(fonts.resolve(requests as DocxFontRequest[], [])).rejects.toThrow('Invalid font request.');
    await expect(fonts.resolve([wish('바탕')], 'held' as unknown as string[])).rejects.toThrow('Invalid font request.');
  });

  test('each platform is searched where it keeps fonts', () => {
    expect(fontDirectories('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', WINDIR: 'D:\\Windows' }, 'C:\\Users\\me'))
      .toEqual(['C:\\Users\\me\\AppData\\Local\\Microsoft\\Windows\\Fonts', 'D:\\Windows\\Fonts']);
    expect(fontDirectories('win32', {}, 'C:\\Users\\me')).toEqual(['C:\\Windows\\Fonts']);
    expect(fontDirectories('darwin', {}, '/Users/me')).toEqual(['/Users/me/Library/Fonts', '/Library/Fonts', '/System/Library/Fonts']);
    expect(fontDirectories('linux', {}, '/home/me')).toEqual(['/home/me/.local/share/fonts', '/home/me/.fonts', '/usr/local/share/fonts', '/usr/share/fonts']);
    expect(fontDirectories('linux', { XDG_DATA_HOME: '/data', XDG_DATA_DIRS: '/a:/b:/a' }, '/home/me')).toEqual(['/data/fonts', '/home/me/.fonts', '/a/fonts', '/b/fonts']);
  });

  test('fonts are found by scanning the platform directories when nothing lists them', async () => {
    const home = path.join(root, 'scan-home'), fontsDirectory = path.join(home, 'Library', 'Fonts', 'Korean');
    await mkdir(fontsDirectory, { recursive: true });
    await writeFile(path.join(fontsDirectory, 'AppleMyungjo.ttf'), fontFile({ family: ['AppleMyungjo'] }));
    await writeFile(path.join(fontsDirectory, 'readme.txt'), 'not a font');
    const fonts = new SystemFonts({ platform: 'darwin', env: {}, home });
    expect((await fonts.resolve([wish('바탕')], [])).faces.map(face => face.standIn)).toEqual(['AppleMyungjo']);
  });
});
