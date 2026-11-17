import { expect, test } from 'vitest';
import { webURLsFromArgs } from './web-launch';

test('launch arguments yield only HTTP(S) addresses, wherever Chromium leaves them', () => {
  expect(webURLsFromArgs(['/opt/setdown', 'https://example.com/a?b=1#c'])).toEqual(['https://example.com/a?b=1#c']);
  expect(webURLsFromArgs(['electron', '.', 'http://127.0.0.1:8080/'])).toEqual(['http://127.0.0.1:8080/']);
  expect(webURLsFromArgs(['setdown.exe', '--allow-file-access-from-files', '--', 'HTTPS://Example.com'])).toEqual(['https://example.com/']);
  expect(webURLsFromArgs(['/opt/setdown', 'https://a.example/', '/home/me/notes.md', 'https://b.example/', 'https://a.example/']))
    .toEqual(['https://a.example/', 'https://b.example/']);
});

test('switches, files, other schemes and credentials are never opened as pages', () => {
  expect(webURLsFromArgs(['/opt/setdown', '--url=https://example.com', '-https://example.com', '/tmp/https://example.com',
    'file:///home/me/page.html', 'javascript:alert(1)', 'ftp://example.com/', 'chrome://settings', 'https://user:secret@example.com/',
    'https://', 'http:example.com'])).toEqual([]);
  // The executable itself is never an address, even when it looks like one.
  expect(webURLsFromArgs(['https://example.com/'])).toEqual([]);
  expect(webURLsFromArgs(['/opt/setdown', ...Array.from({ length: 40 }, (_, index) => `https://example.com/${index}`)])).toHaveLength(16);
});
