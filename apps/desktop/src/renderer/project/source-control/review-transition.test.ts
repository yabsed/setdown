import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { ReviewTransition } from './review-transition';
import { listenForReviewInteraction } from './review-source-interaction';
import { GitDiffViewportPort } from './git-diff-viewport';

afterEach(() => vi.useRealTimers());
test('fast completion clears the notice timer without waiting or invalidating post-show verification', async () => {
  vi.useFakeTimers(); const states: { pending: boolean; notice: boolean; error: string }[] = [];
  const t = new ReviewTransition((state) => states.push(state));
  t.begin('a'); const generation = t.generation; t.complete();
  assert.equal(t.generation, generation); assert.equal(t.forTab('a'), false);
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(states.some((state) => state.notice), false); assert.equal(vi.getTimerCount(), 0);
});
test('notice is delayed but never imposes a minimum visible duration', async () => {
  vi.useFakeTimers(); let state = { pending: false, notice: false, error: '' };
  const t = new ReviewTransition((value) => { state = value; });
  t.begin('a'); await vi.advanceTimersByTimeAsync(199); assert.equal(state.notice, false);
  await vi.advanceTimersByTimeAsync(1); assert.equal(state.notice, true);
  t.complete(); assert.equal(state.notice, false); assert.equal(vi.getTimerCount(), 0);
});
test('duplicate requests do not postpone notice; cancellation invalidates late work', async () => {
  vi.useFakeTimers(); let notice = false;
  const t = new ReviewTransition((state) => { notice = state.notice; });
  t.begin('a'); const generation = t.generation;
  await vi.advanceTimersByTimeAsync(150); t.begin('a'); assert.equal(t.generation, generation);
  await vi.advanceTimersByTimeAsync(50); assert.equal(notice, true);
  t.cancel(); assert.notEqual(t.generation, generation); assert.equal(t.forTab('a'), false);
});
test('error is nonpending and a fresh request clears it', () => {
  let state = { pending: false, notice: false, error: '' };
  const t = new ReviewTransition((value) => { state = value; });
  t.begin('a'); t.fail('offline'); assert.deepEqual(state, { pending: false, notice: false, error: 'offline' });
  t.begin('a'); assert.equal(state.error, ''); t.cancel();
});
test('Escape keyup and passive scroll/layout do not cancel, while explicit input does', () => {
  const target = new EventTarget(); let cancelled = 0;
  const stop = listenForReviewInteraction(target, () => cancelled++);
  const key = (value: string) => Object.assign(new Event('keydown', { cancelable: true }), { key: value });
  for (const value of ['Escape', 'Control', 'Shift', 'Alt', 'Meta']) target.dispatchEvent(key(value));
  for (const type of ['keyup', 'scroll', 'resize', 'pointerup']) target.dispatchEvent(new Event(type));
  assert.equal(cancelled, 0);
  for (const value of ['x', 'ArrowDown', 'Backspace', 'Process']) {
    const event = key(value); target.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
  }
  for (const type of ['pointerdown', 'wheel', 'touchstart', 'beforeinput', 'input', 'compositionstart']) target.dispatchEvent(new Event(type));
  assert.equal(cancelled, 10); stop(); target.dispatchEvent(key('x')); assert.equal(cancelled, 10);
});
test('viewport interactions and passive prewarming have separate subscriptions', () => {
  const port = new GitDiffViewportPort(); let changes = 0; let interactions = 0;
  const off = port.onInteraction(() => interactions++); port.onChange(() => changes++);
  port.changed(); assert.equal(changes, 1); assert.equal(interactions, 0);
  port.interact(); assert.equal(interactions, 1); assert.equal(changes, 1);
  off(); port.interact(); assert.equal(interactions, 1);
});
