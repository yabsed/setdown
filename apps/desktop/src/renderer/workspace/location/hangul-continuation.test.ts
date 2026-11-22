import { expect, test } from 'vitest';
import { hangulContinuation } from './hangul-continuation';

// The suggestion search compares decomposed (NFD) text, so that is what must line up.
const startsWord = (typed: string, word: string) => word.normalize('NFD').startsWith(hangulContinuation(typed)!.normalize('NFD'));

test('a syllable ending in a consonant is the beginning of the words that take it as their next initial', () => {
  // 무한도전 as a two-set keyboard produces it: each of these states appears while typing.
  for (const typed of ['ㅁ', '뭏', '무한ㄷ', '무한돚']) expect(startsWord(typed, '무한도전')).toBe(true);
  expect(startsWord('뭏', '무호흡')).toBe(true);
  expect(startsWord('뭏', '무선')).toBe(false);
  // A double final gives up only its second consonant.
  expect(startsWord('핝', '한정')).toBe(true);
  expect(startsWord('핝', '하늘')).toBe(false);
  expect(startsWord('값', '갑시다')).toBe(true);
  expect(startsWord('주소 젠ㅅ', '주소 젠슨')).toBe(true);
});

test('text that does not end in such a consonant has no continuation', () => {
  for (const typed of ['', '무', '무하', 'setdown', '무한 ', 'ㅏ', '한a', 'ㄳ']) expect(hangulContinuation(typed)).toBeUndefined();
});
