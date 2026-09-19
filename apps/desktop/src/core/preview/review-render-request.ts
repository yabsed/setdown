/** Render identity is independent of tab activation and duplicate Esc requests. */
export type ReviewRenderInput = {
  originalText: string | null;
  modifiedText: string | null;
  filePath: string;
  staged: boolean;
  originalLabel: string;
};

export function sameReviewBaseline(a: ReviewRenderInput, b: ReviewRenderInput): boolean {
  return a.filePath === b.filePath && a.staged === b.staged
    && a.originalLabel === b.originalLabel && a.originalText === b.originalText;
}

export function sameReviewContent(a: ReviewRenderInput, b: ReviewRenderInput): boolean {
  return sameReviewBaseline(a, b) && a.modifiedText === b.modifiedText;
}
