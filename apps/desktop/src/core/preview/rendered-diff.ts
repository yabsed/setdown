import { splitPreviewBlocks, type PreviewBlock } from './preview-blocks';

type LocatedBlock = PreviewBlock & { index: number; start: number; end: number };
type RenderedDiffHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number };
type HtmlToken = { value: string; part: number; changed: boolean };
type RenderedDiffAnalysis = {
  original: LocatedBlock[];
  modified: LocatedBlock[];
  added: Set<number>;
  removed: Set<number>;
  removedAt: Map<number, number[]>;
  highlightedOriginal: Map<number, string>;
  highlightedModified: Map<number, string>;
};

const TOKEN = /\s+|&(?:#\d+|#x[\da-f]+|\w+);|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/giu;
const UNSAFE_TAG = /^(?:script|style|svg|math)$/i;
const VOID_TAG = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

function tokenizeHtml(html: string): { parts: string[]; tokens: HtmlToken[] } {
  const parts = html.split(/(<[^>]+>)/g);
  const tokens: HtmlToken[] = [];
  const unsafe: boolean[] = [];
  for (let part = 0; part < parts.length; part += 1) {
    const value = parts[part];
    if (value.startsWith('<')) {
      if (/^<\//.test(value)) unsafe.pop();
      else if (!/^<!/.test(value) && !/\/>$/.test(value)) {
        const name = /^<\s*([\w-]+)/.exec(value)?.[1] ?? '';
        if (VOID_TAG.test(name)) continue;
        const own = UNSAFE_TAG.test(name) || /\bclass="[^"]*\bkatex\b/.test(value);
        unsafe.push(own || unsafe.at(-1) === true);
      }
      continue;
    }
    if (unsafe.at(-1)) continue;
    for (const match of value.matchAll(TOKEN)) {
      tokens.push({ value: match[0], part, changed: false });
    }
  }
  return { parts, tokens };
}

function markChangedTokens(originalHtml: string, modifiedHtml: string): [string, string] {
  const original = tokenizeHtml(originalHtml);
  const modified = tokenizeHtml(modifiedHtml);
  const left = original.tokens;
  const right = modified.tokens;
  if (!left.length || !right.length || left.length > 500 || right.length > 500
    || left.length * right.length > 80_000) {
    return [originalHtml, modifiedHtml];
  }

  const rows = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let l = left.length - 1; l >= 0; l -= 1) {
    for (let r = right.length - 1; r >= 0; r -= 1) {
      rows[l][r] = left[l].value === right[r].value
        ? rows[l + 1][r + 1] + 1
        : Math.max(rows[l + 1][r], rows[l][r + 1]);
    }
  }
  left.forEach((token) => token.changed = true);
  right.forEach((token) => token.changed = true);
  let l = 0;
  let r = 0;
  while (l < left.length && r < right.length) {
    if (left[l].value === right[r].value) {
      left[l].changed = right[r].changed = false;
      l += 1;
      r += 1;
    } else if (rows[l + 1][r] >= rows[l][r + 1]) l += 1;
    else r += 1;
  }

  const rebuild = ({ parts, tokens }: ReturnType<typeof tokenizeHtml>, kind: 'added' | 'removed') => {
    const byPart = new Map<number, HtmlToken[]>();
    for (const token of tokens) {
      const group = byPart.get(token.part) ?? [];
      group.push(token);
      byPart.set(token.part, group);
    }
    for (const [part, group] of byPart) {
      for (let index = 0; index < group.length; index += 1) {
        if (group[index].value.trim()) continue;
        group[index].changed = index > 0 && index < group.length - 1
          && group[index - 1].changed && group[index + 1].changed;
      }
      let marked = false;
      parts[part] = group.map((token) => {
        const changed = token.changed;
        const before = changed && !marked ? `<span class="setdown-diff-word-${kind}">` : '';
        const after = !changed && marked ? '</span>' : '';
        marked = changed;
        return `${after}${before}${token.value}`;
      }).join('') + (marked ? '</span>' : '');
    }
    return parts.join('');
  };
  return [rebuild(original, 'removed'), rebuild(modified, 'added')];
}

function locate(blocks: PreviewBlock[]): LocatedBlock[] {
  const starts: number[] = [];
  let previous = 1;
  for (const block of blocks) {
    if (block.line !== null) previous = block.line;
    starts.push(previous);
  }
  const nextStarts: Array<number | undefined> = [];
  let next: number | undefined;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    nextStarts[index] = next;
    if (blocks[index].line !== null) next = blocks[index].line!;
  }
  return blocks.map((block, index) => ({
    ...block,
    index,
    start: starts[index],
    end: nextStarts[index] === undefined
      ? Number.MAX_SAFE_INTEGER : Math.max(starts[index], nextStarts[index]! - 1),
  }));
}

function overlapping(blocks: LocatedBlock[], start: number, count: number): number[] {
  if (count <= 0) return [];
  const end = start + count - 1;
  return blocks.filter((block) => block.start <= end && block.end >= start)
    .map(({ index }) => index);
}

function insertionIndex(blocks: LocatedBlock[], line: number): number {
  return blocks.find(({ start, end }) => start >= line || end >= line)?.index ?? blocks.length;
}

function marked(html: string, kind: 'added' | 'removed'): string {
  const className = `setdown-diff-${kind}`;
  const opening = /^\s*<[a-z][^>]*>/i.exec(html)?.[0];
  if (!opening) return `<div class="${className}" data-setdown-diff="${kind}">${html}</div>`;
  const decorated = /\sclass="/i.test(opening)
    ? opening.replace(/\sclass="/i, ` class="${className} `)
    : opening.replace(/>$/, ` class="${className}" data-setdown-diff="${kind}">`);
  return `${decorated}${html.slice(opening.length)}`;
}

function analyzeRenderedDiff(
  originalHtml: string,
  modifiedHtml: string,
  hunks: RenderedDiffHunk[],
): RenderedDiffAnalysis {
  const original = locate(splitPreviewBlocks(originalHtml));
  const modified = locate(splitPreviewBlocks(modifiedHtml));
  const added = new Set<number>();
  const removed = new Set<number>();
  const removedAt = new Map<number, number[]>();
  const highlightedOriginal = new Map<number, string>();
  const highlightedModified = new Map<number, string>();

  for (const hunk of hunks) {
    const oldIndices = overlapping(original, hunk.oldStart, hunk.oldLines);
    const newIndices = overlapping(modified, hunk.newStart, hunk.newLines);
    for (let index = 0; index < Math.min(oldIndices.length, newIndices.length); index += 1) {
      const oldIndex = oldIndices[index];
      const newIndex = newIndices[index];
      const [oldHtml, newHtml] = markChangedTokens(
        original[oldIndex].html,
        modified[newIndex].html,
      );
      highlightedOriginal.set(oldIndex, oldHtml);
      highlightedModified.set(newIndex, newHtml);
    }
    for (const index of oldIndices) removed.add(index);
    for (const index of newIndices) added.add(index);
    const at = newIndices[0] ?? insertionIndex(modified, hunk.newStart);
    const existing = removedAt.get(at) ?? [];
    for (const index of oldIndices) if (!existing.includes(index)) existing.push(index);
    if (existing.length) removedAt.set(at, existing);
  }

  return {
    original,
    modified,
    added,
    removed,
    removedAt,
    highlightedOriginal,
    highlightedModified,
  };
}

function mergeAnalyzedDiff(analysis: RenderedDiffAnalysis): string {
  const {
    original,
    modified,
    added,
    removedAt,
    highlightedOriginal,
    highlightedModified,
  } = analysis;

  const output: string[] = [];
  const emittedRemoved = new Set<number>();
  for (let index = 0; index <= modified.length; index += 1) {
    for (const oldIndex of removedAt.get(index) ?? []) {
      if (emittedRemoved.has(oldIndex)) continue;
      emittedRemoved.add(oldIndex);
      output.push(marked(highlightedOriginal.get(oldIndex) ?? original[oldIndex].html, 'removed'));
    }
    if (index < modified.length) {
      output.push(added.has(index)
        ? marked(highlightedModified.get(index) ?? modified[index].html, 'added')
        : modified[index].html);
    }
  }
  return output.join('\n');
}

/** Merges two sanitized preview fragments into one document with changed blocks only duplicated. */
export function mergeRenderedDiff(
  originalHtml: string,
  modifiedHtml: string,
  hunks: RenderedDiffHunk[],
): string {
  return mergeAnalyzedDiff(analyzeRenderedDiff(originalHtml, modifiedHtml, hunks));
}

/**
 * Keeps the compact, unified review for narrow windows and also carries a complete
 * before/after pair that CSS reveals when both documents have useful reading width.
 */
export function responsiveRenderedDiff(
  originalHtml: string,
  modifiedHtml: string,
  hunks: RenderedDiffHunk[],
): string {
  const analysis = analyzeRenderedDiff(originalHtml, modifiedHtml, hunks);
  const before = analysis.original.map((block) => analysis.removed.has(block.index)
    ? marked(analysis.highlightedOriginal.get(block.index) ?? block.html, 'removed')
    : block.html).join('\n');
  const after = analysis.modified.map((block) => analysis.added.has(block.index)
    ? marked(analysis.highlightedModified.get(block.index) ?? block.html, 'added')
    : block.html).join('\n');
  return `<div class="setdown-rendered-diff-unified">${mergeAnalyzedDiff(analysis)}</div>
<div class="setdown-rendered-diff-split" aria-label="Side-by-side rendered comparison">
  <section class="setdown-rendered-diff-before" aria-label="Before">${before}</section>
  <section class="setdown-rendered-diff-after" aria-label="After">${after}</section>
</div>`;
}

export const RENDERED_DIFF_STYLES = `<style id="setdown-rendered-diff-styles">
  .setdown-diff-added, .setdown-diff-removed {
    margin-left: -10px !important;
    margin-right: -10px !important;
    padding-left: 10px !important;
    padding-right: 10px !important;
  }
  .setdown-diff-added {
    background: rgba(55, 166, 83, .07) !important;
  }
  .setdown-diff-removed {
    background: rgba(208, 93, 87, .06) !important;
  }
  .setdown-diff-word-added, .setdown-diff-word-removed {
    padding: .04em .08em;
    border-radius: 2px;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  .setdown-diff-word-added { background: rgba(55, 166, 83, .34); }
  .setdown-diff-word-removed {
    color: #d96a64;
    background: rgba(208, 93, 87, .26);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
  .setdown-rendered-diff-split { display: none; }
  @media (min-width: 1080px) {
    .setdown-rendered-diff-unified { display: none; }
    .setdown-rendered-diff-split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
      margin: -1rem -1.25rem 0;
    }
    .setdown-rendered-diff-before,
    .setdown-rendered-diff-after {
      min-width: 0;
      padding: 1rem 1.5rem 5rem;
      overflow: hidden;
    }
    .setdown-rendered-diff-before {
      border-right: 1px solid rgba(127, 127, 127, .2);
    }
  }
</style>`;
