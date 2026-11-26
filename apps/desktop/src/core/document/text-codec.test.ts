import { describe, expect, test } from 'vitest';
import { decodeTextBytes, TextStreamCheck, TextStreamDecoder } from './text-codec';

const bytes = (text: string) => new TextEncoder().encode(text);
/** Decode in pieces of `size` bytes: the text and format, or the refusal. */
function streamed(input: Uint8Array, size: number) {
  try {
    const decoder = new TextStreamDecoder();
    let text = '';
    for (let offset = 0; offset < input.length; offset += size) text += decoder.write(input.subarray(offset, offset + size));
    const { encoding, eol } = decoder.end();
    return { text, encoding, eol };
  } catch (error) { return (error as Error).message; }
}
function whole(input: Uint8Array) {
  try { return decodeTextBytes(input); } catch (error) { return (error as Error).message; }
}

describe('a text decoded in pieces', () => {
  const cases: [string, Uint8Array][] = [
    ['LF text', bytes('{"a":1}\n{"b":"한글 🙂"}\n')],
    ['CRLF text', bytes('first\r\nsecond 한글\r\nthird\r\n')],
    ['no line ending', bytes('one long line without an end 🙂🙂🙂')],
    ['byte order mark', new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('marked\r\ntext\r\n')])],
    ['tabs and form feed', bytes('a\tb\fc\n')],
    ['mixed endings', bytes('a\r\nb\nc\r\n')],
    ['mixed endings, LF first', bytes('a\nb\r\nc\n')],
    ['bare CR', bytes('a\rb\n')],
    ['bare CR at the end', bytes('a\r\nb\r')],
    ['NUL', bytes('a\0b\n')],
    ['control character', bytes('a\u0001b\n')],
    ['invalid UTF-8', new Uint8Array([0x61, 0xc3, 0x28, 0x0a])],
    ['UTF-8 cut off at the end', new Uint8Array([0x61, 0x0a, 0xed, 0x95])],
    ['UTF-16', new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x0a, 0x00])],
    ['two bytes', bytes('ab')],
    ['empty', new Uint8Array(0)],
  ];
  // Every piece size puts each boundary inside a CRLF pair and inside a multi-byte character at least once.
  for (const [name, input] of cases) test(`${name}: every piece size agrees with the whole`, () => {
    const expected = whole(input);
    for (const size of [1, 2, 3, 4, 5, 7, 64]) expect(streamed(input, size), `pieces of ${size}`).toEqual(expected);
  });

  test('counts lines as an editor does', () => {
    const check = new TextStreamCheck();
    for (const piece of ['a\r', '\nb\r\n', 'c']) check.accept(piece);
    expect(check.end()).toBe('crlf');
    expect(check.lines).toBe(3);
  });

  test('a save refuses text that could not be opened again', () => {
    const mixed = new TextStreamCheck();
    mixed.accept('a\r\n');
    expect(() => mixed.accept('b\n')).toThrow(/Mixed line endings/);
    const cut = new TextStreamCheck();
    cut.accept('a\r');
    expect(() => cut.end()).toThrow(/Bare CR/);
    expect(() => new TextStreamCheck().accept('a\0')).toThrow(/binary/);
  });
});
