import assert from 'node:assert/strict';
import { test } from 'vitest';
import type * as Monaco from 'monaco-editor';
import { DocumentModelOwner, LiveDocumentModelPort } from './live-document-model';

function model() {
  return { disposed: 0, stops: 0, dispose() { this.disposed++; }, pushStackElement() { this.stops++; } };
}
test('all views borrow the exact document model, not a clone', () => {
  const live = model();
  const owner = new DocumentModelOwner(live, () => {});
  const a = owner.borrow(), b = owner.borrow();
  assert.strictEqual(a.model, b.model);
  assert.strictEqual(a.model, live);
  a.release(); b.release();
  assert.equal(live.disposed, 0);
  owner.releaseOwner();
  assert.equal(live.disposed, 1);
});
test('closing/reopening a review leaves the document and history alive', () => {
  const live = model(), owner = new DocumentModelOwner(live, () => {});
  owner.borrow().release();
  const next = owner.borrow();
  assert.strictEqual(next.model, live);
  assert.equal(live.disposed, 0);
  next.release(); owner.releaseOwner();
});
test('document close detaches its listener but waits for the last review lease', () => {
  const live = model(); let stopped = 0;
  const owner = new DocumentModelOwner(live, () => { stopped++; });
  const a = owner.borrow(), b = owner.borrow();
  owner.releaseOwner(); owner.releaseOwner();
  assert.equal(stopped, 1); assert.equal(live.disposed, 0);
  assert.throws(() => owner.borrow(), /closing/);
  a.release(); a.release(); assert.equal(live.disposed, 0);
  b.release(); b.release(); assert.equal(live.disposed, 1);
});
test('surface changes close typing groups, not every focus notification', () => {
  const live = model(), owner = new DocumentModelOwner(live, () => {});
  owner.beginEditing('ordinary'); owner.beginEditing('ordinary');
  const review = owner.borrow();
  review.beginEditing('review'); review.beginEditing('review');
  owner.beginEditing('ordinary');
  assert.equal(live.stops, 2);
  review.release(); review.beginEditing('review'); assert.equal(live.stops, 2);
  owner.releaseOwner();
});
test('one document event fans out without replaying the edit or duplicating history', () => {
  const port = new LiveDocumentModelPort(); let calls = 0;
  const unsubscribe = port.subscribe(event => { assert.equal(event.type, 'changed'); calls++; });
  port.publish({ type: 'changed', path: '/a.md', text: '한' });
  unsubscribe(); port.publish({ type: 'changed', path: '/a.md', text: '한글' });
  assert.equal(calls, 1);
});
test('a retired provider cannot erase a newer workspace provider', () => {
  const port = new LiveDocumentModelPort(), api = {} as typeof Monaco;
  const old = port.register(() => null);
  const live = model() as unknown as Monaco.editor.ITextModel;
  const remove = port.register(path => path === '/a.md' ? { model: live, release() {}, beginEditing() {} } : null);
  old(); assert.strictEqual(port.acquire('/a.md', api)?.model, live);
  assert.equal(port.acquire('/missing.md', api), null);
  remove(); assert.equal(port.acquire('/a.md', api), null);
});
