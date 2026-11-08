import { afterEach, expect, test, vi } from 'vitest';
import { LanguageSessionPool } from './language-session-pool';
afterEach(() => vi.useRealTimers());
const server = () => ({ stop: vi.fn(async () => {}) });
test('shares a context across distinct documents and retains isolation for environments and duplicate URI owners', async () => {
  const pool = new LanguageSessionPool(), create = vi.fn(server);
  const a = pool.acquire('1:root:envA', 'a.ipynb', create), b = pool.acquire('1:root:envA', 'b.ipynb', create);
  const duplicate = pool.acquire('1:root:envA', 'a.ipynb', create), other = pool.acquire('1:root:envB', 'c.ipynb', create);
  expect(a.server).toBe(b.server); expect(a.server).not.toBe(duplicate.server); expect(a.server).not.toBe(other.server);
  a.release(); expect(b.server.stop).not.toHaveBeenCalled();
  b.release(); duplicate.release(); other.release(); await pool.dispose();
  expect(create).toHaveBeenCalledTimes(3); for (const result of create.mock.results) expect(result.value.stop).toHaveBeenCalledOnce();
});
test('tab return reuses the process; idle eviction, expiry and owner shutdown are bounded', async () => {
  vi.useFakeTimers(); const pool = new LanguageSessionPool(30_000, 1);
  const a = pool.acquire('1:envA', 'a', server); a.release(); await vi.advanceTimersByTimeAsync(10_000);
  const warm = pool.acquire('1:envA', 'a', server); expect(warm.server).toBe(a.server); warm.release();
  const b = pool.acquire('2:envB', 'b', server); b.release(); expect(a.server.stop).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_000); expect(b.server.stop).toHaveBeenCalledOnce();
  const c = pool.acquire('1:envA', 'c', server), d = pool.acquire('2:envB', 'd', server);
  await pool.dispose('1:'); expect(c.server.stop).toHaveBeenCalledOnce(); expect(d.server.stop).not.toHaveBeenCalled();
  c.release(); d.release(); await pool.dispose(); expect(pool.running).toBe(false);
});
test('retired analysis never accepts another document, and late release cannot stop its replacement', async () => {
  const pool = new LanguageSessionPool(), a = pool.acquire('context', 'a', server);
  pool.invalidate(a.server); const next = pool.acquire('context', 'a', server);
  expect(next.server).not.toBe(a.server); a.release(); expect(a.server.stop).toHaveBeenCalledOnce();
  expect(next.server.stop).not.toHaveBeenCalled(); next.release(); await pool.dispose();
});
