import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';
import { CompositionGuard, isComposingInput } from './composition-guard';

const guards: CompositionGuard[] = [];
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const guard = (settled = () => {}) => {
  const value = new CompositionGuard(settled);
  guards.push(value);
  return value;
};
afterEach(() => { for (const value of guards.splice(0)) value.dispose(); });

test('blocks both native EditContext composition and DOM IME processing keys', () => {
  assert.equal(isComposingInput(), false);
  assert.equal(isComposingInput({ isComposing: true }), true);
  assert.equal(isComposingInput({ keyCode: 229 }), true);
  const input = guard();
  input.start();
  assert.equal(isComposingInput({ isComposing: false }), true);
});

test('retains protection through compositionend and the final input event', async () => {
  let reconciled = 0;
  const input = guard(() => { reconciled += 1; });
  input.start();
  input.end();
  assert.equal(input.active, true);
  assert.equal(reconciled, 0);
  await turn();
  assert.equal(input.active, false);
  assert.equal(reconciled, 1);
});

test('a following Korean syllable cancels the previous release', async () => {
  let reconciled = 0;
  const input = guard(() => { reconciled += 1; });
  input.start(); // 한
  input.end();
  input.start(); // 글
  await turn();
  assert.equal(input.active, true);
  assert.equal(reconciled, 0);
  input.end();
  await turn();
  assert.equal(reconciled, 1);
});

test('late diff reveal is invalid forever once composition begins', async () => {
  const input = guard();
  const reveal = input.navigationTicket();
  assert.equal(reveal(), true);
  input.start();
  assert.equal(reveal(), false);
  input.end();
  await turn();
  assert.equal(reveal(), false);
  assert.equal(input.navigationTicket()(), true);
});

test('typing and mouse selection invalidate a scheduled reveal outside composition', () => {
  const input = guard();
  const reveal = input.navigationTicket();
  input.interrupt();
  assert.equal(reveal(), false);
});

test('ending one editor does not release another editor composition', async () => {
  const first = guard();
  const second = guard();
  first.start(); second.start(); first.end();
  await turn();
  assert.equal(isComposingInput(), true);
  second.dispose();
  assert.equal(isComposingInput(), false);
});

test('disposing cancels deferred reconciliation and navigation', async () => {
  let reconciled = 0;
  const input = guard(() => { reconciled += 1; });
  const ticket = input.navigationTicket();
  input.start(); input.end(); input.dispose();
  await turn();
  assert.equal(reconciled, 0);
  assert.equal(isComposingInput(), false);
  assert.equal(ticket(), false);
});
