import { expect, test } from 'vitest';
import { webStoreId, webStoreURL } from './web-store';
const id = 'eimadpbcbfnmbkopoojfekhnkhdbieeh';
test('accepts current and legacy listing links and preserves the exact ID', () => {
  for (const value of [id, ` ${id}\n`, `https://chromewebstore.google.com/detail/dark-reader/${id}?hl=ko`,
    `https://chromewebstore.google.com/detail/${id}/`, `https://chrome.google.com/webstore/detail/dark-reader/${id}`]) {
    expect(webStoreId(value)).toBe(id);
  }
  expect(webStoreURL(id)).toBe(`https://chromewebstore.google.com/detail/${id}`);
});
test('rejects arbitrary hosts, protocols, credentials, malformed IDs and non-listing paths', () => {
  for (const value of [null, 42, 'a'.repeat(31), 'z'.repeat(32), 'x'.repeat(5000),
    `http://chromewebstore.google.com/detail/${id}`, `https://chromewebstore.google.com.evil.test/detail/${id}`,
    `https://user@chromewebstore.google.com/detail/${id}`, `https://chromewebstore.google.com:8443/detail/${id}`,
    `https://chromewebstore.google.com/search/${id}`, `https://evil.test/${id}`]) expect(() => webStoreId(value)).toThrow(/store/i);
});
