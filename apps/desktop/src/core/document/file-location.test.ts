import { expect, test } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { fileLocation, isFileLocation } from './file-location';

test.each([
  "/home/user/Downloads/'26년 하반기 서울대 공학인재 인턴 JD_게시용.pdf",
  '/tmp/a # ? %20 + 한글.md',
  '/tmp/literal\\backslash.txt',
])('file locations round-trip reserved characters: %s', path => {
  expect(fileLocation(path)).toBe(pathToFileURL(path).href);
  expect(fileURLToPath(fileLocation(path))).toBe(path);
});
test('Windows drive and network locations retain their filesystem meaning', () => {
  expect(fileLocation('C:\\Users\\A B\\한글.pdf')).toBe('file:///C:/Users/A%20B/%ED%95%9C%EA%B8%80.pdf');
  expect(fileLocation('\\\\server\\share\\a #.md')).toBe('file://server/share/a%20%23.md');
});
test('address input distinguishes file locations from web addresses and searches', () => {
  for (const value of [' /tmp/a.md ', 'FILE:///tmp/a.md', 'C:\\a.pdf', '\\\\server\\share\\a.md']) expect(isFileLocation(value)).toBe(true);
  for (const value of ['https://example.org', 'localhost:3000', 'google.com', '한글 검색']) expect(isFileLocation(value)).toBe(false);
});
