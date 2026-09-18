import { splitPreviewBlocks, type PreviewBlock } from './preview-blocks';

type LocatedBlock = PreviewBlock & { index: number; start: number; end: number };
type RenderedDiffHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number };

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

/** Merges two sanitized preview fragments into one document with changed blocks only duplicated. */
export function mergeRenderedDiff(
  originalHtml: string,
  modifiedHtml: string,
  hunks: RenderedDiffHunk[],
): string {
  const original = locate(splitPreviewBlocks(originalHtml));
  const modified = locate(splitPreviewBlocks(modifiedHtml));
  const added = new Set<number>();
  const removedAt = new Map<number, number[]>();

  for (const hunk of hunks) {
    const oldIndices = overlapping(original, hunk.oldStart, hunk.oldLines);
    const newIndices = overlapping(modified, hunk.newStart, hunk.newLines);
    for (const index of newIndices) added.add(index);
    const at = newIndices[0] ?? insertionIndex(modified, hunk.newStart);
    const existing = removedAt.get(at) ?? [];
    for (const index of oldIndices) if (!existing.includes(index)) existing.push(index);
    if (existing.length) removedAt.set(at, existing);
  }

  const output: string[] = [];
  const emittedRemoved = new Set<number>();
  for (let index = 0; index <= modified.length; index += 1) {
    for (const oldIndex of removedAt.get(index) ?? []) {
      if (emittedRemoved.has(oldIndex)) continue;
      emittedRemoved.add(oldIndex);
      output.push(marked(original[oldIndex].html, 'removed'));
    }
    if (index < modified.length) {
      output.push(added.has(index) ? marked(modified[index].html, 'added') : modified[index].html);
    }
  }
  return output.join('\n');
}

export const RENDERED_DIFF_STYLES = `<style id="setdown-rendered-diff-styles">
  .setdown-diff-added, .setdown-diff-removed {
    position: relative;
    margin-left: -12px !important;
    margin-right: -12px !important;
    padding-left: 12px !important;
    padding-right: 12px !important;
    border-left: 3px solid transparent;
    border-radius: 2px;
  }
  .setdown-diff-added {
    border-left-color: #3d9b58;
    background: rgba(55, 166, 83, .15) !important;
  }
  .setdown-diff-removed {
    color: #d05d57 !important;
    border-left-color: #d05d57;
    background: rgba(208, 93, 87, .10) !important;
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
  .setdown-diff-removed * { color: inherit !important; }
</style>`;
