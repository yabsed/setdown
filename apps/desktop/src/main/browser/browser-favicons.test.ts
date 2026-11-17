import { expect, test, vi } from 'vitest';
import { BrowserFavicons } from './browser-favicons';

const png = (text = 'png') => new Response(new TextEncoder().encode(text), { headers: { 'content-type': 'image/png' } });
const decoded = (bytes: Uint8Array, type: string) => Promise.resolve(`decoded:${type}:${new TextDecoder().decode(bytes)}`);

test('falls back to the next declared icon and labels only SVG for the decoder', async () => {
  const fetch = vi.fn(async (url: string) => url.endsWith('32.png') ? new Response('missing', { status: 404 })
    : url.endsWith('.svg') ? new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }) : png());
  const favicons = new BrowserFavicons(fetch, decoded);
  expect(await favicons.resolve(['https://a.example/favicon.ico', 'https://a.example/icon.svg', 'https://a.example/icon-32.png'])).toBe('decoded:image/svg+xml:<svg/>');
  expect(fetch.mock.calls.map(call => call[0])).toEqual(['https://a.example/icon-32.png', 'https://a.example/icon.svg']);
  expect(await favicons.resolve(['https://a.example/favicon.ico'])).toBe('decoded::png');
  expect(await favicons.resolve([])).toBeNull();
});

test('an icon is fetched once for all tabs, and a failure is asked again later', async () => {
  let online = false;
  const fetch = vi.fn(async () => { if (!online) throw Error('offline'); return png('icon'); });
  const favicons = new BrowserFavicons(fetch, decoded);
  expect(await favicons.resolve(['https://a.example/favicon.ico'])).toBeNull();
  online = true;
  const [first, second] = await Promise.all([favicons.resolve(['https://a.example/favicon.ico']), favicons.resolve(['https://a.example/favicon.ico'])]);
  expect(first).toBe('decoded::icon'); expect(second).toBe(first);
  await favicons.resolve(['https://a.example/favicon.ico']);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('oversized, empty and undecodable icons yield no icon; data icons need no request', async () => {
  const fetch = vi.fn(async (url: string) => url.includes('huge') ? new Response(new Uint8Array(600 * 1024))
    : url.includes('empty') ? new Response(new Uint8Array(0)) : png('broken'));
  const favicons = new BrowserFavicons(fetch, async (bytes, type) => new TextDecoder().decode(bytes) === 'broken' ? null : decoded(bytes, type));
  expect(await favicons.resolve(['https://a.example/huge.png'])).toBeNull();
  expect(await favicons.resolve(['https://a.example/empty.png'])).toBeNull();
  expect(await favicons.resolve(['https://a.example/broken.png'])).toBeNull();
  fetch.mockClear();
  expect(await favicons.resolve([`data:image/png;base64,${btoa('inline')}`])).toBe('decoded::inline');
  expect(await favicons.resolve(['data:image/svg+xml,%3Csvg%2F%3E'])).toBe('decoded:image/svg+xml:<svg/>');
  expect(fetch).not.toHaveBeenCalled();
});
