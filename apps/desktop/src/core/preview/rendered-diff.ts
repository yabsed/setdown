import { splitPreviewBlocks, type PreviewBlock } from './preview-blocks';
import { alignPreviewBlocks } from './rendered-diff-alignment';

type RenderedDiffHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number };
type HtmlToken = { value: string; part: number; changed: boolean };
type DiffCell = { html: string; change: 'equal' | 'added' | 'removed' | 'empty'; whole: boolean };
type DiffRow = { before: DiffCell; after: DiffCell; equal: boolean };

const TOKEN = /\s+|&(?:#\d+|#x[\da-f]+|\w+);|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/giu;
const UNSAFE_TAG = /^(?:script|style|svg|math)$/i;
const VOID_TAG = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

function tokenizeHtml(html: string) {
  const parts = html.split(/(<[^>]+>)/g);
  const tokens: HtmlToken[] = [];
  const unsafe: boolean[] = [];
  const structure: string[] = [];
  for (let part = 0; part < parts.length; part += 1) {
    const value = parts[part];
    if (value.startsWith('<')) {
      structure.push(value.replace(/\sdata-source-(?:line|lines|start|end)="[^"]*"/g, ''));
      if (/^<\//.test(value)) unsafe.pop();
      else if (!/^<!/.test(value) && !/\/>$/.test(value)) {
        const name = /^<\s*([\w-]+)/.exec(value)?.[1] ?? '';
        if (VOID_TAG.test(name)) continue;
        const own = UNSAFE_TAG.test(name) || /\bclass="[^"]*\b(?:katex|MathJax)\b/.test(value);
        unsafe.push(own || unsafe.at(-1) === true);
      }
      continue;
    }
    if (unsafe.at(-1)) {
      structure.push(value);
      continue;
    }
    for (const match of value.matchAll(TOKEN)) tokens.push({ value: match[0], part, changed: false });
  }
  return { parts, tokens, structure: structure.join('') };
}

function markChangedTokens(originalHtml: string, modifiedHtml: string) {
  const original = tokenizeHtml(originalHtml);
  const modified = tokenizeHtml(modifiedHtml);
  const left = original.tokens;
  const right = modified.tokens;
  const whole = { before: originalHtml, after: modifiedHtml, inline: false };
  // Opaque math/SVG, attributes and formatting changes remain visible too.
  // Never inject word spans into their DOM or silently skip their differences.
  if (original.structure !== modified.structure || !left.length || !right.length
    || left.length > 500 || right.length > 500 || left.length * right.length > 80_000) return whole;

  const lengths = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let l = left.length - 1; l >= 0; l -= 1) {
    for (let r = right.length - 1; r >= 0; r -= 1) {
      lengths[l][r] = left[l].value === right[r].value
        ? lengths[l + 1][r + 1] + 1
        : Math.max(lengths[l + 1][r], lengths[l][r + 1]);
    }
  }
  left.forEach((token) => token.changed = true);
  right.forEach((token) => token.changed = true);
  let l = 0;
  let r = 0;
  while (l < left.length && r < right.length) {
    if (left[l].value === right[r].value) {
      left[l++].changed = right[r++].changed = false;
    } else if (lengths[l + 1][r] >= lengths[l][r + 1]) l += 1;
    else r += 1;
  }
  if (![...left, ...right].some((token) => token.changed && token.value.trim())) return whole;
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
        const before = token.changed && !marked ? `<span class="setdown-diff-word-${kind}">` : '';
        const after = !token.changed && marked ? '</span>' : '';
        marked = token.changed;
        return `${after}${before}${token.value}`;
      }).join('') + (marked ? '</span>' : '');
    }
    return parts.join('');
  };
  return { before: rebuild(original, 'removed'), after: rebuild(modified, 'added'), inline: true };
}

function cell(block: PreviewBlock | null, change: DiffCell['change'], whole = false): DiffCell {
  return { html: block?.html ?? '', change: block ? change : 'empty', whole: !!block && whole };
}

function analyze(originalHtml: string, modifiedHtml: string): DiffRow[] {
  return alignPreviewBlocks(splitPreviewBlocks(originalHtml), splitPreviewBlocks(modifiedHtml)).map((row) => {
    if (row.kind === 'equal') return { before: cell(row.before, 'equal'), after: cell(row.after, 'equal'), equal: true };
    const before = cell(row.before, 'removed', true);
    const after = cell(row.after, 'added', true);
    if (row.kind === 'replace' && row.before && row.after) {
      const highlighted = markChangedTokens(row.before.html, row.after.html);
      before.html = highlighted.before;
      after.html = highlighted.after;
      before.whole = after.whole = !highlighted.inline;
    }
    return { before, after, equal: false };
  });
}

function renderCell(cell: DiffCell, side?: 'before' | 'after'): string {
  const label = side === 'before' ? 'Before' : 'After';
  const changed = cell.change === 'added' || cell.change === 'removed';
  const classes = ['setdown-diff-cell', ...(side ? [`setdown-rendered-diff-${side}`] : []),
    ...(changed ? [`setdown-diff-${cell.change}`] : [])].join(' ');
  const detail = changed && cell.whole ? ', block-level change' : '';
  const aria = cell.change === 'empty' ? ' aria-hidden="true"'
    : ` aria-label="${side ? `${label}: ` : ''}${cell.change === 'equal' ? 'Unchanged' : cell.change === 'added' ? 'Added' : 'Removed'}${detail}"`;
  return `<section class="${classes}" data-change="${cell.change}" data-whole="${cell.whole}"${aria}>${cell.html}</section>`;
}

function unified(rows: DiffRow[]): string {
  return rows.flatMap((row) => row.equal ? [renderCell(row.after)]
    : [row.before, row.after].filter((entry) => entry.change !== 'empty').map((entry) => renderCell(entry))).join('\n');
}

/** Rendered equality is independent of Git's whitespace/source hunk grouping.
 * Keep hunks in the public API for callers; source navigation retains original
 * data-source-* attributes. Never zip non-hunk blocks by ordinal index.
 */
export function mergeRenderedDiff(originalHtml: string, modifiedHtml: string, _hunks: RenderedDiffHunk[]): string {
  return unified(analyze(originalHtml, modifiedHtml));
}

export function responsiveRenderedDiff(originalHtml: string, modifiedHtml: string, _hunks: RenderedDiffHunk[]): string {
  const analysis = analyze(originalHtml, modifiedHtml);
  const rows = analysis.map((row) => `<div class="setdown-rendered-diff-row setdown-rendered-diff-row-${row.equal ? 'unchanged' : 'changed'}">
${renderCell(row.before, 'before')}${renderCell(row.after, 'after')}
</div>`).join('\n');
  return `<div class="setdown-rendered-diff-unified">${unified(analysis)}</div>
<div class="setdown-rendered-diff-split" aria-label="Side-by-side rendered comparison">${rows}</div>`;
}

export const RENDERED_DIFF_STYLES = `<style id="setdown-rendered-diff-styles">
  .setdown-rendered-diff-unified, .setdown-rendered-diff-split {
    --diff-add-context: rgba(39, 151, 69, .12);
    --diff-remove-context: rgba(201, 54, 48, .11);
    --diff-add-strong: rgba(39, 151, 69, .30);
    --diff-remove-strong: rgba(201, 54, 48, .28);
    --diff-add-edge: #227a3c;
    --diff-remove-edge: #b1302a;
    --diff-empty: rgba(127, 127, 127, .035);
  }
  body[data-preview-theme="dark"] :is(.setdown-rendered-diff-unified, .setdown-rendered-diff-split) {
    --diff-add-context: rgba(70, 190, 110, .14);
    --diff-remove-context: rgba(244, 100, 94, .13);
    --diff-add-strong: rgba(70, 190, 110, .30);
    --diff-remove-strong: rgba(244, 100, 94, .28);
    --diff-add-edge: #72d392;
    --diff-remove-edge: #ff958e;
  }
  .setdown-diff-cell {
    box-sizing: border-box;
    position: relative;
    display: flow-root;
    min-width: 0;
    padding: .6rem 1.5rem;
    border-left: 3px solid transparent;
    border-right: 1px solid transparent;
    overflow-wrap: anywhere;
  }
  .setdown-diff-cell > :first-child { margin-top: 0 !important; }
  .setdown-diff-cell > :last-child { margin-bottom: 0 !important; }
  .setdown-diff-cell[data-change="added"] {
    background: var(--diff-add-context) !important;
    border-left-color: var(--diff-add-edge);
  }
  .setdown-diff-cell[data-change="removed"] {
    background: var(--diff-remove-context) !important;
    border-left-color: var(--diff-remove-edge);
  }
  /* Match the actual composited word highlight, not just its alpha value. */
  .setdown-diff-cell[data-change="added"][data-whole="true"] { background: linear-gradient(var(--diff-add-strong), var(--diff-add-strong)) var(--diff-add-context) !important; }
  .setdown-diff-cell[data-change="removed"][data-whole="true"] { background: linear-gradient(var(--diff-remove-strong), var(--diff-remove-strong)) var(--diff-remove-context) !important; }
  .setdown-diff-cell[data-change="empty"] { background: var(--diff-empty); }
  .setdown-diff-cell[data-change="added"]::before,
  .setdown-diff-cell[data-change="removed"]::before {
    position: absolute;
    left: .25rem;
    top: .6rem;
    font: 600 12px/1.6 ui-monospace, monospace;
    pointer-events: none;
  }
  .setdown-diff-cell[data-change="added"]::before { content: "+"; color: var(--diff-add-edge); }
  .setdown-diff-cell[data-change="removed"]::before { content: "−"; color: var(--diff-remove-edge); }
  .setdown-diff-word-added, .setdown-diff-word-removed {
    padding: 0;
    border-radius: 2px;
    color: inherit;
    text-decoration: none;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  .setdown-diff-word-added { background: var(--diff-add-strong); }
  .setdown-diff-word-removed { background: var(--diff-remove-strong); }
  .setdown-rendered-diff-split { display: none; }
  @media (min-width: 720px) {
    .setdown-rendered-diff-unified { display: none; }
    .setdown-rendered-diff-split { display: block; margin: -1rem -1.25rem 0; padding: .4rem 0 4.4rem; }
    .setdown-rendered-diff-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: stretch;
      gap: 0;
    }
    .setdown-rendered-diff-before, .setdown-rendered-diff-after {
      box-sizing: border-box;
      min-width: 0;
    }
    .setdown-rendered-diff-before { border-right-color: rgba(127, 127, 127, .2); }
  }
  :is(.setdown-rendered-diff-split, .setdown-rendered-diff-unified) :where(h1, h2, h3, h4, h5, h6, p, li, blockquote) {
    min-width: 0;
    max-width: 100%;
    white-space: normal !important;
    overflow-wrap: anywhere !important;
  }
  :is(.setdown-rendered-diff-split, .setdown-rendered-diff-unified) :where(pre, .katex-display, .MathJax_Display, .crossnote-html-source) {
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
  }
  :is(.setdown-rendered-diff-split, .setdown-rendered-diff-unified) table {
    display: block;
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
  }
  :is(.setdown-rendered-diff-split, .setdown-rendered-diff-unified) :where(img, video, svg) {
    max-width: 100%;
    height: auto;
  }
</style>`;
