import { afterEach, expect, test, vi } from 'vitest';
import { LanguageServiceSupervisor } from './language-supervisor';
afterEach(() => vi.useRealTimers());
test('recovery is delayed, bounded, independently scoped and cancelled when an owner closes', () => {
  vi.useFakeTimers();
  const supervisor = new LanguageServiceSupervisor(), reconnect = vi.fn();
  expect(supervisor.schedule('window:project:python', reconnect)?.attempt).toBe(1);
  expect(reconnect).not.toHaveBeenCalled(); vi.advanceTimersByTime(1000); expect(reconnect).toHaveBeenCalledTimes(1);
  expect(supervisor.schedule('window:project:python', reconnect)?.attempt).toBe(2); vi.advanceTimersByTime(3000);
  expect(supervisor.schedule('window:project:python', reconnect)?.attempt).toBe(3); vi.advanceTimersByTime(5000);
  expect(supervisor.schedule('window:project:python', reconnect)).toBeUndefined();
  expect(reconnect).toHaveBeenCalledTimes(3);
  expect(supervisor.schedule('other-window:project:python', reconnect)?.attempt).toBe(1);
  supervisor.cancel('other-window:project:python'); vi.advanceTimersByTime(10_000); expect(reconnect).toHaveBeenCalledTimes(3);
  supervisor.reset('window:project:python'); expect(supervisor.schedule('window:project:python', reconnect)?.attempt).toBe(1);
  supervisor.dispose(); vi.runAllTimers(); expect(reconnect).toHaveBeenCalledTimes(3);
});
test('a tool that takes twenty seconds to fail each time is given up on after three reconnections, not reconnected without end', () => {
  vi.useFakeTimers();
  const supervisor = new LanguageServiceSupervisor(), reconnect = vi.fn(), slow = 22_000;
  expect(supervisor.schedule('window:clojure-lsp', reconnect)?.attempt).toBe(1); vi.advanceTimersByTime(1000 + slow);
  expect(supervisor.schedule('window:clojure-lsp', reconnect)?.attempt).toBe(2); vi.advanceTimersByTime(3000 + slow);
  expect(supervisor.schedule('window:clojure-lsp', reconnect)?.attempt).toBe(3); vi.advanceTimersByTime(5000 + slow);
  // More than a minute after the first failure: it is still the fourth failure in a row.
  expect(supervisor.schedule('window:clojure-lsp', reconnect)).toBeUndefined();
  vi.advanceTimersByTime(slow); expect(supervisor.schedule('window:clojure-lsp', reconnect)).toBeUndefined();
  expect(reconnect).toHaveBeenCalledTimes(3);
});
test('a failure long after the last reconnection starts a new count', () => {
  vi.useFakeTimers();
  const supervisor = new LanguageServiceSupervisor(), reconnect = vi.fn();
  for (const attempt of [1, 2, 3]) { expect(supervisor.schedule('window:tool', reconnect)?.attempt).toBe(attempt); vi.advanceTimersByTime(6000); }
  expect(supervisor.schedule('window:tool', reconnect)).toBeUndefined();
  vi.advanceTimersByTime(10 * 60_000);
  expect(supervisor.schedule('window:tool', reconnect)?.attempt).toBe(1);
});
