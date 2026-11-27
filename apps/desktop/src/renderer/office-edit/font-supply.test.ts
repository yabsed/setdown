import { describe, expect, test, vi } from 'vitest';
import { installedFontSupply, koreanLastResort, type FontAnswer, type FontSourceMaker, type FontWish } from './font-supply';
import type { DocxFontAnswer, DocxFontFace, DocxFontRequest } from '../../protocol/docx-edit';

type Source = { family: string; weight: number; style: string; faceIndex: number; size: number };
const make: FontSourceMaker<Source> = (bytes, face) => ({ source: { family: face.family, weight: face.weight, style: face.style, faceIndex: face.faceIndex, size: bytes.length } });
const face = (family: string, weight: number, file: string, extra: Partial<DocxFontFace> = {}): DocxFontFace =>
  ({ family, weight, style: 'normal', file, index: 0, bytes: 0, ...extra });
const MALGUN_LINE = { heightEm: 1.7291, baselineEm: 1.2786 };

/** Main, with these font files installed and this answer for every family asked. */
function main(installed: Record<string, number>, faces: (requests: DocxFontRequest[]) => DocxFontFace[]) {
  const calls: { requests: DocxFontRequest[]; held: string[] }[] = [];
  const supply = vi.fn(async (requests: DocxFontRequest[], held: string[]): Promise<DocxFontAnswer> => {
    calls.push({ requests, held });
    const answered = faces(requests), wanted = [...new Set(answered.map(one => one.file))].filter(id => !held.includes(id));
    return { faces: answered, files: wanted.map(id => ({ id, bytes: new Uint8Array(installed[id]) })) };
  });
  return { supply, calls };
}
const fresh = () => ({ files: new Map<string, WeakRef<Uint8Array>>(), warn: vi.fn() });

describe('installed fonts for the Word engine', () => {
  test('before the text is read, each family is asked for with its four styles', async () => {
    const { supply, calls } = main({}, () => []);
    const answer = await installedFontSupply(supply, make, fresh())({ families: ['맑은 고딕', 'Wingdings', 'Calibri'], defaultFamily: 'Calibri' });
    expect(answer).toBeUndefined();
    expect(calls[0].requests.map(request => `${request.family} ${request.weight} ${request.style}`)).toEqual([
      'Calibri 400 normal', 'Calibri 700 normal', 'Calibri 400 italic', 'Calibri 700 italic',
      '맑은 고딕 400 normal', '맑은 고딕 700 normal', '맑은 고딕 400 italic', '맑은 고딕 700 italic',
      'Wingdings 400 normal', 'Wingdings 700 normal', 'Wingdings 400 italic', 'Wingdings 700 italic']);
  });

  test('once the engine names the faces the text uses, only those are asked for, minus what it can already draw', async () => {
    const { supply, calls } = main({}, () => []);
    await installedFontSupply(supply, make, fresh())({ families: ['바탕', 'Arial'], defaultFamily: 'Calibri',
      faces: [{ family: '바탕', weight: 400, style: 'normal' }, { family: 'Arial', weight: 700, style: 'italic' }, { family: '맑은 고딕', weight: 400, style: 'normal' }],
      resolvedFaces: [{ family: '맑은 고딕', weight: 400, style: 'normal' }, { family: 'NanumGothic', weight: 400, style: 'normal' }] });
    expect(calls[0].requests).toEqual([{ family: '바탕', weight: 400, style: 'normal' }, { family: 'Arial', weight: 700, style: 'italic' }]);
    // Nothing left to ask: main is not called at all.
    const quiet = main({}, () => []);
    expect(await installedFontSupply(quiet.supply, make, fresh())({ families: ['맑은 고딕'], defaultFamily: 'Calibri',
      faces: [{ family: '맑은 고딕', weight: 400, style: 'normal' }], resolvedFaces: [{ family: '맑은 고딕', weight: 400, style: 'normal' }] })).toBeUndefined();
    expect(quiet.supply).not.toHaveBeenCalled();
  });

  test('an installed family is drawn under the name the document wrote', async () => {
    const { supply } = main({ malgun: 100, malgunbd: 120 }, () => [face('맑은 고딕', 400, 'malgun'), face('맑은 고딕', 700, 'malgunbd')]);
    const answer = await installedFontSupply(supply, make, fresh())({ families: ['맑은 고딕'], defaultFamily: '맑은 고딕' });
    expect(answer).toEqual({ sources: [{ family: '맑은 고딕', weight: 400, style: 'normal', faceIndex: 0, size: 100 },
      { family: '맑은 고딕', weight: 700, style: 'normal', faceIndex: 0, size: 120 }], substitutions: [] });
  });

  test('a missing Korean family keeps its name and its line; a stand-in draws it', async () => {
    const { supply } = main({ nanum: 100, myeongjo: 90 }, () => [
      face('맑은 고딕', 400, 'nanum', { standIn: 'NanumGothic', lineBox: MALGUN_LINE }),
      face('Malgun Gothic', 400, 'nanum', { standIn: 'NanumGothic', lineBox: MALGUN_LINE }),
      face('바탕', 400, 'myeongjo', { standIn: 'NanumMyeongjo', index: 2 })]);
    const answer = await installedFontSupply(supply, make, fresh())({ families: ['맑은 고딕', 'Malgun Gothic', '바탕'], defaultFamily: 'Calibri' });
    // One source per stand-in face, however many document families it draws.
    expect(answer!.sources).toEqual([{ family: 'NanumGothic', weight: 400, style: 'normal', faceIndex: 0, size: 100 },
      { family: 'NanumMyeongjo', weight: 400, style: 'normal', faceIndex: 2, size: 90 }]);
    expect(answer!.substitutions).toEqual([
      { from: { family: '맑은 고딕', weight: 400, style: 'normal' }, to: { family: 'NanumGothic', weight: 400, style: 'normal' }, lineMetrics: MALGUN_LINE },
      { from: { family: 'Malgun Gothic', weight: 400, style: 'normal' }, to: { family: 'NanumGothic', weight: 400, style: 'normal' }, lineMetrics: MALGUN_LINE },
      { from: { family: '바탕', weight: 400, style: 'normal' }, to: { family: 'NanumMyeongjo', weight: 400, style: 'normal' } }]);
  });

  test('a stand-in the engine already holds is declared again without a second copy', async () => {
    const { supply, calls } = main({ nanum: 100 }, requests => requests.filter(request => request.weight === 400 && request.style === 'normal')
      .map(request => face(request.family, 400, 'nanum', { standIn: 'NanumGothic' })));
    const resolve = installedFontSupply(supply, make, fresh());
    await resolve({ families: ['맑은 고딕'], defaultFamily: '맑은 고딕' });
    const later = await resolve({ families: ['굴림'], defaultFamily: '맑은 고딕', faces: [{ family: '굴림', weight: 400, style: 'normal' }],
      resolvedFaces: [{ family: 'NanumGothic', weight: 400, style: 'normal' }, { family: '맑은 고딕', weight: 400, style: 'normal' }] });
    expect(later).toEqual({ sources: [], substitutions: [{ from: { family: '굴림', weight: 400, style: 'normal' }, to: { family: 'NanumGothic', weight: 400, style: 'normal' } }] });
    // The file was not asked for again.
    expect(calls[1].held).toEqual(['nanum']);
  });

  test('a document that is loaded again is answered in full from what is already held', async () => {
    const { supply, calls } = main({ nanum: 100 }, () => [face('맑은 고딕', 400, 'nanum', { standIn: 'NanumGothic' })]);
    const resolve = installedFontSupply(supply, vi.fn(make), fresh());
    const first = await resolve({ families: ['맑은 고딕'], defaultFamily: 'Calibri' });
    const again = await resolve({ families: ['맑은 고딕'], defaultFamily: 'Calibri' });
    expect(again).toEqual(first);
    expect(again!.sources[0]).toBe(first!.sources[0]);
    expect(calls.map(call => call.held)).toEqual([[], ['nanum']]);
  });

  test('font files are shared between documents and not sent twice', async () => {
    const { supply, calls } = main({ nanum: 100 }, () => [face('맑은 고딕', 400, 'nanum', { standIn: 'NanumGothic' })]);
    const shared = fresh();
    const one = await installedFontSupply(supply, make, shared)({ families: ['맑은 고딕'], defaultFamily: 'Calibri' });
    const two = await installedFontSupply(supply, make, shared)({ families: ['맑은 고딕'], defaultFamily: 'Calibri' });
    expect(calls[1].held).toEqual(['nanum']);
    expect(two).toEqual(one);
  });

  test('one document takes no more installed font bytes than its budget, and says what it left out', async () => {
    const { supply } = main({ batang: 60, batangBold: 60, dotum: 60 }, () => [face('함초롬바탕', 400, 'batang'), face('함초롬바탕', 700, 'batangBold'), face('함초롬돋움', 400, 'dotum'),
      face('한컴바탕', 400, 'batang', { standIn: '함초롬바탕' })]);
    const options = { ...fresh(), budget: 130 };
    const answer = await installedFontSupply(supply, make, options)({ families: ['함초롬바탕', '함초롬돋움', '한컴바탕'], defaultFamily: 'Calibri' });
    expect(answer!.sources.map(source => `${source.family} ${source.weight}`)).toEqual(['함초롬바탕 400', '함초롬바탕 700']);
    // A file already taken costs nothing more: the stand-in that reuses it is still declared.
    expect(answer!.substitutions.map(substitution => substitution.from.family)).toEqual(['한컴바탕']);
    expect(options.warn).toHaveBeenCalledTimes(1);
    expect(options.warn.mock.calls[0][0]).toContain('함초롬돋움');
  });

  test('a font file the engine refuses leaves its family to the next font origin', async () => {
    const { supply } = main({ broken: 10, nanum: 100 }, () => [face('Broken Sans', 400, 'broken'), face('맑은 고딕', 400, 'broken', { standIn: 'Broken Sans' }), face('굴림', 400, 'nanum', { standIn: 'NanumGothic' })]);
    const options = fresh();
    const refusing: FontSourceMaker<Source> = (bytes, wanted) => wanted.family === 'Broken Sans' ? { failure: { reason: 'malformed', diagnostic: 'no cmap' } } : make(bytes, wanted);
    const answer = await installedFontSupply(supply, refusing, options)({ families: ['Broken Sans', '맑은 고딕', '굴림'], defaultFamily: 'Calibri' });
    expect(answer!.sources.map(source => source.family)).toEqual(['NanumGothic']);
    expect(answer!.substitutions.map(substitution => substitution.from.family)).toEqual(['굴림']);
    expect(options.warn.mock.calls.map(call => call[0])).toEqual(['Document font unusable: Broken Sans malformed no cmap', 'Document font unusable: Broken Sans malformed no cmap']);
  });

  test('a face whose file main did not send and nobody holds is skipped', async () => {
    const supply = async (): Promise<DocxFontAnswer> => ({ faces: [face('맑은 고딕', 400, 'gone', { standIn: 'NanumGothic' })], files: [] });
    expect(await installedFontSupply(supply, make, fresh())({ families: ['맑은 고딕'], defaultFamily: 'Calibri' })).toBeUndefined();
  });

  test('a document closed while main was answering gets nothing', async () => {
    const stop = new AbortController();
    const supply = async (): Promise<DocxFontAnswer> => { stop.abort(Error('closed')); return { faces: [face('맑은 고딕', 400, 'nanum')], files: [{ id: 'nanum', bytes: new Uint8Array(4) }] }; };
    await expect(installedFontSupply(supply, make, fresh())({ families: ['맑은 고딕'], defaultFamily: 'Calibri', signal: stop.signal })).rejects.toThrow('closed');
  });
});

describe('the packaged pan-CJK face as the last resort for Korean', () => {
  const FACE = { family: 'Noto Sans CJK JP', weight: 400, style: 'normal' } as const;
  const BYTES: Source = { family: 'Noto Sans CJK JP', weight: 400, style: 'normal', faceIndex: 0, size: 16 };
  const STYLES = [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']] as const;
  const onto = (family: string) => STYLES.map(([weight, style]) => ({ from: { family, weight, style }, to: FACE }));
  /** The engine's origin: it has a rule for these families only, and loads the face when one of them or the face itself is named. */
  const origin = (rules: string[], options: { background?: boolean; fails?: boolean } = {}) => {
    const asked: FontWish[] = [];
    const resolve = (wish: FontWish): FontAnswer<Source> | undefined => {
      asked.push(wish);
      const painted = (family: string) => (wish.resolvedFaces ?? []).some(face => face.family === family && face.weight === 400 && face.style === 'normal');
      const planned = wish.families.filter(family => rules.includes(family) && !painted(family));
      if (!planned.length && !wish.families.includes(FACE.family)) return { sources: [], substitutions: [] };
      if (painted(FACE.family)) return { sources: [], substitutions: planned.flatMap(onto) };
      const loaded: FontAnswer<Source> = options.fails ? { sources: [], substitutions: [] } : { sources: [BYTES], substitutions: planned.flatMap(onto) };
      return options.background ? { sources: [], substitutions: [], deferred: Promise.resolve(loaded) } : loaded;
    };
    return { asked, resolve };
  };
  const lines = (answer: FontAnswer<Source> | undefined) => Object.fromEntries((answer?.substitutions ?? []).filter(one => one.from.weight === 400 && one.from.style === 'normal')
    .map(one => [one.from.family, one.lineMetrics?.heightEm === undefined ? null : Math.round(one.lineMetrics.heightEm * 1000) / 1000]));

  test('every Korean family nothing else draws is mapped onto the face and keeps the line Word gives it', async () => {
    const { asked, resolve } = origin(['맑은 고딕', '바탕', 'SimSun']);
    const answer = await koreanLastResort(resolve, FACE)({ families: ['맑은 고딕', '바탕', '궁서', 'HY견고딕', 'SimSun', 'Calibri'], defaultFamily: 'Calibri' });
    // The face is named, so the origin loads it also for the families it has no rule of its own for.
    expect(asked[0].families).toEqual(['맑은 고딕', '바탕', '궁서', 'HY견고딕', 'SimSun', 'Calibri', 'Noto Sans CJK JP']);
    expect(answer!.sources).toEqual([BYTES]);
    // A family of another language keeps the origin's answer as it is; a Latin family is not touched at all.
    expect(lines(answer)).toEqual({ '맑은 고딕': 1.729, '바탕': 1.3, 'SimSun': null, '궁서': 1.3, 'HY견고딕': 1.3 });
    // Each added family is mapped in its four styles.
    expect(answer!.substitutions!.filter(one => one.from.family === '궁서').map(one => `${one.from.weight} ${one.from.style} → ${one.to.family} ${one.to.weight} ${one.to.style}`))
      .toEqual(['400 normal → Noto Sans CJK JP 400 normal', '700 normal → Noto Sans CJK JP 400 normal', '400 italic → Noto Sans CJK JP 400 normal', '700 italic → Noto Sans CJK JP 400 normal']);
  });

  test('a document whose Korean families are all drawn already is passed through untouched', async () => {
    const { asked, resolve } = origin(['맑은 고딕', 'SimSun']);
    const wish: FontWish = { families: ['맑은 고딕', '궁서', 'SimSun'], defaultFamily: 'Calibri',
      resolvedFaces: [{ family: '맑은 고딕', weight: 400, style: 'normal' }, { family: '궁서', weight: 400, style: 'normal' }, { family: 'NanumGothic', weight: 400, style: 'normal' }] };
    const answer = await koreanLastResort(resolve, FACE)(wish);
    expect(asked[0]).toBe(wish);
    expect(lines(answer)).toEqual({ SimSun: null });
    // No Korean family at all: the face is not loaded for nothing.
    const latin = origin(['맑은 고딕']);
    expect(await koreanLastResort(latin.resolve, FACE)({ families: ['Calibri', 'Arial'], defaultFamily: 'Calibri' })).toEqual({ sources: [], substitutions: [] });
    expect(latin.asked[0].families).toEqual(['Calibri', 'Arial']);
  });

  test('a face that arrives after the first paint brings its mappings with it, and a face that cannot be loaded brings none', async () => {
    const late = await koreanLastResort(origin(['맑은 고딕'], { background: true }).resolve, FACE)({ families: ['맑은 고딕', '궁서'], defaultFamily: 'Calibri' });
    expect(late!.substitutions).toEqual([]);
    const arrived = await late!.deferred;
    expect(arrived!.sources).toEqual([BYTES]);
    expect(lines(arrived)).toEqual({ '맑은 고딕': 1.729, '궁서': 1.3 });

    const failed = await koreanLastResort(origin(['맑은 고딕'], { fails: true }).resolve, FACE)({ families: ['맑은 고딕', '궁서'], defaultFamily: 'Calibri' });
    expect(failed).toEqual({ sources: [], substitutions: [] });
    const failedLate = await koreanLastResort(origin(['맑은 고딕'], { fails: true, background: true }).resolve, FACE)({ families: ['궁서'], defaultFamily: 'Calibri' });
    expect(await failedLate!.deferred).toEqual({ sources: [], substitutions: [] });
  });

  test('a face the engine already holds is mapped onto without a second copy', async () => {
    const { resolve } = origin(['맑은 고딕']);
    const answer = await koreanLastResort(resolve, FACE)({ families: ['굴림체'], defaultFamily: 'Calibri', resolvedFaces: [FACE, { family: '맑은 고딕', weight: 400, style: 'normal' }] });
    expect(answer!.sources).toEqual([]);
    expect(lines(answer)).toEqual({ '굴림체': 1.3 });
  });
});
