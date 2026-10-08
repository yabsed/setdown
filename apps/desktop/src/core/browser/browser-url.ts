/** Address-bar input is interpreted only at the trusted application boundary. */
export function browserURL(input: string): string {
  const value = input.trim();
  if (!value || value === 'about:blank') return 'about:blank';
  if (value.length > 16384) throw new Error('The address is too long.');
  if (/^[a-z][\w+.-]*:/i.test(value) && !/^localhost:\d/i.test(value) && !/^[\w.-]+\.\w+:\d/.test(value)) {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Open an HTTP or HTTPS address.');
    if (url.username || url.password) throw new Error('Use the website sign-in form instead of credentials in the address.');
    return url.href;
  }
  if (!/\s/.test(value) && (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value)
    || /^[\w\p{L}-]+(?:\.[\w\p{L}-]+)+(?:[:/].*)?$/u.test(value))) {
    return browserURL(`${/^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value) ? 'http' : 'https'}://${value}`);
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

export function isWebURL(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 16384) return false;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}
