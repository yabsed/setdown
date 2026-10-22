import { fromMarkdown, type Handle } from 'mdast-util-from-markdown';
import { Parser } from 'htmlparser2';

export type AssetRelocation = { sourceDirectoryName: string; destinationDirectoryName: string };

/** A filesystem segment is data, including characters reserved by URLs/Markdown. */
export function encodePathSegments(segments: string[]): string {
  return segments.map(segment => encodeURIComponent(segment).replace(/[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

/** Change only parsed destinations, keeping all other authored bytes intact. */
export function rewriteAssetReferences(text: string, relocation: AssetRelocation): string {
  const { sourceDirectoryName: from, destinationDirectoryName: to } = relocation;
  if (from === to) return text;
  const rewrite = (url: string): string | null => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return null;
    const suffix = url.search(/[?#]/), pathname = suffix < 0 ? url : url.slice(0, suffix);
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { return null; }
    const relative = decoded.replace(/^\.\//, '');
    if (!relative.startsWith(`${from}/`) || relative.split('/').includes('..')) return null;
    return encodePathSegments([to, ...relative.slice(from.length + 1).split('/')]) + (suffix < 0 ? '' : url.slice(suffix));
  };
  const edits: Array<{ start: number; end: number; value: string }> = [];
  // Destination tokens exclude brackets/quotes and carry offsets in the original
  // source, including reference definitions and nested block quotes/lists.
  const destination: Handle = function(token) {
    const url = this.resume();
    const node = this.stack[this.stack.length - 1];
    if ('url' in node) node.url = url;
    const value = rewrite(url);
    if (value !== null) edits.push({ start: token.start.offset, end: token.end.offset, value });
  };
  const tree = fromMarkdown(text, { mdastExtensions: [{ exit: {
    resourceDestinationString: destination, definitionDestinationString: destination,
  } }] });
  const visit = (node: typeof tree | typeof tree.children[number]): void => {
    if (node.type === 'html' && node.position) {
      const offset = node.position.start.offset!;
      const parser = new Parser({ onattribute(name, value) {
        if (!['src', 'href', 'poster'].includes(name)) return;
        const rewritten = rewrite(value);
        if (rewritten === null) return;
        edits.push({ start: offset + parser.startIndex, end: offset + parser.endIndex,
          value: `${name}="${rewritten.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` });
      } });
      parser.end(text.slice(offset, node.position.end.offset));
    }
    if ('children' in node) for (const child of node.children) visit(child as typeof tree.children[number]);
  };
  visit(tree);
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
  return text;
}
