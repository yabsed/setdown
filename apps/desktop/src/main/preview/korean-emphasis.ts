type DelimiterScan = { length: number; can_open: boolean; can_close: boolean };
type InlineState = {
  src: string; pos: number; tokens: unknown[];
  scanDelims(start: number, canSplitWord: boolean): DelimiterScan;
  push(type: string, tag: string, nesting: number): { content: string };
  delimiters: { marker: number; length: number; token: number; end: number; open: boolean; close: boolean }[];
};
type Parser = { inline: { ruler: { before(name: string, ruleName: string, rule: (state: InlineState, silent: boolean) => boolean): void } } };
const hangul = /\p{Script=Hangul}/u;
// CommonMark punctuation: Unicode P plus ASCII symbols, not arbitrary emoji.
const punctuation = /[\p{P}\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/u;

/** Permit Korean text against punctuation at a strong-emphasis boundary.
 * Keep the original source/offsets and markdown-it's delimiter pairing. Escapes,
 * code, links, nesting and unmatched markers still belong to the normal parser. */
export function installKoreanEmphasis(md: Parser): void {
  md.inline.ruler.before('emphasis', 'setdown_korean_strong', (state, silent) => {
    if (silent || !state.src.startsWith('**', state.pos)) return false;
    const scan = state.scanDelims(state.pos, true);
    if (scan.length !== 2) return false;
    const before = state.src[state.pos - 1] ?? '', after = state.src[state.pos + 2] ?? '';
    const close = punctuation.test(before) && hangul.test(after);
    const open = hangul.test(before) && punctuation.test(after);
    if (!close && !open) return false;
    for (let i = 0; i < 2; i++) {
      state.push('text', '', 0).content = '*';
      state.delimiters.push({ marker: 0x2a, length: 2, token: state.tokens.length - 1, end: -1,
        open: scan.can_open || open, close: scan.can_close || close });
    }
    state.pos += 2;
    return true;
  });
}
