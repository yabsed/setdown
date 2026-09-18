export type TableAlignment = 'none' | 'left' | 'center' | 'right';

export type MarkdownTable = {
  headers: string[];
  rows: string[][];
  alignments: TableAlignment[];
};

function escapeTableCell(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>');
}

function delimiterFor(alignment: TableAlignment) {
  if (alignment === 'left') return ':---';
  if (alignment === 'center') return ':---:';
  if (alignment === 'right') return '---:';
  return '---';
}

function tableRow(cells: string[], columns: number) {
  const normalized = Array.from(
    { length: columns },
    (_, index) => escapeTableCell(cells[index] ?? ''),
  );
  return `| ${normalized.join(' | ')} |`;
}

export function createMarkdownTable(table: MarkdownTable, eol = '\n') {
  const columns = table.headers.length;
  if (columns < 1) throw new Error('A table needs at least one column.');
  const header = tableRow(table.headers, columns);
  const delimiter = tableRow(
    Array.from({ length: columns }, (_, index) =>
      delimiterFor(table.alignments[index] ?? 'none')),
    columns,
  );
  return [header, delimiter, ...table.rows.map((row) => tableRow(row, columns))].join(eol);
}

function escapeLinkLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/[\[\]]/g, '\\$&');
}

function escapeAngleDestination(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/[<>]/g, '\\$&');
}

function escapeLinkTitle(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r\n|\r|\n/g, ' ');
}

export function createMarkdownLink(label: string, destination: string, title = '') {
  const normalizedDestination = destination.trim();
  if (!normalizedDestination) throw new Error('A URL or file path is required.');
  const normalizedLabel = label || normalizedDestination;
  const titlePart = title.trim() ? ` "${escapeLinkTitle(title.trim())}"` : '';
  return `[${escapeLinkLabel(normalizedLabel)}](<${escapeAngleDestination(normalizedDestination)}>${titlePart})`;
}

export function preferredEol(text: string) {
  const match = text.match(/\r\n|\r|\n/);
  return match?.[0] ?? '\n';
}
