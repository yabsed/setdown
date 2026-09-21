import { expect, test } from 'vitest';
import { ownScrollSettlement } from './scroll-settlement';

test('layout can settle repeatedly until a subsequent scroll supersedes its position', () => {
  let y = 0, target = 100;
  const settle = ownScrollSettlement(() => [0, y], () => { y = target; });
  settle(); expect(y).toBe(100);
  target = 120; settle(); expect(y).toBe(120);
  y = 5000; settle(); expect(y).toBe(5000);
  // Returning to the old offset cannot revive the obsolete request.
  y = 120; target = 150; settle(); expect(y).toBe(120);
});
test('new position commands retain ownership against older settlement timers', () => {
  let x = 0, y = 0;
  const old = ownScrollSettlement(() => [x, y], () => { x = 50; y = 100; });
  old();
  const current = ownScrollSettlement(() => [x, y], () => { x = 200; y = 400; });
  current(); old();
  expect([x, y]).toEqual([200, 400]);
});
