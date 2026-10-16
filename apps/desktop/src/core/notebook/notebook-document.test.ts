import { describe, expect, it } from 'vitest';
import { NotebookDocument, emptyNotebook } from './notebook-document';
import { NotebookProjection, hasNotebookMagic } from './notebook-projection';
const fixture = (minor = 5) => JSON.stringify({ metadata: { custom: { retained: true } }, nbformat: 4, nbformat_minor: minor,
  cells: [{ cell_type: 'markdown', ...(minor >= 5 ? { id: 'intro' } : {}), metadata: { tags: ['intro'] },
    source: ['# A', ' title\n', 'Text'], attachments: { 'image.png': { 'image/png': 'AA==' } } },
  { cell_type: 'code', ...(minor >= 5 ? { id: 'code' } : {}), metadata: {}, execution_count: 4, source: ['numbers = [1, 2, 3]\n'],
    outputs: [{ output_type: 'display_data', metadata: {}, data: { 'application/custom+json': { unknown: 12 }, 'text/plain': ['saved\n'] } }] }] }, null, 2) + '\n';

describe('notebook ownership and persistence', () => {
  it('drags by stable cell ID as one undoable operation, including dropping at the end', () => {
    const document = new NotebookDocument(fixture()), last = document.add('raw');
    const original = [...document.cells]; document.moveBefore(last, 'intro');
    expect(document.cells.map(c => c.id)).toEqual([last, 'intro', 'code']);
    document.undo(); expect(document.cells).toEqual(original); document.redo();
    document.moveBefore(last); expect(document.cells).toEqual(original);
    const revision = document.revision; document.moveBefore(last, last); document.moveBefore('missing', 'intro');
    expect(document.revision).toBe(revision);
  });
  it('preserves other cells and metadata when execution replaces output, including concurrent save', () => {
    const document = new NotebookDocument(fixture());
    document.setExecution('code', [{ output_type: 'stream', name: 'stdout', text: 'new result' }], 9, 'print(9)');
    const saved = document.serialize(), value = JSON.parse(saved);
    expect(value.cells[0]).toEqual(JSON.parse(fixture()).cells[0]); expect(value.cells[1].execution_count).toBe(9);
    document.setExecution('code', [{ output_type: 'stream', name: 'stdout', text: 'later result' }], 10, 'print(10)');
    document.markSaved(saved); expect(document.dirty).toBe(true);
    document.markSaved(document.serialize()); expect(document.dirty).toBe(false);
    document.clear('code'); expect(JSON.parse(document.serialize()).cells[1].execution_count).toBeNull();
    document.undo(); expect(JSON.parse(document.serialize()).cells[1].outputs[0].text).toBe('later result');
  });
  it('persists outputs for a new cell and gives duplicated legacy optional IDs a new identity', () => {
    const document = new NotebookDocument(emptyNotebook()), id = document.add('code');
    document.setExecution(id, [{ output_type: 'stream', name: 'stdout', text: 'hi' }], 1, 'print("hi")');
    expect(JSON.parse(document.serialize()).cells[0].outputs).toHaveLength(1);
    const legacy = new NotebookDocument(fixture().replace('"nbformat_minor": 5', '"nbformat_minor": 4'));
    const copy = legacy.duplicate('code'); const result = new NotebookDocument(legacy.serialize());
    expect(result.error).toBeUndefined(); expect(result.cells[2].id).toBe(copy);
  });

  it('preserves exact bytes on no-op saves, joining source chunks without inserting newlines', () => {
    const text = fixture(), document = new NotebookDocument(text);
    expect(document.error).toBeUndefined(); expect(document.cells[0].source).toBe('# A title\nText');
    expect(document.serialize()).toBe(text); expect(document.dirty).toBe(false);
    document.setSource('intro', 'changed'); expect(document.dirty).toBe(true);
    document.setSource('intro', '# A title\nText'); expect(document.serialize()).toBe(text); expect(document.dirty).toBe(false);
  });
  it('preserves unknown metadata, output bundles, attachments and large numeric lexemes across cell edits', () => {
    const text = fixture().replace('"retained": true', '"retained": 900719925474099312345');
    const document = new NotebookDocument(text); document.setSource('code', 'print("edited")');
    const saved = document.serialize(), parsed = JSON.parse(saved), original = JSON.parse(text);
    expect(saved).toContain('900719925474099312345');
    expect(parsed.cells[0]).toEqual(original.cells[0]);
    expect(parsed.cells[1].outputs).toEqual(original.cells[1].outputs);
    expect(parsed.cells[1].source).toBe('print("edited")');
    document.markSaved(saved); expect(document.dirty).toBe(false);
    document.setSource('code', 'another change'); document.markSaved(saved); expect(document.dirty).toBe(true);
  });
  it.each([0, 1, 2, 3, 4])('opens older 4.%i cells without persisting synthetic IDs', minor => {
    const document = new NotebookDocument(fixture(minor)), id = document.cells[1].id;
    document.setSource(id, 'changed'); document.add('raw');
    expect(JSON.parse(document.serialize()).cells.every((cell: object) => !('id' in cell))).toBe(true);
  });
  it('retains source edits through delete/undo, move/undo and output clear/undo', () => {
    const document = new NotebookDocument(fixture());
    document.setSource('code', 'later'); document.remove('code'); document.undo();
    expect(document.cells[1].source).toBe('later');
    document.move('code', -1); expect(document.cells[0].id).toBe('code'); document.undo();
    document.clear('code'); expect(JSON.parse(document.serialize()).cells[1].outputs).toEqual([]);
    document.undo(); expect(JSON.parse(document.serialize()).cells[1].outputs).toHaveLength(1);
    document.convert('code', 'markdown'); expect(JSON.parse(document.serialize()).cells[1].outputs).toBeUndefined();
    document.undo(); expect(JSON.parse(document.serialize()).cells[1].outputs).toHaveLength(1);
  });
  it('does not lose a transferred legacy reorder with identical source and different metadata', () => {
    const original = JSON.stringify({ nbformat: 4, nbformat_minor: 4, metadata: {}, cells: [
      { cell_type: 'markdown', source: 'same', metadata: { tag: 'a' } },
      { cell_type: 'markdown', source: 'same', metadata: { tag: 'b' } },
    ] });
    const moved = new NotebookDocument(original); moved.move(moved.cells[0].id, 1);
    const transferred = new NotebookDocument(moved.serialize()); transferred.markSaved(original);
    expect(transferred.dirty).toBe(true);
    transferred.markSaved(transferred.serialize()); expect(transferred.dirty).toBe(false);
  });
  it('checkpoints the written order of legacy cells when another edit arrives during save', () => {
    const document = new NotebookDocument(fixture(4)), cell = document.cells[1];
    document.move(cell.id, -1); const written = document.serialize();
    const before = cell.source; document.setSource(cell.id, 'newer than disk');
    document.markSaved(written); expect(document.dirty).toBe(true);
    document.setSource(cell.id, before); expect(document.dirty).toBe(false);
  });
  it('preserves CRLF framing through structural changes without mixed line endings', () => {
    const document = new NotebookDocument(fixture().replace(/\n/g, '\r\n'));
    document.add('code'); document.convert('code', 'raw');
    expect(document.serialize().replace(/\r\n/g, '')).not.toContain('\n');
    expect(new NotebookDocument(document.serialize()).error).toBeUndefined();
  });
  it('new notebooks use 4.5 IDs and a Python kernelspec without running Python', () => {
    const document = new NotebookDocument(emptyNotebook()); document.add('code'); document.add('markdown');
    const result = JSON.parse(document.serialize()); expect(result.nbformat_minor).toBe(5);
    expect(result.cells[0].id).not.toBe(result.cells[1].id); expect(result.metadata.kernelspec.language).toBe('python');
  });
  it.each(['', '{broken', '{"nbformat":4,"nbformat":4}', fixture().replace('"nbformat": 4', '"nbformat": 3'),
    fixture().replace('"id": "code"', '"id": "intro"'), fixture().replace('"source": [', '"source": null, "old": [')])(
    'invalid notebooks stay unchanged and cannot gain editable cells', text => {
      const document = new NotebookDocument(text); expect(document.error).toBeTruthy(); document.add('code');
      expect(document.serialize()).toBe(text); expect(document.cells).toEqual([]); expect(document.dirty).toBe(false);
    });
});

describe('Python cell projection', () => {
  it('maps UTF-16 positions and definitions between cells, excludes separators, and rebuilds after preceding edits', () => {
    const document = new NotebookDocument(emptyNotebook()); const a = document.add('code'), b = document.add('code');
    document.setSource(a, 'label = "🙂"\nnumbers = [1, 2]'); document.setSource(b, 'numbers.append(3)');
    const projection = new NotebookProjection(document.cells);
    expect(projection.position(b, { line: 0, character: 7 })).toEqual({ line: 4, character: 7 });
    expect(projection.range({ start: { line: 1, character: 0 }, end: { line: 1, character: 7 } })?.id).toBe(a);
    expect(projection.range({ start: { line: 1, character: 0 }, end: { line: 4, character: 7 } })).toBeNull();
    expect(projection.position(a, { line: 0, character: 12 })).toEqual({ line: 0, character: 12 });
    document.setSource(a, '\n' + document.cells[0].source);
    expect(new NotebookProjection(document.cells).position(b, { line: 0, character: 0 })?.line).toBe(5);
  });
  it('does not confuse string/comment contents with IPython commands', () => {
    expect(hasNotebookMagic('a = """\n%time\n!echo\n"""\nb = 10 % 2\n# %time')).toBe(false);
    for (const source of ['%time f()', '!pip install a', '%%bash\necho hello', 'files = !ls', 'str?']) expect(hasNotebookMagic(source)).toBe(true);
    const document = new NotebookDocument(emptyNotebook()); const id = document.add('code'); document.setSource(id, '!echo no');
    const projection = new NotebookProjection(document.cells); expect(projection.text).toBe('');
    expect(projection.position(id, { line: 0, character: 0 })).toBeNull();
    expect(document.cells[0].source).toBe('!echo no');
  });
});
