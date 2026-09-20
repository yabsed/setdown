/** Exact, balanced KaTeX spans. This is not a sanitizer or a Markdown parser. */
export type MathIsland = { start: number; end: number; html: string };
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = /^(?:script|style|textarea|title|xmp|iframe|noembed|noframes|plaintext)$/;

/** Return null rather than guessing about malformed/raw-text HTML. */
export function mathIslands(html: string): MathIsland[] | null {
  const result: MathIsland[] = [];
  let cursor = 0;
  let start = -1;
  const stack: string[] = [];
  while (cursor < html.length) {
    const open = html.indexOf('<', cursor);
    if (open < 0) break;
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      if (end < 0) return null;
      cursor = end + 3; continue;
    }
    let end = open + 1;
    let quote = '';
    for (; end < html.length; end++) {
      const c = html[end];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (end === html.length) return null;
    cursor = end + 1;
    const tag = html.slice(open, cursor);
    const match = /^<\s*(\/?)\s*([a-zA-Z][\w:-]*)\b/.exec(tag);
    if (!match) { if (start >= 0) return null; continue; }
    const name = match[2].toLowerCase();
    if (RAW_TEXT.test(name)) return null;
    const closing = match[1] === '/';
    const selfClosing = VOID.has(name) || /\/\s*>$/.test(tag);
    if (start >= 0) {
      if (closing) {
        if (stack.pop() !== name) return null;
        if (!stack.length) {
          const value = html.slice(start, cursor);
          // Source metadata must stay visible to row-delta verification.
          if (!/\bdata-source-(?:line|lines|start|end)\s*=/i.test(value)) {
            result.push({ start, end: cursor, html: value });
          }
          start = -1;
        }
      } else if (!selfClosing) stack.push(name);
      continue;
    }
    if (closing || selfClosing || name !== 'span') continue;
    const attributes = tag.slice(match[0].length, -1);
    let katex = false;
    for (const attr of attributes.matchAll(/\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      if (attr[1].toLowerCase() === 'class') {
        katex = (attr[2] ?? attr[3] ?? attr[4] ?? '').split(/\s+/).includes('katex');
        break;
      }
    }
    if (katex) { start = open; stack.push(name); }
  }
  return start >= 0 ? null : result;
}

/** Copy untouched slices verbatim; never decode/re-encode authored HTML. */
export function replaceMathIslands(html: string, islands: MathIsland[], replace: (island: MathIsland, index: number) => string): string {
  let cursor = 0;
  const parts: string[] = [];
  islands.forEach((island, index) => {
    parts.push(html.slice(cursor, island.start), replace(island, index)); cursor = island.end;
  });
  parts.push(html.slice(cursor));
  return parts.join('');
}
