import { offsetRange, searchOffsets, searchPattern, type SearchOptions } from '../../core/notebook/notebook-tools';

type Request = { cells: { id: string; version: number; text: string }[]; options: SearchOptions; source: boolean; replacement?: string };
self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const { cells, options, source, replacement } = event.data;
    if (replacement !== undefined) {
      const pattern = searchPattern(options);
      const edits = cells.map(cell => ({ id: cell.id, version: cell.version, source: !pattern ? cell.text
        : options.regex ? cell.text.replace(pattern, replacement) : cell.text.replace(pattern, () => replacement) }));
      self.postMessage({ edits }); return;
    }
    const matches = cells.flatMap(cell => searchOffsets(cell.text, options).map(match => ({ id: cell.id,
      range: source ? offsetRange(cell.text, match.start, match.end) : offsetRange('', 0),
      snippet: cell.text.slice(Math.max(0, match.start - 60), Math.min(cell.text.length, match.end + 100)) })));
    self.postMessage({ matches, error: '' });
  } catch (error) { self.postMessage({ matches: [], error: String(error) }); }
};
