import { expect, test } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { fileLocation, isFileLocation, readableFileLocation } from './file-location';

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
  for (const value of [' /tmp/a.md ', 'FILE:///tmp/a.md', 'C:\\a.pdf', '\\\\server\\share\\a.md', '~', '~/Documents']) expect(isFileLocation(value)).toBe(true);
  for (const value of ['https://example.org', 'localhost:3000', 'google.com', '한글 검색', '~user', '~ approx']) expect(isFileLocation(value)).toBe(false);
});
test.each([
  ['/home/user/Downloads/[붙임1] 컴퓨터공학부 학사졸업논문 작성지침-2 copy (3).pdf', 'file:///home/user/Downloads/[붙임1] 컴퓨터공학부 학사졸업논문 작성지침-2 copy (3).pdf'],
  ['/tmp/a # ? %20 + 한글.md', 'file:///tmp/a %23 %3F %2520 + 한글.md'],
  ['/tmp/literal\\backslash.txt', 'file:///tmp/literal%5Cbackslash.txt'],
  ['/tmp/ends with space ', 'file:///tmp/ends with space%20'],
  ['/tmp/zero\u200Bwidth\u00A0and\ttab.md', 'file:///tmp/zero%E2%80%8Bwidth%C2%A0and%09tab.md'],
  ['/tmp/"quoted" <angle> {brace} `tick` ^caret|pipe.md', 'file:///tmp/"quoted" <angle> {brace} `tick` ^caret|pipe.md'],
])('the address bar shows file names readably and still names the same file: %s', (path, shown) => {
  expect(readableFileLocation(fileLocation(path))).toBe(shown);
  expect(fileURLToPath(shown)).toBe(path);
});
test('readable file locations keep what is not a UTF-8 file name', () => {
  // A query or fragment (a PDF page) is not part of the name; a web address is not a file.
  expect(readableFileLocation('file:///tmp/%ED%95%9C%EA%B8%80.pdf#page=4&q=%ED%95%9C')).toBe('file:///tmp/한글.pdf#page=4&q=%ED%95%9C');
  expect(readableFileLocation('https://ko.wikipedia.org/wiki/%ED%95%9C%EA%B8%80')).toBe('https://ko.wikipedia.org/wiki/%ED%95%9C%EA%B8%80');
  expect(readableFileLocation('file:///tmp/latin1-%E9.txt')).toBe('file:///tmp/latin1-%E9.txt');
  expect(readableFileLocation('file:///C:/Users/A%20B/%ED%95%9C%EA%B8%80.pdf')).toBe('file:///C:/Users/A B/한글.pdf');
  expect(readableFileLocation('/tmp/plain path')).toBe('/tmp/plain path');
});
