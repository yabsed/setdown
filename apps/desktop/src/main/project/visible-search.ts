import { Parser } from 'htmlparser2';

export type VisibleSearchMatch = {
  line: number;
  column: number;
  lineOccurrence: number;
  ordinal: number;
  preview: string;
};

type SourceSpan = { start: number; end: number };
type TextNode = { start: number; end: number; source: SourceSpan | null };
export type VisibleTextIndex = { text: string; nodes: TextNode[] };

type ElementState = { excluded: boolean; source: SourceSpan | null };

const excludedElement = (name: string, attributes: Record<string, string>) =>
  ['script', 'style', 'noscript', 'annotation'].includes(name)
  || 'hidden' in attributes
  || attributes.class?.split(/\s+/).some((value) =>
    ['katex-mathml', 'MathJax_Preview', 'mjx-assistive-mml'].includes(value)) === true
  || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/i
    .test(attributes.style ?? '');

function sourceSpan(attributes: Record<string, string>): SourceSpan | null {
  const start = Number(attributes['data-source-start']?.split(':')[0]
    ?? attributes['data-source-lines']?.split('-')[0]
    ?? attributes['data-source-line']);
  const end = Number(attributes['data-source-end']?.split(':')[0]
    ?? attributes['data-source-lines']?.split('-')[1]
    ?? start);
  return Number.isFinite(start) && start > 0
    ? { start, end: Number.isFinite(end) && end >= start ? end : start } : null;
}

/** Builds the same concatenated text stream used by the preview's find implementation. */
export function indexVisibleHtml(html: string): VisibleTextIndex {
  const stack: ElementState[] = [];
  const nodes: TextNode[] = [];
  let text = '';
  const parser = new Parser({
    onopentag(name, attributes) {
      const parent = stack.at(-1);
      stack.push({
        excluded: !!parent?.excluded || excludedElement(name, attributes),
        source: sourceSpan(attributes) ?? parent?.source ?? null,
      });
    },
    ontext(value) {
      const state = stack.at(-1);
      if (state?.excluded) return;
      const start = text.length;
      text += value;
      nodes.push({ start, end: text.length, source: state?.source ?? null });
    },
    onclosetag() {
      stack.pop();
    },
  }, { decodeEntities: true });
  parser.end(html);
  return { text, nodes };
}

export function searchVisibleText(
  index: VisibleTextIndex,
  rawQuery: string,
  limit: number,
): VisibleSearchMatch[] {
  const query = rawQuery.toLocaleLowerCase();
  if (!query || limit <= 0) return [];
  const folded = index.text.toLocaleLowerCase();
  const matches: Array<VisibleSearchMatch & { source: SourceSpan | null }> = [];
  let nodeIndex = 0;
  for (let found = folded.indexOf(query); found >= 0 && matches.length < limit;
    found = folded.indexOf(query, found + query.length)) {
    while (nodeIndex + 1 < index.nodes.length && index.nodes[nodeIndex].end <= found) nodeIndex += 1;
    const node = index.nodes[nodeIndex];
    const source = node?.start <= found && node.end > found ? node.source : null;
    const line = source?.start ?? 1;
    const lineOccurrence = matches.filter((match) =>
      match.source && match.source.start <= line && match.source.end >= line).length;
    const start = Math.max(0, found - 60);
    const end = Math.min(index.text.length, found + query.length + 120);
    matches.push({
      line,
      column: Math.max(1, found - (node?.start ?? found) + 1),
      lineOccurrence,
      ordinal: matches.length,
      preview: `${start ? '…' : ''}${index.text.slice(start, end)}${end < index.text.length ? '…' : ''}`,
      source,
    });
  }
  return matches.map(({ source: _source, ...match }) => match);
}
