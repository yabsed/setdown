import { afterEach, expect, test, vi } from 'vitest';
import { BrowserAuth } from './browser-auth';
const info = { isProxy: false, scheme: 'basic', host: 'example.com', port: 443, realm: 'Private' };
afterEach(() => vi.useRealTimers());
test('keeps concurrent challenges separate, rejects stale/foreign answers, and never broadcasts credentials', () => {
  vi.useFakeTimers(); const changed = vi.fn(), auth = new BrowserAuth(changed), a = vi.fn(), b = vi.fn();
  auth.request(1, 'a', 'https://example.com/private', info, a);
  auth.request(2, 'b', 'https://example.com/private', info, b);
  const token = changed.mock.calls[0][2].token;
  auth.respond(2, 'a', token, { username: 'u', password: 'secret' }); expect(a).not.toHaveBeenCalled();
  auth.respond(1, 'a', token, { username: 'u', password: 'secret' });
  expect(a).toHaveBeenCalledExactlyOnceWith('u', 'secret'); expect(b).not.toHaveBeenCalled();
  expect(JSON.stringify(changed.mock.calls)).not.toContain('secret');
  auth.clear('b'); expect(b).toHaveBeenCalledExactlyOnceWith(undefined, undefined);
  auth.respond(1, 'a', token, { username: 'u', password: 'secret' }); expect(a).toHaveBeenCalledTimes(1);
});
test('cancels duplicates, unsupported proxy auth and abandoned challenges', () => {
  vi.useFakeTimers(); const auth = new BrowserAuth(vi.fn()), a = vi.fn(), b = vi.fn(), proxy = vi.fn();
  auth.request(1, 'a', 'https://example.com/', info, a);
  auth.request(1, 'a', 'https://example.com/', info, b); expect(b).toHaveBeenCalledOnce();
  auth.request(1, 'proxy', 'https://example.com/', { ...info, isProxy: true }, proxy); expect(proxy).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(120_000); expect(a).toHaveBeenCalledExactlyOnceWith(undefined, undefined);
  expect(vi.getTimerCount()).toBe(0);
});
