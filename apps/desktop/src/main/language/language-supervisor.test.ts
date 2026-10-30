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
