import { expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import { DiagnosticStore } from './diagnostic-store';

test('independent providers and channels survive another provider restart; stale and retired publications cannot return', () => {
  let version = 1;
  const api = { editor: { setModelMarkers: vi.fn() } } as unknown as typeof M;
  const model = { uri: { fsPath: '/test.py', toString: () => 'file:///test.py' }, getVersionId: () => version, isDisposed: () => false } as unknown as M.editor.ITextModel;
  const store = new DiagnosticStore(api), first = store.lease(model, 'analysis', 'old'), lint = store.lease(model, 'lint', 'lint');
  const item = { message: 'Error', severity: 8, startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 };
  first.publish('push', [item], 1); lint.publish('pull', [{ ...item, message: 'Lint' }], 1);
  expect(store.entries()).toHaveLength(2);
  first.dispose(); expect(store.entries().map(e => e.item.source)).toEqual(['lint']);
  const next = store.lease(model, 'analysis', 'new'); version++;
  first.publish('push', [item], 2); next.publish('pull', [item], 1);
  expect(store.entries()).toHaveLength(1);
  next.publish('push', [item]);
  expect(store.entries().find(e => e.item.source === 'analysis')?.batch).toMatchObject({ freshness: 'best-effort', version: undefined });
  next.clear(); expect(store.entries()).toHaveLength(1);
  lint.dispose(); next.dispose(); expect(store.entries()).toEqual([]);
});

test('cell diagnostics exist before a model mounts, navigate to the cell, and reject late results', async () => {
  const api = { editor: { setModelMarkers: vi.fn() } } as unknown as typeof M;
  const store = new DiagnosticStore(api), open = vi.fn(async () => {});
  let version = 1, alive = true, model: M.editor.ITextModel | undefined;
  const lease = store.leaseResource('setdown-cell://nb/cell', 'python', 'epoch', { path: '/notes.ipynb', cellId: 'cell',
    alive: () => alive, version: () => version, model: () => model, line: () => 'choose("bad")', open });
  const item = { message: 'Invalid literal', severity: 8, startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 13 };
  lease.publish('push', [item], 1);
  expect(store.entries()).toHaveLength(1); expect(api.editor.setModelMarkers).not.toHaveBeenCalled();
  const results = store.results(vi.fn()); expect(results[0].location).toMatchObject({ path: '/notes.ipynb', cellId: 'cell', column: 8 });
  await results[0].open(); expect(open).toHaveBeenCalledWith(expect.objectContaining(item));
  model = { isDisposed: () => false } as M.editor.ITextModel; lease.refresh();
  expect(api.editor.setModelMarkers).toHaveBeenLastCalledWith(model, expect.any(String), [expect.objectContaining(item)]);
  version++; lease.clear(); lease.publish('push', [item], 1); expect(store.entries()).toEqual([]);
  alive = false; lease.publish('push', [item], 2); expect(store.entries()).toEqual([]); lease.dispose();
});
