/** A Readability snapshot of a live web page, shown in place of the page while
 * reader mode is active. The live page is never navigated or destroyed; this
 * is plain serializable data extracted from its DOM. */
export type ReaderArticle = {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  /** Article HTML. Untrusted page content: sanitize before rendering. Blocks
   * carry `data-setdown-block` ordinals assigned in live document order. */
  content: string;
};

/** The shared position currency between a web page and its reader snapshot,
 * mirroring the Markdown ViewportAnchor: `ordinal` identifies one element in
 * live document order (stamped as `data-setdown-block` in the article clone),
 * and `yRatio` keeps that element at the same viewport height across the
 * transition. `text`/`scrollRatio` are fallbacks when the live DOM moved. */
export type ReaderAnchor = {
  ordinal: number;
  yRatio: number;
  text: string;
  scrollRatio: number;
};

export type ReaderSnapshot = { article: ReaderArticle; anchor: ReaderAnchor };

const MAX_CONTENT = 5_000_000;
const MAX_TEXT = 4_000;

function text(value: unknown, limit: number): string | null {
  return typeof value === 'string' ? value.slice(0, limit) : null;
}

function ratio(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Validate an anchor arriving over IPC. Returns null for malformed input. */
export function readReaderAnchor(value: unknown): ReaderAnchor | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.ordinal !== 'number' || !Number.isInteger(candidate.ordinal) || candidate.ordinal < 0) return null;
  return {
    ordinal: candidate.ordinal,
    yRatio: ratio(candidate.yRatio),
    text: text(candidate.text, 200) ?? '',
    scrollRatio: ratio(candidate.scrollRatio),
  };
}

/** Validate extraction output produced inside an untrusted page. Anything
 * malformed (or implausibly large) means the page is not readerable here. */
export function readReaderSnapshot(value: unknown, expectedUrl: string): ReaderSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const content = text(candidate.content, MAX_CONTENT + 1);
  const title = text(candidate.title, MAX_TEXT);
  if (!content || content.length > MAX_CONTENT || title === null) return null;
  const anchor = readReaderAnchor(candidate.anchor);
  if (!anchor) return null;
  return {
    article: {
      url: expectedUrl,
      title,
      byline: text(candidate.byline, MAX_TEXT),
      siteName: text(candidate.siteName, MAX_TEXT),
      content,
    },
    anchor,
  };
}
