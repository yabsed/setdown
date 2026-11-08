import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: {} }));
import { cgroupHeadroom, meminfo, MemoryMonitor } from './memory-monitor';

it('reads available/PSS memory and treats unlimited or invalid cgroups as unknown', () => {
  expect(meminfo('MemFree: 100 kB\nMemAvailable: 5432 kB\n', 'MemAvailable')).toBe(5432 * 1024);
  expect(meminfo('Pss: 42 kB\n', 'Pss')).toBe(42 * 1024);
  expect(meminfo('Pss_Anon: 12 kB', 'Pss')).toBeUndefined();
  expect(cgroupHeadroom(300, '1024')).toBe(724);
  expect(cgroupHeadroom(2000, '1024')).toBe(0);
  expect(cgroupHeadroom(100, 'max')).toBeUndefined();
});
it('validates shell protection data and serializes overlapping samples', async () => {
  const reclaim = vi.fn(async () => {}), monitor = new MemoryMonitor(reclaim, () => ({ previews: 3 }));
  monitor.context(1, { visible: ['a', 'a'], protected: ['b'] });
  monitor.context(1, { visible: null, protected: [] });
  expect(monitor.contexts.get(1)).toEqual({ visible: ['a'], protected: ['b'] });
  const collect = vi.spyOn(monitor, 'collect').mockResolvedValue(monitor.snapshot);
  const first = monitor.sample(); expect(monitor.sample()).toBe(first);
  await first; expect(collect).toHaveBeenCalledTimes(1); expect(reclaim).toHaveBeenCalledTimes(1);
  monitor.stop(); expect(monitor.contexts.size).toBe(0);
});
