import { blockKey, splitPreviewBlocks } from './preview-blocks';

/** Each A/B page has its own acknowledged baseline, not the other page's revision. */
export type ReviewRows = { unified: string[]; split: string[] };
export type ReviewRowSplice = { from: number; removeCount: number; rows: string[] };
export type ReviewRowShift = { from: number; count: number; deltas: number[] };
export type ReviewTreePatch = {
  baseLength: number;
  length: number;
  splices: ReviewRowSplice[];
  /** Original row indices; applied to retained references after splicing. */
  shifts: ReviewRowShift[];
};
export type ReviewRowsPatch = {
  version: 1; baseRevision: number; revision: number;
  unified: ReviewTreePatch; split: ReviewTreePatch;
};
export const REVIEW_SOURCE_ATTRIBUTES = [
  'data-source-line', 'data-source-lines', 'data-source-start', 'data-source-end',
] as const;

/** Only line components move. Columns, missing attributes and authored text do not. */
export function shiftedReviewAttribute(name: string, value: string, delta: number): string {
  const match = /^(\d+)(?:([:-])(\d+))?$/.exec(value);
  if (!match) return value;
  const line = Math.max(1, Number(match[1]) + delta);
  if (!match[2]) return String(line);
  const last = name === 'data-source-lines' && match[2] === '-'
    ? Math.max(1, Number(match[3]) + delta) : Number(match[3]);
  return `${line}${match[2]}${last}`;
}
export function shiftReviewHtml(html: string, delta: number): string {
  if (!delta) return html;
  // Only actual start tags. Code/prose containing data-source-line="..." is content.
  return html.replace(/<[a-zA-Z][^>]*>/g, (tag) => tag.replace(
    /\s(data-source-(?:line|lines|start|end))="(\d+(?:[:-]\d+)?)"/g,
    (_whole, name: string, value: string) => ` ${name}="${shiftedReviewAttribute(name, value, delta)}"`,
  ));
}
function inner(html: string): string {
  const start = html.indexOf('>'); const end = html.lastIndexOf('</');
  return start < 0 || end <= start ? '' : html.slice(start + 1, end);
}
/** Accept the existing sanitized responsiveRenderedDiff structure, not arbitrary HTML. */
export function readReviewRows(html: string): ReviewRows {
  const roots = splitPreviewBlocks(html);
  if (roots.length !== 2 || !/^<div class="setdown-rendered-diff-unified">/.test(roots[0].html)
    || !/^<div class="setdown-rendered-diff-split"/.test(roots[1].html)) {
    throw new Error('Unexpected rendered review structure.');
  }
  return {
    unified: splitPreviewBlocks(inner(roots[0].html)).map((block) => block.html),
    split: splitPreviewBlocks(inner(roots[1].html)).map((block) => block.html),
  };
}
function deltaFor(previous: string, next: string): number | null {
  if (previous === next) return 0;
  const line = (html: string) => html.match(/<[a-zA-Z][^>]*>/g)?.join('')
    .match(/\sdata-source-(?:line|lines|start|end)="(\d+)/)?.[1];
  const before = line(previous); const after = line(next);
  if (!before || !after) return null;
  const delta = Number(after) - Number(before);
  // Nonuniform remapping/column changes replace one row instead of guessing.
  return shiftReviewHtml(previous, delta) === next ? delta : null;
}
function rowDeltas(previous: string, next: string, split: boolean): number[] | null {
  if (previous === next) return split ? [0, 0] : [0];
  if (blockKey(previous) !== blockKey(next)) return null;
  const cells = (row: string) => split ? splitPreviewBlocks(inner(row)).map((b) => b.html) : [row];
  const before = cells(previous); const after = cells(next);
  if (before.length !== (split ? 2 : 1) || after.length !== before.length) return null;
  const deltas = before.map((cell, index) => deltaFor(cell, after[index]));
  return deltas.some((delta) => delta === null) ? null : deltas as number[];
}
type Match = { before: number; after: number; deltas: number[] };
/** Ordered content matches, bounded by O(rows log rows + HTML bytes), not N². */
function matchingRows(previous: string[], next: string[], split: boolean): Match[] {
  const byKey = new Map<string, { indices: number[]; cursor: number }>();
  previous.forEach((row, index) => {
    const key = blockKey(row); const entry = byKey.get(key) ?? { indices: [], cursor: 0 };
    entry.indices.push(index); byKey.set(key, entry);
  });
  const candidates: Match[] = [];
  next.forEach((row, after) => {
    const entry = byKey.get(blockKey(row));
    if (!entry) return;
    while (entry.cursor < entry.indices.length) {
      const before = entry.indices[entry.cursor++];
      const deltas = rowDeltas(previous[before], row, split);
      if (deltas) { candidates.push({ before, after, deltas }); break; }
    }
  });
  const tails: number[] = []; const parent = new Int32Array(candidates.length).fill(-1);
  candidates.forEach((candidate, index) => {
    let low = 0; let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (candidates[tails[middle]].before < candidate.before) low = middle + 1; else high = middle;
    }
    if (low) parent[index] = tails[low - 1];
    tails[low] = index;
  });
  const matches: Match[] = [];
  for (let index = tails.at(-1) ?? -1; index >= 0; index = parent[index]) matches.push(candidates[index]);
  return matches.reverse();
}
function patchTree(previous: string[], next: string[], split: boolean): ReviewTreePatch {
  const splices: ReviewRowSplice[] = []; const shifts: ReviewRowShift[] = [];
  let before = 0; let after = 0;
  for (const match of [...matchingRows(previous, next, split),
    { before: previous.length, after: next.length, deltas: [] }]) {
    if (match.before > before || match.after > after) {
      splices.push({ from: before, removeCount: match.before - before, rows: next.slice(after, match.after) });
    }
    if (match.deltas.some((delta) => delta !== 0)) {
      const last = shifts.at(-1);
      if (last && last.from + last.count === match.before
        && last.deltas.every((delta, index) => delta === match.deltas[index])) last.count++;
      else shifts.push({ from: match.before, count: 1, deltas: match.deltas });
    }
    before = match.before + 1; after = match.after + 1;
  }
  return { baseLength: previous.length, length: next.length, splices, shifts };
}
export function diffReviewRows(previous: ReviewRows, next: ReviewRows,
  baseRevision: number, revision: number): ReviewRowsPatch {
  return { version: 1, baseRevision, revision,
    unified: patchTree(previous.unified, next.unified, false),
    split: patchTree(previous.split, next.split, true) };
}
