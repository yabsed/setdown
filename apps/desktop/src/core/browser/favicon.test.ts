import { expect, test } from 'vitest';
import { dataIcon, declaredIcons, faviconCandidates, iconType } from './favicon';

test('prefers small bitmaps, then vectors, then the classic icon, and tries at most three', () => {
  expect(faviconCandidates(['https://a.example/favicon.ico', 'https://a.example/icon.svg', 'https://a.example/apple-touch-180.png',
    'https://a.example/favicon-32x32.png?v=2', 'https://a.example/mask'])).toEqual([
    'https://a.example/favicon-32x32.png?v=2', 'https://a.example/icon.svg', 'https://a.example/apple-touch-180.png']);
  expect(faviconCandidates(['https://a.example/favicon.ico', 'https://a.example/favicon.ico'])).toEqual(['https://a.example/favicon.ico']);
  expect(faviconCandidates(['https://a.example/b.png', 'https://a.example/a.png'])).toEqual(['https://a.example/b.png', 'https://a.example/a.png']);
  expect(faviconCandidates(['data:image/png;base64,AAAA', 'https://a.example/favicon-32x32.png'])[0]).toBe('data:image/png;base64,AAAA');
});

test('ignores icons that are not web or image data addresses, and oversized ones', () => {
  expect(faviconCandidates(['file:///etc/passwd', 'javascript:alert(1)', 'chrome://favicon/', 'data:text/html,<p>', 'blob:https://a.example/1',
    `https://a.example/${'a'.repeat(5000)}.png`, `data:image/png;base64,${'A'.repeat(100_000)}`, 42 as unknown as string])).toEqual([]);
});

test('decodes base64 and percent-encoded data icons and rejects malformed ones', () => {
  expect(dataIcon('data:image/png;base64,iVBORw==')).toEqual({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), type: 'image/png' });
  const svg = dataIcon('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E');
  expect(svg?.type).toBe('image/svg+xml');
  expect(new TextDecoder().decode(svg!.bytes)).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  for (const url of ['data:text/html;base64,AAAA', 'data:image/png;base64,***', 'data:image/png;base64,', 'data:image/svg+xml,%E0%A4%A', 'https://a.example/a.png'])
    expect(dataIcon(url)).toBeNull();
});

test('only SVG needs a declared type', () => {
  expect(iconType('https://a.example/icon', 'image/svg+xml; charset=utf-8')).toBe('image/svg+xml');
  expect(iconType('https://a.example/icon.SVG?v=1', null)).toBe('image/svg+xml');
  expect(iconType('https://a.example/favicon.ico', 'image/x-icon')).toBe('');
  expect(iconType('https://a.example/svg/icon.png', 'text/html')).toBe('');
});

test('a page is asked for the icons it declares, and a page that names none has the site’s favicon.ico', () => {
  const ask = (links: string[], selectors: string[] = []) => new Function('document', 'location', `return ${declaredIcons}`)(
    { querySelectorAll: (selector: string) => { selectors.push(selector); return links.map(href => ({ href })); } }, { href: 'https://site.example/a/page?q=1' }) as string[];
  const selectors: string[] = [];
  expect(ask(['https://site.example/icon.png', 'https://cdn.example/icon.svg'], selectors)).toEqual(['https://site.example/icon.png', 'https://cdn.example/icon.svg']);
  // `icon` as one word of rel, in any case: "shortcut icon" counts, "apple-touch-icon" and "mask-icon" are other words.
  expect(selectors).toEqual(['link[rel~="icon" i][href]']);
  expect(ask([])).toEqual(['https://site.example/favicon.ico']);
  expect(ask(Array.from({ length: 40 }, (_, index) => `https://site.example/${index}.png`))).toHaveLength(16);
});
