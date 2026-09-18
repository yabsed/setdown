export type HighlightPart = { text: string; match: boolean };

export function searchHighlightParts(text: string, query: string): HighlightPart[] {
  if (!query) return [{ text, match: false }];
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const parts: HighlightPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(expression)) {
    const index = match.index;
    if (index > offset) parts.push({ text: text.slice(offset, index), match: false });
    parts.push({ text: match[0], match: true });
    offset = index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), match: false });
  return parts.length ? parts : [{ text, match: false }];
}
