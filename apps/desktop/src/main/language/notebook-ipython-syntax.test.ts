import { expect, test } from 'vitest';
import { notebookAnalysisSource } from './notebook-ipython-syntax';

test('cell magics whose body is notebook Python are analyzed as Python, others stay opaque', () => {
  expect(notebookAnalysisSource('%%time\ntotal = sum(range(3))')).toBe('#%time\ntotal = sum(range(3))');
  expect(notebookAnalysisSource('%%capture output --no-stderr\r\nimport pandas')).toBe('#%capture output --no-stderr\r\nimport pandas');
  expect(notebookAnalysisSource('%%time')).toBe('#%time');
  // Their bodies are not notebook Python: another language, or code that defines nothing here.
  for (const cell of ['%%bash\nls name?', '%%timeit\ntotal = 1', '%%timer\nx = 1', '%%writefile note.txt\nwhy?', '%%html\n<b>?</b>'])
    expect(notebookAnalysisSource(cell)).toBe(cell);
  // A cell magic is only one at the start of the cell.
  expect(notebookAnalysisSource('x = 1\n%%time')).toBe('x = 1\n%%time');
});

test('IPython help lines become comments of the same length', () => {
  expect(notebookAnalysisSource('learn.fine_tune??')).toBe('#earn.fine_tune??');
  expect(notebookAnalysisSource('import dask\n?LocalCluster\n  ??dask.array.sum  \nframe["size"]?\nnp.sort?  ')).toBe('import dask\n#LocalCluster\n  #?dask.array.sum  \n#rame["size"]?\n#p.sort?  ');
  expect(notebookAnalysisSource('%%time\nvalue = 1\nvalue?\r\n')).toBe('#%time\nvalue = 1\n#alue?\r\n');
  // Ordinary Python and line magics are left alone.
  for (const cell of ['ready = answer == "?"', 'print("really?")', '# why?', 'x = 1 # ok?', '%timeit? ', '!ls ?', 'value = other if flag else None', '?', 'a ?'])
    expect(notebookAnalysisSource(cell)).toBe(cell);
});

test('no rule changes the length or the line structure of a cell', () => {
  for (const cell of ['%%time\nvalue?\n??value\n', '%%capture out\r\nname??\r\n', 'a?\n  b??  \n?c d e\n']) {
    const analyzed = notebookAnalysisSource(cell);
    expect(analyzed).toHaveLength(cell.length);
    expect([...analyzed].map((char, i) => char === '\n' ? i : -1).filter(i => i >= 0)).toEqual([...cell].map((char, i) => char === '\n' ? i : -1).filter(i => i >= 0));
  }
});
