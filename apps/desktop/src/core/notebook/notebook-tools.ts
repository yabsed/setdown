import MarkdownIt from 'markdown-it';
import type { NotebookCell } from './notebook-document';

type Token = { type: string; tag: string; content: string; map: number[] | null; children: Token[] | null };
const markdown = new MarkdownIt({ html: false });
export type Heading = { id: string; line: number; level: number; text: string };
const headingCache = new WeakMap<NotebookCell, { source: string; headings: Heading[] }>();
export function notebookHeadings(cells: readonly NotebookCell[]): Heading[] {
  return cells.filter(cell => cell.kind === 'markdown').flatMap(cell => {
    const cached = headingCache.get(cell); if (cached?.source === cell.source) return cached.headings;
    const tokens = markdown.parse(cell.source, {}) as Token[];
    const headings = tokens.flatMap((token, index) => token.type === 'heading_open'
      ? [{ id: cell.id, line: (token.map?.[0] ?? 0) + 1, level: Number(token.tag.slice(1)), text: tokens[index + 1]?.content ?? '' }] : []);
    headingCache.set(cell, { source: cell.source, headings }); return headings;
  });
}
export function markdownText(source: string): string {
  const plain = (tokens: Token[]): string => tokens.map(token => token.children ? plain(token.children)
    : ['text', 'code_inline', 'code_block', 'fence', 'html_inline'].includes(token.type) ? token.content
    : ['softbreak', 'hardbreak'].includes(token.type) ? '\n' : '').join('');
  return (markdown.parse(source, {}) as Token[]).map(token => plain([token])).join('\n');
}
export type SearchOptions = { query: string; regex: boolean; matchCase: boolean };
export function searchPattern(options: SearchOptions): RegExp | null {
  if (!options.query) return null;
  if (options.query.length > 1000) throw Error('Search text is too long.');
  return new RegExp(options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options.matchCase ? 'gu' : 'giu');
}
export function searchOffsets(text: string, options: SearchOptions): { start: number; end: number }[] {
  const pattern = searchPattern(options); if (!pattern) return [];
  const matches: { start: number; end: number }[] = [];
  for (const match of text.matchAll(pattern)) {
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (matches.length >= 1000) break;
  }
  return matches;
}
export function offsetRange(text: string, start: number, end = start) {
  const a = text.slice(0, start).split(/\r\n|\r|\n/), b = text.slice(0, end).split(/\r\n|\r|\n/);
  return { startLineNumber: a.length, startColumn: a.at(-1)!.length + 1, endLineNumber: b.length, endColumn: b.at(-1)!.length + 1 };
}
export type TraceTarget = { count?: number; file?: string; line: number; label: string };
export function tracebackTargets(text: string): TraceTarget[] {
  const clean = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const targets: TraceTarget[] = [];
  for (const match of clean.matchAll(/Cell In\[(\d+)\], line (\d+)|File "([^"]+)", line (\d+)/g)) {
    if (match[1]) targets.push({ count: Number(match[1]), line: Number(match[2]), label: match[0] });
    else if (!match[3].startsWith('<')) targets.push({ file: match[3], line: Number(match[4]), label: match[0] });
  }
  for (const match of clean.matchAll(/^File ([^\n]+?):(\d+)(?:,|$)/gm)) {
    if (!match[1].startsWith('<')) targets.push({ file: match[1], line: Number(match[2]), label: match[0].replace(/,$/, '') });
  }
  return targets;
}
