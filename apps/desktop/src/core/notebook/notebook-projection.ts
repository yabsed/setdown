import type { Position, Range } from 'vscode-languageserver-protocol';
import type { NotebookCell } from './notebook-document';

/** Recognize IPython-only syntax outside strings/comments. Never rewrite user
 * source or pass shell/magic commands off as ordinary Python. */
export function hasNotebookMagic(source: string): boolean {
  let quote = '', triple = false, escaped = false, code = '';
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote && (!triple || source.slice(i, i + 3) === quote.repeat(3))) {
        if (triple) i += 2; quote = ''; triple = false;
      }
      if (char === '\n') code += '\n';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char; triple = source.slice(i, i + 3) === char.repeat(3); if (triple) i += 2; code += 's'; continue;
    }
    if (char === '#') { while (i < source.length && source[i] !== '\n') i++; code += '\n'; continue; }
    code += char;
  }
  return /(^|\n)\s*[!%?]|=\s*[!%]|\?\s*(?:\n|$)/.test(code);
}
export type ProjectionCell = { id: string; start: number; lines: string[]; excluded: boolean };
export class NotebookProjection {
  readonly cells: ProjectionCell[] = [];
  readonly text: string;
  constructor(cells: readonly NotebookCell[]) {
    const chunks: string[] = []; let start = 0;
    for (const cell of cells) {
      if (cell.kind !== 'code') continue;
      const lines = cell.source.split(/\r\n|\r|\n/), excluded = hasNotebookMagic(cell.source);
      this.cells.push({ id: cell.id, start, lines, excluded });
      chunks.push(excluded ? lines.map(() => '').join('\n') : lines.join('\n'));
      start += lines.length + 2;
    }
    this.text = chunks.join('\n\n\n');
  }
  position(id: string, position: Position): Position | null {
    const cell = this.cells.find(cell => cell.id === id);
    return cell && !cell.excluded && this.valid(cell, position) ? { line: position.line + cell.start, character: position.character } : null;
  }
  range(range: Range): { id: string; range: Range } | null {
    const cell = this.cells.find(cell => !cell.excluded && range.start.line >= cell.start && range.end.line < cell.start + cell.lines.length);
    if (!cell) return null;
    const result = { start: { ...range.start, line: range.start.line - cell.start }, end: { ...range.end, line: range.end.line - cell.start } };
    return this.valid(cell, result.start) && this.valid(cell, result.end) ? { id: cell.id, range: result } : null;
  }
  private valid(cell: ProjectionCell, position: Position): boolean {
    return Number.isInteger(position.line) && Number.isInteger(position.character) && position.line >= 0 && position.line < cell.lines.length
      && position.character >= 0 && position.character <= cell.lines[position.line].length;
  }
}
