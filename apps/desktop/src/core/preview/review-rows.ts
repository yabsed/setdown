/** Both responsive representations, before serialization into a full page. */
export type ReviewRows = { unified: string[]; split: string[] };

const START = '<div class="setdown-rendered-diff-unified">';
const BETWEEN = '</div>\n<div class="setdown-rendered-diff-split" aria-label="Side-by-side rendered comparison">';
const END = '</div>';

export function reviewRowsHtmlLength(rows: ReviewRows): number {
  return START.length + BETWEEN.length + END.length
    + rows.unified.reduce((sum, row) => sum + row.length, 0) + Math.max(0, rows.unified.length - 1)
    + rows.split.reduce((sum, row) => sum + row.length, 0) + Math.max(0, rows.split.length - 1);
}

export function serializeReviewRows(rows: ReviewRows): string {
  return `${START}${rows.unified.join('\n')}${BETWEEN}${rows.split.join('\n')}${END}`;
}
