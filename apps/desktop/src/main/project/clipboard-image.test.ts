import { expect, test } from 'vitest';
import { imageCandidates, pastedImageName } from './clipboard-image';

const raw = (mime: string) => `electron application/osclipboard;format="${mime}"`;
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);

test('PNG is preferred, and the standard type before the raw platform format', () => {
  // Firefox “Copy Image” on Linux: HTML first, then the same pixels in several encodings.
  const firefox = ['text/html', raw('text/_moz_htmlinfo'), raw('image/jpeg'), 'image/png', raw('image/png'), raw('image/bmp'), raw('TARGETS')];
  expect(imageCandidates(firefox).map(candidate => candidate.type)).toEqual(['image/png', raw('image/png'), raw('image/jpeg'), raw('image/bmp')]);
  expect(imageCandidates(['text/plain', 'text/uri-list', raw('x-special/gnome-copied-files')])).toEqual([]);
});

test('a source that offers only its original encoding keeps that format and extension', () => {
  expect(imageCandidates([raw('image/jpeg')]).map(candidate => candidate.format.extension)).toEqual(['.jpg']);
  expect(imageCandidates([raw('IMAGE/JPG')])[0].format.mime).toBe('image/jpeg');
  expect(imageCandidates([raw('image/x-MS-bmp'), raw('image/webp'), 'image/svg+xml']).map(candidate => candidate.format.extension)).toEqual(['.webp', '.bmp', '.svg']);
});

test('advertised formats are verified against the bytes they deliver', () => {
  const format = (mime: string) => imageCandidates([mime])[0].format;
  expect(format('image/png').valid(PNG)).toBe(true);
  expect(format('image/png').valid(new TextEncoder().encode('<html>not an image</html>'))).toBe(false);
  expect(format('image/png').valid(new Uint8Array())).toBe(false);
  expect(format('image/jpeg').valid(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
  expect(format('image/jpeg').valid(PNG)).toBe(false);
  expect(format('image/gif').valid(new TextEncoder().encode('GIF89a...'))).toBe(true);
  expect(format('image/webp').valid(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe(true);
  expect(format('image/svg+xml').valid(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true);
  expect(format('image/svg+xml').valid(new TextEncoder().encode('<p>svgs are nice</p>'))).toBe(false);
});

test('the copied image keeps its source file name, with the extension of the pasted bytes', () => {
  expect(pastedImageName('.png')).toBe('Pasted image.png');
  expect(pastedImageName('.png', '<meta charset="utf-8"><img src="https://example.com/a/cat%20photo.jpg?size=large&amp;v=2" alt="Cat">')).toBe('cat photo.png');
  expect(pastedImageName('.png', "<IMG alt='x' SRC='https://example.com/%ED%95%9C%EA%B8%80.webp'>")).toBe('한글.png');
  expect(pastedImageName('.jpg', '<img src=file:///home/me/Pictures/holiday.JPEG>')).toBe('holiday.jpg');
});

test('names that are not file names, or not safe ones, fall back to “Pasted image”', () => {
  for (const source of ['https://example.com/images?q=tbn:ANd9GcQ', 'https://example.com/media/F3xyz', 'data:image/png;base64,AAAA',
    'blob:https://example.com/0a1b', 'javascript:alert(1)//x.png', 'https://example.com/.png', 'https://example.com/..%2F..%2F.png',
    'https://example.com/CON.png', 'not a url.png', '']) {
    expect(pastedImageName('.png', `<img src="${source}">`), source).toBe('Pasted image.png');
  }
  expect(pastedImageName('.png', '<p>no image here</p>')).toBe('Pasted image.png');
  // A name can never leave the target folder or carry control characters.
  expect(pastedImageName('.png', '<img src="https://example.com/a%2F..%2Fb%00%0Ac%3A%3F.png">')).toBe('a .. b c.png');
  const long = pastedImageName('.png', `<img src="https://example.com/${'가'.repeat(200)}.png">`);
  expect(Buffer.byteLength(long)).toBeLessThanOrEqual(184);
  expect(long).toMatch(/^가+\.png$/);
});
