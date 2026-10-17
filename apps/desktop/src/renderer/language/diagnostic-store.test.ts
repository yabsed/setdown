import { expect, test, vi } from 'vitest';
import type * as M from 'monaco-editor';
import { DiagnosticStore } from './diagnostic-store';

test('independent providers and channels survive another provider restart; stale and retired publications cannot return', () => {
  let version = 1;
  const api = { editor: { setModelMarkers: vi.fn() } } as unknown as typeof M;
  const model = { getVersionId: () => version, isDisposed: () => false } as M.editor.ITextModel;
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
