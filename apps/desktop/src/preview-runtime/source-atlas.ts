import {
  resolveBandScrollTop, resolveViewerPoint,
  type BandLine, type SourceCandidate, type ViewportAnchor,
} from '../core/preview/viewport-anchor';
import type { ReviewSourceSide } from '../core/preview/review-viewport';
import { ReviewPositionProof } from '../core/preview/review-position-proof';

export const ANCHOR_SELECTOR = '[data-source-line], [data-source-start], [data-source-lines]';
export const PREVIEW_SELECTOR = '.markdown-preview[data-for="preview"]';
type Entry = SourceCandidate & { element: Element; side?: ReviewSourceSide };
type ReviewAnchor = ViewportAnchor & { sourceSide?: ReviewSourceSide; blockOffset?: number };
type AtlasOptions = { lineCount: () => number; documentIsBlank: () => boolean };

function sourceSideOf(element: Element | null): ReviewSourceSide | undefined {
  if (element?.closest('.setdown-rendered-diff-before')) return 'before';
  if (element?.closest('.setdown-rendered-diff-after')) return 'after';
  const cell = element?.closest('.setdown-rendered-diff-unified .setdown-diff-cell');
  return cell ? cell.getAttribute('data-change') === 'removed' ? 'before' : 'after' : undefined;
}

export const sourceLinePair = (value: string | null): [number, number | undefined] | null => {
  const match = value && /^\s*(\d+)\s*(?:[-:]\s*(\d+))?\s*$/.exec(value);
  if (!match) return null;
  const first = Number(match[1]);
  return first >= 1 ? [first, match[2] === undefined ? undefined : Number(match[2])] : null;
};

function candidate(element: Element, order: number): Entry | null {
  const start = sourceLinePair(element.getAttribute('data-source-start'));
  const range = sourceLinePair(element.getAttribute('data-source-lines'));
  const end = sourceLinePair(element.getAttribute('data-source-end'));
  const single = Number(element.getAttribute('data-source-line'));
  const line = start?.[0] ?? range?.[0] ?? (single >= 1 ? single : Number.NaN);
  if (!Number.isFinite(line)) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const top = document.documentElement.scrollTop || 0;
  const left = document.documentElement.scrollLeft || 0;
  return { line, column: start?.[1], endLine: end?.[0] ?? range?.[1] ?? range?.[0],
    order, element, side: sourceSideOf(element),
    rect: { top: rect.top + top, bottom: rect.bottom + top, left: rect.left + left, right: rect.right + left } };
}

const containing = (entries: Entry[], line: number) => entries.find((entry) =>
  entry.line <= line && (entry.endLine ?? entry.line) >= line);

export class SourceAtlas {
  private entries: Entry[] = [];
  private stale = true;
  private reviewSide: ReviewSourceSide = 'after';
  private width = -1;
  private height = -1;
  private before: Entry[] = [];
  private after: Entry[] = [];
  private beforeLineCount = 1;
  private layoutGeneration = 0;
  private readonly positionProof = new ReviewPositionProof();

  constructor(private readonly options: AtlasOptions) {}
  invalidate() {
    this.stale = true;
    this.layoutGeneration += 1;
    this.positionProof.invalidate();
  }

  private positionState(revision: number) {
    return { revision, layoutGeneration: this.layoutGeneration, width: innerWidth, height: innerHeight,
      scale: devicePixelRatio, scrollTop: document.documentElement.scrollTop || 0,
      scrollLeft: document.documentElement.scrollLeft || 0 };
  }

  private read() {
    // Rectangles are document-relative: scrolling does not invalidate them.
    // Content, fonts, resources and layout changes are observed by the runtime.
    if (!this.stale && this.width === innerWidth && this.height === innerHeight) return this.entries;
    const elements = document.querySelector(PREVIEW_SELECTOR)?.querySelectorAll(ANCHOR_SELECTOR) ?? [];
    this.entries = Array.from(elements, candidate).filter((entry): entry is Entry => !!entry);
    this.before = this.entries.filter((entry) => !entry.side || entry.side === 'before');
    this.after = this.entries.filter((entry) => !entry.side || entry.side === 'after');
    this.beforeLineCount = this.before.reduce((last, entry) => Math.max(last, entry.endLine ?? entry.line), 1);
    this.width = innerWidth;
    this.height = innerHeight;
    this.stale = false;
    return this.entries;
  }

  private scoped(side?: ReviewSourceSide): Entry[] {
    const entries = this.read();
    return side === 'before' ? this.before : side === 'after' ? this.after : entries;
  }
  lineCount(side?: ReviewSourceSide): number {
    if (side !== 'before') return this.options.lineCount();
    this.read();
    return this.beforeLineCount;
  }
  readBand(value: unknown, side?: ReviewSourceSide): BandLine[] {
    if (!Array.isArray(value)) return [];
    const count = this.lineCount(side);
    return value.flatMap((item) => {
      const sourceLine = Number((item as BandLine)?.sourceLine);
      const yRatio = Number((item as BandLine)?.yRatio);
      return Number.isFinite(sourceLine) && sourceLine >= 1 && Number.isFinite(yRatio)
        ? [{ sourceLine: Math.min(count, Math.round(sourceLine)), yRatio: Math.min(1, Math.max(0, yRatio)) }] : [];
    });
  }

  position(sourceLine: number, topRatio: number, band: BandLine[] = [],
    sourceSide?: ReviewSourceSide, blockOffset = 0, revision?: number) {
    const positionRequest = sourceSide ? { sourceSide, sourceLine, topRatio, band, blockOffset } : null;
    // The current page, not the shell's delayed ACK record, owns this decision.
    // A warm hit performs no anchor scan, weighted solve, or scroll write.
    const stableFonts = document.fonts?.status !== 'loading';
    if (positionRequest && revision !== undefined && !this.stale && stableFonts
      && this.positionProof.matches(positionRequest, this.positionState(revision))) return;
    this.positionProof.invalidate();
    // Preserve ordinary Markdown's behavior; Git primes a side-aware cache.
    if (!sourceSide) this.invalidate();
    if (sourceSide) this.reviewSide = sourceSide;
    const entries = this.scoped(sourceSide);
    const height = innerHeight || 1;
    const samples = band.flatMap(({ sourceLine: line, yRatio }) => {
      const entry = containing(entries, line);
      return entry ? [{ renderedTop: entry.rect.top,
        renderedHeight: entry.rect.bottom - entry.rect.top, editorRatio: yRatio }] : [];
    });
    const nearest = containing(entries, sourceLine) ?? entries.reduce<Entry | undefined>((best, entry) =>
      !best || Math.abs(entry.line - sourceLine) < Math.abs(best.line - sourceLine) ? entry : best, undefined);
    const documentHeight = Math.max(document.documentElement.scrollHeight || 0, height);
    const count = this.lineCount(sourceSide);
    const sourceRatio = count <= 1 ? 0 : (sourceLine - 1) / (count - 1);
    const withinBlock = nearest && Number.isFinite(blockOffset)
      ? (nearest.rect.bottom - nearest.rect.top) * Math.min(1, Math.max(0, blockOffset)) : 0;
    const fallbackTop = (nearest?.rect.top ?? documentHeight * sourceRatio) + withinBlock
      - height * Math.min(1, Math.max(0, topRatio));
    const target = resolveBandScrollTop(samples, height) ?? fallbackTop;
    const scrollTop = Math.min(Math.max(0, documentHeight - height), Math.max(0, target));
    document.documentElement.scrollTop = scrollTop;
    document.body.scrollTop = scrollTop;
    // Empty/unsized first-load fallbacks must NEVER become a prepared proof.
    if (positionRequest && revision !== undefined && entries.length && stableFonts) {
      this.positionProof.remember(positionRequest, this.positionState(revision));
    }
  }

  private fromElement(element: Element, order: number): SourceCandidate | null {
    const entry = candidate(element, order);
    if (!entry) return null;
    const top = document.documentElement.scrollTop || 0;
    const left = document.documentElement.scrollLeft || 0;
    return { line: entry.line, endLine: entry.endLine, column: entry.column, order,
      rect: { top: entry.rect.top - top, bottom: entry.rect.bottom - top,
        left: entry.rect.left - left, right: entry.rect.right - left } };
  }

  anchorAtPoint(clientX: number, clientY: number, target: Element | null, path: EventTarget[]): ReviewAnchor {
    const review = !!document.querySelector('.setdown-rendered-diff-split, .setdown-rendered-diff-unified');
    const sourceSide = review ? sourceSideOf(target) ?? this.reviewSide : undefined;
    if (sourceSide) this.reviewSide = sourceSide;
    const accepts = (element: Element) => !sourceSide || !sourceSideOf(element) || sourceSideOf(element) === sourceSide;
    const nodes = path.filter((node): node is Element => node instanceof Element);
    if (!nodes.length && target) {
      for (let element: Element | null = target; element; element = element.parentElement) nodes.push(element);
    }
    const ancestors = nodes.flatMap((element, index) => {
      const value = element.matches(ANCHOR_SELECTOR) && accepts(element) ? this.fromElement(element, index) : null;
      return value ? [value] : [];
    });
    const descendants = target ? Array.from(target.querySelectorAll(ANCHOR_SELECTOR)).flatMap((element, index) => {
      const value = accepts(element) ? this.fromElement(element, index) : null;
      return value ? [value] : [];
    }) : [];
    const top = document.documentElement.scrollTop || 0;
    const left = document.documentElement.scrollLeft || 0;
    const candidates = this.scoped(sourceSide).map((entry) => ({
      line: entry.line, endLine: entry.endLine, column: entry.column, order: entry.order,
      rect: { top: entry.rect.top - top, bottom: entry.rect.bottom - top,
        left: entry.rect.left - left, right: entry.rect.right - left },
    }));
    const documentHeight = Math.max(document.documentElement.scrollHeight || 0, innerHeight || 1);
    const anchor = resolveViewerPoint({ point: { x: clientX, y: clientY }, viewportHeight: innerHeight || 1,
      lineCount: this.lineCount(sourceSide), ancestors, descendants, candidates,
      scrollRatio: (top + clientY) / documentHeight, documentIsBlank: this.options.documentIsBlank() });
    return sourceSide ? { ...anchor, sourceSide } : anchor;
  }

  viewportAnchorAt(yRatio: number) {
    const clientY = (innerHeight || 1) * yRatio;
    const pane = Array.from(document.querySelectorAll(`.setdown-rendered-diff-${this.reviewSide}`))
      .find((element) => element.getBoundingClientRect().width > 0);
    const rect = pane?.getBoundingClientRect();
    const clientX = rect ? rect.left + rect.width / 2 : (innerWidth || 1) / 2;
    const target = document.elementFromPoint(clientX, clientY);
    const path: EventTarget[] = [];
    for (let node: Element | null = target; node; node = node.parentElement) path.push(node);
    return this.anchorAtPoint(clientX, clientY, target, path);
  }

  bookmarkAt(yRatio: number): ReviewAnchor {
    if (!document.querySelector('.setdown-rendered-diff-split, .setdown-rendered-diff-unified')) this.invalidate();
    const anchor = this.viewportAnchorAt(yRatio);
    if (!anchor.sourceSide) return anchor;
    const entry = containing(this.scoped(anchor.sourceSide), anchor.sourceLine);
    if (!entry) return anchor;
    const point = (document.documentElement.scrollTop || 0) + (innerHeight || 1) * yRatio;
    const height = Math.max(1, entry.rect.bottom - entry.rect.top);
    if (point >= entry.rect.top && point <= entry.rect.bottom) return { ...anchor, blockOffset: (point - entry.rect.top) / height };
    const blockRatio = (entry.rect.top - (document.documentElement.scrollTop || 0)) / (innerHeight || 1);
    return { ...anchor, yRatio: Math.min(1, Math.max(0, blockRatio)), blockOffset: 0 };
  }
}

export function applyBaseHref(value: unknown) {
  if (typeof value === 'string' && value.startsWith('marktex-resource://')) document.querySelector('base')?.setAttribute('href', value);
}

export function shiftSourceLines(root: Element, delta: number) {
  const shiftPair = (value: string | null, separator: string) => {
    if (!value) return null;
    const parts = value.split(separator);
    const first = Number(parts[0]);
    if (!Number.isFinite(first)) return null;
    parts[0] = String(Math.max(1, first + delta));
    return parts.join(separator);
  };
  const apply = (element: Element) => {
    const line = Number(element.getAttribute('data-source-line'));
    if (Number.isFinite(line)) element.setAttribute('data-source-line', String(Math.max(1, line + delta)));
    const lines = element.getAttribute('data-source-lines')?.split('-').map(Number);
    if (lines?.every(Number.isFinite)) element.setAttribute('data-source-lines', `${Math.max(1, lines[0] + delta)}-${Math.max(1, lines[1] + delta)}`);
    for (const name of ['data-source-start', 'data-source-end']) {
      const shifted = shiftPair(element.getAttribute(name), ':');
      if (shifted !== null) element.setAttribute(name, shifted);
    }
  };
  if (root.matches(ANCHOR_SELECTOR)) apply(root);
  root.querySelectorAll(ANCHOR_SELECTOR).forEach(apply);
}

export function shiftSourceLinesHtml(html: string, delta: number) {
  if (!delta) return html;
  return html.replace(/\b(data-source-(?:line|lines|start|end))="(\d+)(?:([:-])(\d+))?"/g,
    (_whole, name: string, first: string, separator?: string, second?: string) => {
      const shiftedFirst = Math.max(1, Number(first) + delta);
      if (!separator || second === undefined) return `${name}="${shiftedFirst}"`;
      const shiftedSecond = separator === '-' ? Math.max(1, Number(second) + delta) : Number(second);
      return `${name}="${shiftedFirst}${separator}${shiftedSecond}"`;
    });
}
