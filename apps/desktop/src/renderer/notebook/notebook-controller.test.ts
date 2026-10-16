import { expect, test } from 'vitest';
import { NotebookDocument, emptyNotebook } from '../../core/notebook/notebook-document';
import { NotebookController } from './notebook-controller';

test('range/toggle selection moves and deletes cells as one undoable operation', () => {
  const document = new NotebookDocument(emptyNotebook()), ids = Array.from({ length: 5 }, () => document.add('code'));
  const controller = new NotebookController(document);
  controller.select(ids[1]); controller.select(ids[3], true);
  expect([...controller.selected]).toEqual(ids.slice(1, 4));
  controller.move(ids[0]); expect(document.cells.map(c => c.id)).toEqual([...ids.slice(1, 4), ids[0], ids[4]]);
  document.undo(); expect(document.cells.map(c => c.id)).toEqual(ids);
  controller.select(ids[2], false, true); expect([...controller.selected]).toEqual([ids[1], ids[3]]);
  controller.remove(); expect(document.cells.map(c => c.id)).toEqual([ids[0], ids[2], ids[4]]);
  document.undo(); expect(document.cells.map(c => c.id)).toEqual(ids);
});

test('clipboard across notebooks keeps exact metadata, attachments and outputs with new IDs', () => {
  const text = '{"nbformat":4,"nbformat_minor":5,"metadata":{},"cells":[{"id":"original","cell_type":"markdown","metadata":{"exact":12345678901234567890},"source":"![x](attachment:x)","attachments":{"x":{"image/png":"AA=="}}},{"id":"code","cell_type":"code","metadata":{},"source":"print(1)","outputs":[{"output_type":"stream","name":"stdout","text":"1\\n"}],"execution_count":2}]}';
  const source = new NotebookController(new NotebookDocument(text)); source.select('original'); source.select('code', true);
  const target = new NotebookController(new NotebookDocument(emptyNotebook())); const ids = target.paste(source.copy());
  expect(ids).toHaveLength(2); expect(ids).not.toContain('original'); expect(ids).not.toContain('code');
  expect(target.document.serialize()).toContain('12345678901234567890');
  const pasted = JSON.parse(target.document.serialize()).cells;
  expect(pasted[0].attachments).toEqual({ x: { 'image/png': 'AA==' } }); expect(pasted[1].outputs[0].text).toBe('1\n');
  expect(pasted[1].execution_count).toBe(2);
  target.document.undo(); expect(target.document.cells).toHaveLength(0); target.document.redo(); expect(target.document.cells.map(c => c.id)).toEqual(ids);
});
