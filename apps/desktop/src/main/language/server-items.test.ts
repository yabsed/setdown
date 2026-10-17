import { expect, test } from 'vitest';
import { ServerItems } from './server-items';

const origin = { document: 'document', generation: 'generation', version: 1 };

test('every item of a 4,097-item completion remains resolvable until its list is released', () => {
  const store = new ServerItems();
  const source = Array.from({ length: 4097 }, (_, i) => ({ label: `item${i}`, data: { id: i } }));
  const result = store.remember('textDocument/completion', source, origin) as any[];
  for (let i = 0; i < result.length; i++) expect(store.resolve('completionItem/resolve', result[i], origin)).toEqual(source[i]);
  store.release(result.map(item => item.$setdownItem), { document: 'foreign' });
  expect(store.resolve('completionItem/resolve', result[0], origin)).toEqual(source[0]);
  store.release(result.map(item => item.$setdownItem), origin);
  expect(() => store.resolve('completionItem/resolve', result[0], origin)).toThrow(/expired/);
});

test('an oversized reply fails atomically without invalidating an earlier visible reply', () => {
  const store = new ServerItems(1024);
  const [previous] = store.remember('textDocument/completion', [{ label: 'visible' }], origin) as any[];
  expect(() => store.remember('textDocument/completion', [{ label: 'would fit' }, { label: 'x'.repeat(1024) }], origin)).toThrow(/budget/);
  expect(store.resolve('completionItem/resolve', previous, origin)).toEqual({ label: 'visible' });
  // A failed reservation must not consume budget.
  expect(store.remember('textDocument/completion', [{ label: 'next' }], origin)).toHaveLength(1);
});

test('diagnostics and completion edit ranges neither consume handles nor displace active items', () => {
  const store = new ServerItems(1024), range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  const diagnostics = Array.from({ length: 4097 }, () => ({ range, message: 'problem', data: { title: 'private' } }));
  expect(store.remember('textDocument/diagnostic', diagnostics, origin)).toBe(diagnostics);
  const [item] = store.remember('textDocument/completion', [{ label: 'name', textEdit: { range, newText: 'name' } }], origin) as any[];
  expect(item.textEdit.$setdownItem).toBeUndefined();
  expect(store.resolve('completionItem/resolve', item, origin)).toMatchObject({ label: 'name' });
});

test('a lazy document link without a label or URL remains resolvable', () => {
  const store = new ServerItems(), link = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, data: 42 };
  const [result] = store.remember('textDocument/documentLink', [link], origin) as any[];
  expect(store.resolve('documentLink/resolve', result, origin)).toEqual(link);
});

test('a lazy code lens with only a range and data remains resolvable', () => {
  const store = new ServerItems(), lens = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, data: 42 };
  const [result] = store.remember('textDocument/codeLens', [lens], origin) as any[];
  expect(store.resolve('codeLens/resolve', result, origin)).toEqual(lens);
});
