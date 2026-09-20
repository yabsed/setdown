import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ReviewPresentation } from './review-presentation';

function fixture() {
  const sent: Array<{ id: string; message: Record<string, unknown> }> = [];
  const gate = new ReviewPresentation({ sendPreviewCommand: (id, message) => sent.push({ id, message }) });
  let valid = true;
  let commits = 0;
  const errors: string[] = [];
  const target = { id: 'git-diff:r:b', revision: 2, bounds: { x: 20, y: 80, width: 800, height: 600 },
    position: { sourceLine: 40, topRatio: .372, sourceSide: 'after', settle: false } };
  const present = (value = target) => gate.present(value, () => valid, () => { commits++; }, (e) => errors.push(e));
  const ack = (index = sent.length - 1, override: Record<string, unknown> = {}) => gate.receive(sent[index].id, {
    type: 'marktex:review-prepared', revision: sent[index].message.revision,
    requestId: sent[index].message.requestId, ...override,
  });
  return { gate, sent, target, present, ack, errors, commits: () => commits, invalidate: () => { valid = false; } };
}

test('new revision applies hidden bounds and final position before committing', () => {
  const f = fixture(); f.present();
  assert.equal(f.sent[0].message.command, 'marktex:prime-review');
  assert.equal(f.sent[1].message.command, 'marktex:prepare-review');
  assert.equal(f.commits(), 0);
  f.ack(); assert.equal(f.commits(), 1); assert.equal(f.gate.waiting, false);
});
test('repeated identical layout requests do not restart preparation', () => {
  const f = fixture(); f.present(); f.present(); f.present();
  assert.equal(f.sent.length, 2); f.ack(); assert.equal(f.commits(), 1);
});
test('old revision, wrong view and main-process numeric ACKs cannot commit', () => {
  const f = fixture(); f.present();
  f.ack(1, { revision: 1 }); f.ack(1, { requestId: 1 });
  f.gate.receive('git-diff:other:a', { ...f.sent[1].message, type: 'marktex:review-prepared' });
  assert.equal(f.commits(), 0); f.ack(); assert.equal(f.commits(), 1);
});
test('resize supersedes the old request even when its revision is unchanged', () => {
  const f = fixture(); f.present();
  f.present({ ...f.target, bounds: { ...f.target.bounds, width: 900 } });
  f.ack(1); assert.equal(f.commits(), 0); f.ack(); assert.equal(f.commits(), 1);
});
test('changed final position supersedes the old request', () => {
  const f = fixture(); f.present();
  f.present({ ...f.target, position: { ...f.target.position, sourceLine: 90 } });
  f.ack(1); assert.equal(f.commits(), 0); f.ack(); assert.equal(f.commits(), 1);
});
test('cancel then reopen rejects the first Escape acknowledgment', () => {
  const f = fixture(); f.present(); f.gate.cancel(); f.present();
  f.ack(1); assert.equal(f.commits(), 0); f.ack(); assert.equal(f.commits(), 1);
});
test('a changed buffer, tab, theme or surface invalidates the acceptance predicate', () => {
  const f = fixture(); f.present(); f.invalidate(); f.ack();
  assert.equal(f.commits(), 0); assert.equal(f.gate.waiting, false);
});
test('layout error is surfaced without showing the candidate', () => {
  const f = fixture(); f.present(); f.ack(1, { error: 'font load failed' });
  assert.deepEqual(f.errors, ['font load failed']); assert.equal(f.commits(), 0);
});
test('synchronous transport failure cleans the pending request', () => {
  const gate = new ReviewPresentation({ sendPreviewCommand() { throw new Error('closed'); } });
  const f = fixture(); let error = '';
  gate.present(f.target, () => true, () => assert.fail('must not commit'), (value) => { error = value; });
  assert.equal(error, 'closed'); assert.equal(gate.waiting, false);
});
