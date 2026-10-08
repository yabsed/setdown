import { describe, expect, it } from 'vitest';
import { browserURL, isWebURL } from './browser-url';

describe('browser addresses', () => {
  it.each([
    [' example.com/a?q=1 ', 'https://example.com/a?q=1'],
    ['localhost:5173/page', 'http://localhost:5173/page'],
    ['[::1]:8080', 'http://[::1]:8080/'],
    ['https://example.com', 'https://example.com/'],
    ['한글 검색', 'https://duckduckgo.com/?q=%ED%95%9C%EA%B8%80%20%EA%B2%80%EC%83%89'],
    ['', 'about:blank'],
  ])('normalizes %s at the application boundary', (input, expected) => {
    expect(browserURL(input)).toBe(expected);
  });
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello',
    'chrome-extension://unknown/page.html', 'https://user:secret@example.com'])('rejects privileged or credential-bearing input %s', input => {
    expect(() => browserURL(input)).toThrow();
  });
  it('only persists real HTTP(S) pages', () => {
    expect(isWebURL('https://example.com/path')).toBe(true);
    for (const input of [null, {}, 'about:blank', 'javascript:alert(1)', 'file:///tmp/test', 'not a url']) expect(isWebURL(input)).toBe(false);
  });
});
