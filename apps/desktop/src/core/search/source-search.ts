export type SourceMatch = { line: number; column: number; lineOccurrence: number; ordinal: number; preview: string };
/** Literal, case-insensitive search in the live buffer; columns are UTF-16 like Monaco. */
export function searchSource(text: string, query: string, limit: number): SourceMatch[] {
  if (!query || limit <= 0) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const matches: SourceMatch[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
    const line = lines[index];
    pattern.lastIndex = 0;
    let occurrence = 0;
    for (let match = pattern.exec(line); match && matches.length < limit; match = pattern.exec(line)) {
      const start = Math.max(0, match.index - 60);
      const end = Math.min(line.length, match.index + match[0].length + 120);
      matches.push({ line: index + 1, column: match.index + 1, lineOccurrence: occurrence++, ordinal: matches.length,
        preview: `${start ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}` });
    }
  }
  return matches;
}
