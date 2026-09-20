/** Compatible fast path for Crossnote 0.9.35's math_block rule.
 * The original rule remains authoritative for unsupported delimiter forms.
 * Renderers, sanitizer, token types and source maps are not replaced.
 */
export type BlockMathState = {
  src: string; bMarks: number[]; tShift: number[]; eMarks: number[]; line: number;
  push(type: string, tag: string, nesting: number): {
    content: string; meta: unknown; map: [number, number] | null;
  };
};
export type BlockMathRule = (state: BlockMathState, start: number, end: number, silent: boolean) => boolean;
export type BlockMathConfig = {
  mathRenderingOption: string;
  mathBlockDelimiters: readonly (readonly [string, string])[];
};
export type BlockMathParser = { block: { ruler: {
  at(name: string, rule: BlockMathRule): void;
  __rules__?: { name: string; fn: BlockMathRule }[];
} } };

/** Each successful block reads only through its closing delimiter, not EOF.
 * Work on logical lines: markdown-it already removed list/quote prefixes using
 * bMarks/tShift. A trailing backslash escapes the inserted newline, not the next
 * line's first character. No state is mutated until a complete match exists.
 */
export function fastBlockMath(original: BlockMathRule, config: () => BlockMathConfig): BlockMathRule {
  return (state, start, end, silent) => {
    const options = config();
    if (options.mathRenderingOption === 'None') return false;
    const pairs = options.mathBlockDelimiters;
    if (!Array.isArray(pairs) || pairs.some((pair) => !Array.isArray(pair)
      || pair.length !== 2 || pair.some((part) => typeof part !== 'string' || !part || /[\r\n]/.test(part)))) {
      return original(state, start, end, silent);
    }
    const at = state.bMarks[start] + state.tShift[start];
    const pair = pairs.find(([open]) => state.src.startsWith(open, at));
    if (!pair) return false;
    const [open, close] = pair;
    if (at + open.length > state.eMarks[start]) return original(state, start, end, silent);
    const pieces: string[] = [];
    for (let line = start; line < end; line++) {
      const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
      const begin = line === start ? open.length : 0;
      for (let index = begin; index < text.length;) {
        if (text.startsWith(close, index)) {
          if (silent) return true;
          pieces.push(text.slice(begin, index));
          const token = state.push('math_block', 'div', 0);
          token.content = pieces.join('\n').trim();
          token.meta = { openTag: open, closeTag: close };
          token.map = [start, line + 1];
          state.line = line + 1;
          return true;
        }
        index += text[index] === '\\' ? 2 : 1;
      }
      if (!silent) pieces.push(text.slice(begin));
    }
    return false;
  };
}

const installed = new WeakSet<object>();
/** Fail closed on upgrades: a version bump needs upstream-equivalence tests. */
export function installFastBlockMath(md: BlockMathParser, config: () => BlockMathConfig, version: string): boolean {
  if (version !== '0.9.35' || installed.has(md)) return false;
  const ruler = md.block?.ruler;
  const original = ruler?.__rules__?.find((rule) => rule.name === 'math_block')?.fn;
  if (!original || typeof ruler.at !== 'function') return false;
  ruler.at('math_block', fastBlockMath(original, config));
  installed.add(md);
  return true;
}
