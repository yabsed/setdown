import {
  resolveBandScrollTop,
  resolveViewerPoint,
  type BandLine,
  type SourceCandidate,
  type ViewportAnchor,
} from '../shared/viewport-anchor';

export const ANCHOR_SELECTOR = '[data-source-line], [data-source-start], [data-source-lines]';
export const PREVIEW_SELECTOR = '.markdown-preview[data-for="preview"]';

type Entry = SourceCandidate & { element: Element };
type AtlasOptions = { lineCount: () => number; documentIsBlank: () => boolean };

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
  return {
    line,
    column: start?.[1],
    endLine: end?.[0] ?? range?.[1] ?? range?.[0],
    order,
    element,
    rect: {
      top: rect.top + top,
      bottom: rect.bottom + top,
      left: rect.left + left,
      right: rect.right + left,
    },
  };
}

const containing = (entries: Entry[], line: number) => entries.find((entry) => (
  entry.line <= line && (entry.endLine ?? entry.line) >= line
));

export class SourceAtlas {
  private entries: Entry[] = [];
  private stale = true;

  constructor(private readonly options: AtlasOptions) {}

  invalidate() {
    this.stale = true;
  }

  private read() {
    if (!this.stale) return this.entries;
    const elements = document.querySelector(PREVIEW_SELECTOR)?.querySelectorAll(ANCHOR_SELECTOR) ?? [];
    this.entries = Array.from(elements, candidate).filter((entry): entry is Entry => !!entry);
    this.stale = false;
    return this.entries;
  }

  readBand(value: unknown): BandLine[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const sourceLine = Number((item as BandLine)?.sourceLine);
      const yRatio = Number((item as BandLine)?.yRatio);
      return Number.isFinite(sourceLine) && sourceLine >= 1 && Number.isFinite(yRatio)
        ? [{
          sourceLine: Math.min(this.options.lineCount(), Math.round(sourceLine)),
          yRatio: Math.min(1, Math.max(0, yRatio)),
        }]
        : [];
    });
  }

  position(sourceLine: number, topRatio: number, band: BandLine[] = []) {
    this.invalidate();
    const entries = this.read();
    const height = innerHeight || 1;
    const samples = band.flatMap(({ sourceLine: line, yRatio }) => {
      const entry = containing(entries, line);
      return entry ? [{
        renderedTop: entry.rect.top,
        renderedHeight: entry.rect.bottom - entry.rect.top,
        editorRatio: yRatio,
      }] : [];
    });
    const nearest = containing(entries, sourceLine) ?? entries.reduce<Entry | undefined>(
      (best, entry) => !best || Math.abs(entry.line - sourceLine) < Math.abs(best.line - sourceLine)
        ? entry
        : best,
      undefined,
    );
    const documentHeight = Math.max(document.documentElement.scrollHeight || 0, height);
    const sourceRatio = this.options.lineCount() <= 1
      ? 0
      : (sourceLine - 1) / (this.options.lineCount() - 1);
    const fallbackTop = (nearest?.rect.top ?? documentHeight * sourceRatio)
      - height * Math.min(1, Math.max(0, topRatio));
    const target = resolveBandScrollTop(samples, height) ?? fallbackTop;
    const scrollTop = Math.min(
      Math.max(0, documentHeight - height),
      Math.max(0, target),
    );
    document.documentElement.scrollTop = scrollTop;
    document.body.scrollTop = scrollTop;
  }

  private fromElement(element: Element, order: number): SourceCandidate | null {
    const entry = candidate(element, order);
    if (!entry) return null;
    const top = document.documentElement.scrollTop || 0;
    const left = document.documentElement.scrollLeft || 0;
    return {
      line: entry.line,
      endLine: entry.endLine,
      column: entry.column,
      order,
      rect: {
        top: entry.rect.top - top,
        bottom: entry.rect.bottom - top,
        left: entry.rect.left - left,
        right: entry.rect.right - left,
      },
    };
  }

  anchorAtPoint(
    clientX: number,
    clientY: number,
    target: Element | null,
    path: EventTarget[],
  ): ViewportAnchor {
    const nodes = path.filter((node): node is Element => node instanceof Element);
    if (!nodes.length && target) {
      for (let element: Element | null = target; element; element = element.parentElement) {
        nodes.push(element);
      }
    }
    const ancestors = nodes.flatMap((element, index) => {
      const value = element.matches(ANCHOR_SELECTOR) ? this.fromElement(element, index) : null;
      return value ? [value] : [];
    });
    const descendants = target
      ? Array.from(target.querySelectorAll(ANCHOR_SELECTOR)).flatMap((element, index) => {
        const value = this.fromElement(element, index);
        return value ? [value] : [];
      })
      : [];
    const top = document.documentElement.scrollTop || 0;
    const left = document.documentElement.scrollLeft || 0;
    const candidates = this.read().map((entry) => ({
      line: entry.line,
      endLine: entry.endLine,
      column: entry.column,
      order: entry.order,
      rect: {
        top: entry.rect.top - top,
        bottom: entry.rect.bottom - top,
        left: entry.rect.left - left,
        right: entry.rect.right - left,
      },
    }));
    const documentHeight = Math.max(document.documentElement.scrollHeight || 0, innerHeight || 1);
    return resolveViewerPoint({
      point: { x: clientX, y: clientY },
      viewportHeight: innerHeight || 1,
      lineCount: this.options.lineCount(),
      ancestors,
      descendants,
      candidates,
      scrollRatio: (top + clientY) / documentHeight,
      documentIsBlank: this.options.documentIsBlank(),
    });
  }

  viewportAnchorAt(yRatio: number) {
    const clientY = (innerHeight || 1) * yRatio;
    const clientX = (innerWidth || 1) / 2;
    const target = document.elementFromPoint(clientX, clientY);
    const path: EventTarget[] = [];
    for (let node: Element | null = target; node; node = node.parentElement) path.push(node);
    return this.anchorAtPoint(clientX, clientY, target, path);
  }
}

export function applyBaseHref(value: unknown) {
  if (typeof value === 'string' && value.startsWith('marktex-resource://')) {
    document.querySelector('base')?.setAttribute('href', value);
  }
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
    if (lines?.every(Number.isFinite)) {
      element.setAttribute('data-source-lines', `${Math.max(1, lines[0] + delta)}-${Math.max(1, lines[1] + delta)}`);
    }
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
  return html.replace(
    /\b(data-source-(?:line|lines|start|end))="(\d+)(?:([:-])(\d+))?"/g,
    (_whole, name: string, first: string, separator?: string, second?: string) => {
      const shiftedFirst = Math.max(1, Number(first) + delta);
      if (!separator || second === undefined) return `${name}="${shiftedFirst}"`;
      const shiftedSecond = separator === '-' ? Math.max(1, Number(second) + delta) : Number(second);
      return `${name}="${shiftedFirst}${separator}${shiftedSecond}"`;
    },
  );
}
