/** Unicode case-insensitive literal matching returns offsets in the original string. */
export function literalSearch(text: string, query: string): Iterable<{ start: number; end: number }> {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  return (function* () {
    for (const match of text.matchAll(pattern)) yield { start: match.index, end: match.index + match[0].length };
  })();
}
