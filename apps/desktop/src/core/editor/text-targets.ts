import MarkdownIt from 'markdown-it';
export type TextTarget = 'word' | 'chunk' | 'quote' | 'paragraph' | 'sentence' | 'section' | 'fence' | 'list-item' | 'link-label' | 'link-destination' | 'table-cell';
export type TextSpan = { start: number; end: number };
type Token = { type: string; tag: string; map: [number, number] | null; markup: string };
const markdown = new MarkdownIt({ html: false });
const escaped = (text: string, at: number) => { let count = 0; while (at > 0 && text[--at] === '\\') count++; return count % 2 === 1; };
const around = (text: string, span: TextSpan): TextSpan => {
  let end = span.end; while (end < text.length && /[ \t]/.test(text[end])) end++;
  if (end > span.end) return { ...span, end };
  let start = span.start; while (start > 0 && /[ \t]/.test(text[start - 1])) start--;
  return { start, end };
};
export function textTarget(text: string, offset: number, kind: TextTarget, outer = false): TextSpan | null {
  offset = Math.max(0, Math.min(text.length, offset));
  const startLine = text.lastIndexOf('\n', offset - 1) + 1;
  let endLine = text.indexOf('\n', offset); if (endLine < 0) endLine = text.length;
  if (text[endLine - 1] === '\r') endLine--;
  if (kind === 'word' || kind === 'chunk') {
    const pattern = kind === 'chunk' ? /\S+/gu : /[\p{L}\p{N}\p{M}_]+/gu;
    for (const match of text.slice(startLine, endLine).matchAll(pattern)) {
      const start = startLine + match.index!, end = start + match[0].length;
      if (start <= offset && offset <= end) return outer ? around(text, { start, end }) : { start, end };
    }
    return null;
  }
  if (kind === 'quote') {
    const candidates: TextSpan[] = [];
    for (const quote of ['"', "'", '`']) {
      let open = -1;
      for (let i = startLine; i < endLine; i++) if (text[i] === quote && !escaped(text, i)) {
        if (open < 0) open = i;
        else { if (open <= offset && offset <= i) candidates.push({ start: open, end: i + 1 }); open = -1; }
      }
    }
    const found = candidates.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    return !found ? null : outer ? found : { start: found.start + 1, end: found.end - 1 };
  }
  if (kind === 'sentence') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    for (const segment of segmenter.segment(text)) if (segment.index <= offset && offset < segment.index + segment.segment.length) {
      const span = { start: segment.index, end: segment.index + segment.segment.trimEnd().length };
      return outer ? { ...span, end: segment.index + segment.segment.length } : span;
    }
    return null;
  }
  const lines = text.split('\n'), offsets = [0];
  for (const line of lines) offsets.push(offsets.at(-1)! + line.length + 1);
  const line = lines.findIndex((_, index) => offsets[index + 1] > offset);
  const lineSpan = (a: number, b: number): TextSpan => ({ start: offsets[a] ?? text.length, end: Math.min(text.length, offsets[b] ?? text.length) });
  if (kind === 'paragraph') {
    if (!lines[line]?.trim()) return null;
    let a = line, b = line + 1;
    while (a > 0 && lines[a - 1].trim()) a--;
    while (b < lines.length && lines[b].trim()) b++;
    if (outer) { if (b < lines.length) while (b < lines.length && !lines[b].trim()) b++; else while (a > 0 && !lines[a - 1].trim()) a--; }
    return lineSpan(a, b);
  }
  const tokens = markdown.parse(text, {}) as Token[];
  const blocked = tokens.find(token => ['fence', 'code_block'].includes(token.type) && token.map && token.map[0] <= line && line < token.map[1]);
  if (kind === 'fence') return blocked?.map ? lineSpan(blocked.map[0] + (outer || blocked.type === 'code_block' ? 0 : 1),
    blocked.map[1] - (!outer && blocked.type === 'fence' && lines[blocked.map[1] - 1]?.trim().startsWith(blocked.markup) ? 1 : 0)) : null;
  if (kind === 'section') {
    const headings = tokens.filter(token => token.type === 'heading_open' && token.map);
    const heading = [...headings].reverse().find(token => token.map![0] <= line); if (!heading?.map) return null;
    const level = Number(heading.tag.slice(1));
    const next = headings.find(token => token.map![0] > heading.map![0] && Number(token.tag.slice(1)) <= level);
    return lineSpan(outer ? heading.map[0] : heading.map[1], next?.map?.[0] ?? lines.length);
  }
  if (blocked) return null;
  if (kind === 'list-item') {
    const item = tokens.filter(token => token.type === 'list_item_open' && token.map && token.map[0] <= line && line < token.map[1])
      .sort((a, b) => (a.map![1] - a.map![0]) - (b.map![1] - b.map![0]))[0];
    return item?.map ? lineSpan(item.map[0], item.map[1]) : null;
  }
  if (kind === 'table-cell') {
    const table = tokens.find(token => token.type === 'table_open' && token.map && token.map[0] <= line && line < token.map[1]);
    if (!table) return null;
    const boundaries = [startLine - 1]; let code = false;
    for (let i = startLine; i < endLine; i++) {
      if (text[i] === '`' && !escaped(text, i)) code = !code;
      if (!code && text[i] === '|' && !escaped(text, i)) boundaries.push(i);
    }
    boundaries.push(endLine);
    for (let i = 1; i < boundaries.length; i++) if (boundaries[i - 1] < offset && offset <= boundaries[i]) {
      let start = boundaries[i - 1] + 1, end = boundaries[i];
      if (!outer) { while (start < end && /[ \t]/.test(text[start])) start++; while (end > start && /[ \t]/.test(text[end - 1])) end--; }
      return { start, end };
    }
    return null;
  }
  // Balanced inline links. Escaped delimiters and nested labels/destinations
  // are handled explicitly; reference links and malformed syntax are rejected.
  for (let i = startLine; i < endLine; i++) {
    if (text[i] !== '[' || escaped(text, i)) continue;
    let depth = 1, close = i + 1;
    for (; close < endLine && depth; close++) if (!escaped(text, close)) { if (text[close] === '[') depth++; if (text[close] === ']') depth--; }
    const labelEnd = close - 1;
    if (depth || text[close] !== '(') continue;
    close++; while (close < endLine && /[ \t]/.test(text[close])) close++;
    const destination = close, parsed = markdown.helpers.parseLinkDestination(text, destination, endLine);
    if (!parsed.ok && text[close] !== ')') continue;
    const destinationEnd = parsed.ok ? parsed.pos : close;
    close = destinationEnd; while (close < endLine && /[ \t]/.test(text[close])) close++;
    if (close > destinationEnd && text[close] !== ')') {
      const title = markdown.helpers.parseLinkTitle(text, close, endLine); if (!title.ok) continue;
      close = title.pos; while (close < endLine && /[ \t]/.test(text[close])) close++;
    }
    if (text[close] !== ')' || offset < i || offset > close) continue;
    if (outer) return { start: i, end: close + 1 };
    const angle = text[destination] === '<';
    return kind === 'link-label' ? { start: i + 1, end: labelEnd } : { start: destination + (angle ? 1 : 0), end: destinationEnd - (angle ? 1 : 0) };
  }
  return null;
}
export function disjointSpans(spans: TextSpan[]): TextSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: TextSpan[] = [];
  for (const span of sorted) {
    const previous = result.at(-1);
    if (previous && span.start < previous.end) {
      if (span.start === previous.start && span.end === previous.end) continue;
      throw Error('Selections overlap. Select non-overlapping targets before editing.');
    }
    result.push(span);
  }
  return result;
}
