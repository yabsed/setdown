import { describe, expect, it } from 'vitest';
import { NotebookDocument, emptyNotebook } from './notebook-document';
import { markdownText, notebookHeadings, offsetRange, searchOffsets, tracebackTargets } from './notebook-tools';

describe('notebook navigation and atomic edits', () => {
  it('finds headings outside fences and decodes rendered Markdown', () => {
    const doc = new NotebookDocument(emptyNotebook()), id = doc.add('markdown');
    doc.setSource(id, '# Intro\n\n```python\n# not a heading\n```\n\nResult\n------\n\nA **bold** word &amp; link.');
    expect(notebookHeadings(doc.cells).map(h => [h.text, h.level, h.line])).toEqual([['Intro', 1, 1], ['Result', 2, 7]]);
    expect(markdownText(doc.cells[0].source)).toContain('A bold word & link.');
  });
  it('searches Unicode, literal punctuation, regex groups and CRLF positions', () => {
    expect(searchOffsets('한글 a.b A.B', { query: 'a.b', regex: false, matchCase: false })).toEqual([{ start: 3, end: 6 }, { start: 7, end: 10 }]);
    expect(searchOffsets('row1 row2', { query: 'row\\d', regex: true, matchCase: true })).toHaveLength(2);
    expect(offsetRange('한글\r\n🙂value', 6, 11)).toEqual({ startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 8 });
    expect(() => searchOffsets('x', { query: '[', regex: true, matchCase: true })).toThrow();
  });
  it('rejects a stale multi-cell change without touching any cell, and undoes a valid change together', () => {
    const doc = new NotebookDocument(emptyNotebook()), a = doc.add('code'), b = doc.add('code');
    doc.setSource(a, 'old = 1'); doc.setSource(b, 'print(old)');
    const edits = doc.cells.map(cell => ({ id: cell.id, version: cell.version, source: cell.source.replace('old', 'new') }));
    doc.setSource(b, 'print(old + 1)'); expect(() => doc.editSources(edits)).toThrow(); expect(doc.cells[0].source).toBe('old = 1');
    const original = doc.serialize(); doc.editSources(doc.cells.map(cell => ({ id: cell.id, version: cell.version, source: cell.source.replace('old', 'new') })));
    expect(doc.cells.map(cell => cell.source)).toEqual(['new = 1', 'print(new + 1)']); doc.undo(); expect(doc.serialize()).toBe(original);
  });
  it('clears all output in one undo and splits without exposing stale execution results', () => {
    const doc = new NotebookDocument(emptyNotebook()), a = doc.add('code'), b = doc.add('code');
    doc.setSource(a, '한글\r\n🙂x');
    for (const id of [a, b]) doc.setExecution(id, [{ output_type: 'stream', name: 'stdout', text: 'result' }], 3, doc.cells.find(cell => cell.id === id)!.source);
    const original = doc.serialize(); doc.clearMany(); expect(JSON.parse(doc.serialize()).cells.every((cell: any) => cell.outputs.length === 0 && cell.execution_count === null)).toBe(true);
    doc.undo(); expect(doc.serialize()).toBe(original);
    expect(() => doc.split(a, 3)).toThrow(); expect(() => doc.split(a, 5)).toThrow();
    const next = doc.split(a, 4)!; expect(doc.cells[1].id).toBe(next);
    expect(JSON.parse(doc.serialize()).cells.slice(0, 2).every((cell: any) => cell.outputs.length === 0)).toBe(true);
    doc.undo(); expect(doc.serialize()).toBe(original); doc.redo(); expect(doc.cells[1].source).toBe('🙂x');
  });
  it('refuses joins that would discard attachments or metadata and restores adjacent cells on undo', () => {
    const source = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
      { id: 'a', cell_type: 'markdown', metadata: {}, source: '![x](attachment:x)', attachments: { x: { 'image/png': 'AA==' } } },
      { id: 'b', cell_type: 'markdown', metadata: {}, source: '![x](attachment:x)', attachments: { x: { 'image/png': 'AQ==' } } },
    ] });
    const doc = new NotebookDocument(source); expect(() => doc.join(['a', 'b'])).toThrow(/attachments/); expect(doc.serialize()).toBe(source);
    const code = new NotebookDocument(emptyNotebook()), a = code.add('code'), b = code.add('code'); code.setSource(a, 'x = 1'); code.setSource(b, 'print(x)');
    const original = code.serialize(); code.join([b, a]); expect(code.cells[0].source).toBe('x = 1\nprint(x)'); code.undo(); expect(code.serialize()).toBe(original);
  });
  it('recognizes IPython cell counts and file paths without executing traceback text', () => {
    expect(tracebackTargets('\x1b[31mCell In[7], line 3\nFile "/tmp/한글.py", line 10\nFile "<string>", line 2')).toEqual([
      { count: 7, line: 3, label: 'Cell In[7], line 3' }, { file: '/tmp/한글.py', line: 10, label: 'File "/tmp/한글.py", line 10' },
    ]);
  });
});
