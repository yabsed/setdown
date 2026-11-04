import type { NotebookConfig } from 'crossnote';

/** Keep dollar math unchanged; bracket pairs also accept one pasted escape layer. */
export const previewMathDelimiters: Pick<NotebookConfig, 'mathInlineDelimiters' | 'mathBlockDelimiters'> = {
  mathInlineDelimiters: [['$', '$'], ['\\(', '\\)'], ['\\\\(', '\\\\)']],
  mathBlockDelimiters: [['$$', '$$'], ['\\[', '\\]'], ['\\\\[', '\\\\]']],
};

type Token = { type: string; content: string; meta?: Record<string, unknown>; children?: Token[] | null };
type BlockState = {
  src: string; bMarks: number[]; tShift: number[]; eMarks: number[];
};
type BlockRule = (state: BlockState, start: number, end: number, silent: boolean) => boolean;
type MathMarkdown = {
  block: { ruler: {
    __rules__: { name: string; fn: BlockRule }[];
    at(name: string, rule: BlockRule): void;
  } };
  core: { ruler: { push(name: string, rule: (state: { tokens: Token[] }) => void): void } };
};

function recoverPastedMath(content: string): string {
  // Only doubled bracket delimiters opt into recovery. Single-bracket/dollar
  // math keeps literal underscores, escaped braces, spacing and row breaks.
  return content.replace(/\\{2,}|\\([_*\[\]<>])/g, (match, punctuation: string | undefined, offset: number) => {
    if (punctuation) return punctuation;
    // A valid TeX row separator is often copied unchanged, while the escaped
    // forms in copied Markdown contain three or four backslashes.
    const next = content[offset + 2];
    if (match.length === 2 && (next === undefined || /\s/.test(next))) return match;
    return '\\'.repeat(Math.ceil(match.length / 2));
  });
}

/** Install before source anchors and deferred rendering; never rewrite source. */
export function installMathCompatibility(md: MathMarkdown): void {
  const original = md.block.ruler.__rules__.find(rule => rule.name === 'math_block')?.fn;
  if (original) md.block.ruler.at('math_block', (state, start, end, silent) => {
    const position = state.bMarks[start] + state.tShift[start];
    const opening = /^\\{1,2}\[/.exec(state.src.slice(position, position + 3))?.[0];
    if (opening) {
      const closing = opening.slice(0, -1) + ']';
      // Crossnote's block rule consumes the entire closing line, including
      // subsequent formulas/prose. Let its inline rule handle such paragraphs.
      scan: for (let line = start; line < end; line++) {
        for (let i = state.bMarks[line] + state.tShift[line] + (line === start ? opening.length : 0);
          i < state.eMarks[line]; i++) {
          if (state.src.startsWith(closing, i)) {
            if (state.src.slice(i + closing.length, state.eMarks[line]).trim()) return false;
            break scan;
          }
          if (state.src[i] === '\\') i++;
        }
      }
    }
    return original(state, start, end, silent);
  });

  md.core.ruler.push('setdown_pasted_math', ({ tokens }) => {
    const recover = (token: Token) => {
      if ((token.type === 'math' || token.type === 'math_block')
        && (token.meta?.openTag === '\\\\(' || token.meta?.openTag === '\\\\[')) {
        token.content = recoverPastedMath(token.content);
      }
    };
    for (const token of tokens) {
      recover(token);
      if (token.type === 'inline') token.children?.forEach(recover);
    }
  });
}
