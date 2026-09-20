/** Crossnote 0.9.35's generateHTMLTemplateForPreview calls parseMD with these
 * exact options before escaping HTML into a full page. Reusable review pages
 * need that SAME enhanced/sanitized fragment, not a new shell or escaped copy.
 * Keep the worker's read-only filesystem, math wrappers and serial queue.
 */
export const REVIEW_PARSE_OPTIONS = {
  isForPreview: true, useRelativeFilePath: false, hideFrontMatter: false,
} as const;

export async function renderReviewFragment(engine: {
  parseMD(text: string, options: typeof REVIEW_PARSE_OPTIONS & { vscodePreviewPanel: never }): Promise<{ html: string }>;
}, text: string): Promise<string> {
  const parsed = await engine.parseMD(text.length ? text : '\n', {
    ...REVIEW_PARSE_OPTIONS, vscodePreviewPanel: {} as never,
  });
  return parsed.html;
}
