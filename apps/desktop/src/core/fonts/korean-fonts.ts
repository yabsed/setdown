import { fontFamilyKey } from './font-match';

/**
 * Korean documents name the fonts that ship with Windows, Microsoft Office and Hancom Office
 * (맑은 고딕, 바탕, HY신명조, 휴먼명조 …). They cannot be redistributed and are missing on most
 * other machines. This says which installed Korean face stands in for a missing one, so the
 * text keeps its class: a myeongjo (serif) document stays myeongjo, a gothic one stays gothic.
 *
 * The stand-in covers the text, not the metrics: lines can break elsewhere than in Word. The
 * document is never rewritten; it keeps naming its own fonts.
 */
export type KoreanFontClass = 'sans' | 'serif';
export type FontLineBox = { heightEm: number; baselineEm: number };

// English names of Korean families. A name written in Hangul needs no list.
const KOREAN_LATIN_NAME = new RegExp(`^(${[
  'malgun gothic', 'gulim', 'gulimche', 'dotum', 'dotumche', 'batang', 'batangche', 'gungsuh', 'gungsuhche', 'new gulim',
  'hcr (batang|dotum)', 'haansoft (batang|dotum)', 'hancom ', 'hy[a-z]+-', 'nanum', 'noto (sans|serif)( mono)?( cjk)? kr',
  'source han (sans|serif) k', 'apple sd gothic', 'applegothic', 'applemyungjo', 'pretendard', 'kopub', 'baekmuk',
  'un(batang|dotum|graphic|gungseo|pilgi|dinaru|shinmun)', 'spoqa han sans', 'ibm plex sans kr', 'gowun',
].join('|')})`);
const HANGUL = /[가-힣]/;
// Myeongjo, batang, gungsuh and newspaper faces have serifs; everything else Korean is read as gothic.
const SERIF = /명조|바탕|궁서|신문|해서|순명|myeongjo|myungjo|myoungjo|batang|gungsuh|gungso|gungseo|shinmun|serif|mincho/;

/** The class of a Korean family, or null when the name is not one a Korean face should stand in for. */
export function koreanFontClass(family: string): KoreanFontClass | null {
  const key = fontFamilyKey(family);
  if (!HANGUL.test(key) && !KOREAN_LATIN_NAME.test(key)) return null;
  return SERIF.test(key) ? 'serif' : 'sans';
}

/**
 * Installed families that can stand in, best first: the platform's own face, then the small
 * open ones (a few MiB a face), then the pan-CJK ones (tens of MiB). The pan-CJK families of
 * other regions come last: their Hangul is the same drawing as the Korean one's.
 */
export const KOREAN_STAND_INS: Readonly<Record<KoreanFontClass, readonly string[]>> = {
  sans: ['Malgun Gothic', 'Apple SD Gothic Neo', 'NanumGothic', 'Noto Sans KR', 'Noto Sans CJK KR', 'NanumBarunGothic',
    'HCR Dotum', 'Source Han Sans K', 'Source Han Sans KR', 'UnDotum', 'Baekmuk Dotum', 'Gulim', 'Dotum',
    'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Noto Sans CJK TC', 'Noto Sans CJK HK', 'Source Han Sans'],
  serif: ['Batang', 'AppleMyungjo', 'NanumMyeongjo', 'Noto Serif KR', 'Noto Serif CJK KR', 'HCR Batang',
    'Source Han Serif K', 'Source Han Serif KR', 'UnBatang', 'Baekmuk Batang',
    'Noto Serif CJK JP', 'Noto Serif CJK SC', 'Noto Serif CJK TC', 'Source Han Serif'],
};
/** Every stand-in to try for a class: its own list, then the other class. Any Korean face beats none. */
export const koreanStandIns = (kind: KoreanFontClass): readonly string[] =>
  [...KOREAN_STAND_INS[kind], ...KOREAN_STAND_INS[kind === 'sans' ? 'serif' : 'sans']];

// Word gives a face with East Asian code pages a single-spaced line of 1.3 times its own box
// (ascent + descent), with the extra space split above and below the glyphs.
const CJK_LINE = 1.3;
const lineBox = (ascent: number, descent: number): FontLineBox =>
  ({ heightEm: (ascent + descent) * CJK_LINE, baselineEm: ascent + (ascent + descent) * (CJK_LINE - 1) / 2 });
// 맑은 고딕: hhea ascender 2210 and descender 514 of a 2048-unit em.
const MALGUN_GOTHIC = lineBox(2210 / 2048, 514 / 2048);
// The older Korean faces (바탕, 굴림, 돋움, 궁서 and the HY and Hancom families drawn like them) fill a one-em box.
// Assumed for a missing family whose own box is not recorded here.
const ONE_EM = lineBox(0.859, 0.141);

/**
 * The line Word gives the missing Korean family, kept whatever face draws its text. Without it a
 * stand-in's own, usually shorter, box would move every line and page break of the document.
 */
export function koreanLineBox(family: string): FontLineBox {
  const key = fontFamilyKey(family);
  return key.startsWith('malgun gothic') || key.startsWith('맑은 고딕') ? MALGUN_GOTHIC : ONE_EM;
}
