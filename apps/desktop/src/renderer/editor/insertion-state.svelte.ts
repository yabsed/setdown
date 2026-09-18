import type { TableAlignment } from '../../core/markdown/markdown-insertions';

export type TableDraft = {
  headers: string[];
  rows: string[][];
  alignments: TableAlignment[];
};

export const emptyTable = (): TableDraft => ({
  headers: ['열 1', '열 2', '열 3'],
  rows: [['', '', ''], ['', '', '']],
  alignments: ['none', 'none', 'none'],
});

export const insertion = $state({
  tableOpen: false,
  table: emptyTable(),
  linkOpen: false,
  linkLabel: '',
  linkDestination: '',
  linkTitle: '',
  linkError: '',
});

export function resizeTable(columns: number, rows: number) {
  const previous = insertion.table;
  insertion.table = {
    headers: Array.from({ length: columns }, (_, column) =>
      previous.headers[column] ?? `열 ${column + 1}`),
    alignments: Array.from({ length: columns }, (_, column) =>
      previous.alignments[column] ?? 'none'),
    rows: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) => previous.rows[row]?.[column] ?? '')),
  };
}
