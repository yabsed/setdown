import { expect, it } from 'vitest';
import { MemoryPolicy, MiB, memoryBudget } from './memory-policy';
it('reacts to pressure and requires sustained headroom before rebuilding caches', () => {
  const policy = new MemoryPolicy(), healthy = { total: 16 * 1024 * MiB, available: 8 * 1024 * MiB, appBytes: 500 * MiB };
  expect(policy.update(healthy, 0)).toBe('normal');
  expect(policy.update({ ...healthy, available: 400 * MiB }, 1)).toBe('critical');
  expect(policy.update(healthy, 2)).toBe('critical');
  expect(policy.update(healthy, 30_001)).toBe('critical');
  expect(policy.update(healthy, 30_002)).toBe('normal');
  expect(policy.update({ ...healthy, appBytes: memoryBudget(healthy.total) + 1 }, 40_000)).toBe('moderate');
  expect(policy.update({ ...healthy, stalled: 12 }, 40_001)).toBe('critical');
});
