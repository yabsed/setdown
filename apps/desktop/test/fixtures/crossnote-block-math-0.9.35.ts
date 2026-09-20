// Adapted from Crossnote 0.9.35 math.ts; see docs/licenses/crossnote-NCSA.txt.
import type { BlockMathConfig, BlockMathRule, BlockMathState } from '../../src/main/preview/fast-block-math';

// Reference operations from the pinned 0.9.35 rule. The integration suite also
// compares against the actual rule exposed by a real Crossnote Notebook.
export const referenceBlockMath = (config: () => BlockMathConfig): BlockMathRule => (state, start, end, silent) => {
  if (config().mathRenderingOption === 'None') return false;
  const pos = state.bMarks[start] + state.tShift[start];
  let openTag: string | null = null; let closeTag: string | null = null;
  for (const [open, close] of config().mathBlockDelimiters) {
    if (state.src.slice(pos, pos + open.length) === open) { openTag = open; closeTag = close; break; }
  }
  if (!openTag || !closeTag) return false;
  let logical = '';
  for (let line = start; line < end; line++) {
    logical += (line === start ? '' : '\n') + state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
  }
  const body = logical.slice(openTag.length); let closing = -1; let scan = 0;
  while (scan < body.length) {
    if (body.startsWith(closeTag, scan)) { closing = scan; break; }
    if (body[scan] === '\\') scan++;
    scan++;
  }
  if (closing < 0) return false;
  if (silent) return true;
  const consumed = openTag.length + closing + closeTag.length;
  let cumulative = 0; let next = start + 1;
  for (let line = start; line < end; line++) {
    cumulative += state.eMarks[line] - (state.bMarks[line] + state.tShift[line]) + (line === start ? 0 : 1);
    if (cumulative >= consumed) { next = line + 1; break; }
  }
  const token = state.push('math_block', 'div', 0);
  token.content = body.slice(0, closing).trim(); token.meta = { openTag, closeTag }; token.map = [start, next];
  state.line = next; return true;
};

export function stateFor(lines: string[], prefixes: number[] = []) {
  let offset = 0; let reads = 0;
  const ends: number[] = []; const begins: number[] = [];
  const tokens: unknown[] = [];
  lines.forEach((line) => { begins.push(offset); ends.push(offset + line.length); offset += line.length + 1; });
  const state: BlockMathState = { src: lines.join('\n'), bMarks: begins,
    eMarks: new Proxy(ends, { get(target, key, receiver) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key, receiver); } }),
    tShift: lines.map((_, index) => prefixes[index] ?? 0), line: 0,
    push(type, tag, nesting) { const token = { type, tag, nesting, content: '', meta: null as unknown, map: null as [number, number] | null };
      tokens.push(token); return token; },
  };
  return { state, tokens, reads: () => reads };
}
