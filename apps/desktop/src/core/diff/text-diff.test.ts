import { describe, expect, test } from 'vitest';
import { textDiffHunks } from './text-diff';

describe('in-memory text diff hunks', () => {
  test('tracks a changed word on its source line', () => {
    expect(textDiffHunks('one\ntwo old\nthree', 'one\ntwo new\nthree')).toEqual([
      { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1 },
    ]);
  });

  test('tracks inserted and deleted lines without inventing context', () => {
    expect(textDiffHunks('one\nthree', 'one\ntwo\nthree')).toEqual([
      { oldStart: 2, oldLines: 0, newStart: 2, newLines: 1 },
    ]);
    expect(textDiffHunks('one\ntwo\nthree', 'one\nthree')).toEqual([
      { oldStart: 2, oldLines: 1, newStart: 2, newLines: 0 },
    ]);
  });

  test('keeps an edited line aligned above paragraphs inserted after it', () => {
    const original = ['same', '', 'first', 'second', 'changed', '', 'tail'].join('\n');
    const modified = [
      'same', '', 'first', 'second', 'changed ?', '', 'inserted one', '', 'inserted two', '', 'tail',
    ].join('\n');

    expect(textDiffHunks(original, modified)).toEqual([
      { oldStart: 5, oldLines: 1, newStart: 5, newLines: 5 },
    ]);
  });

  test('treats character-only edits as changes on both sides of the line', () => {
    expect(textDiffHunks('line', '!line')).toEqual([
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 },
    ]);
    expect(textDiffHunks('!line', 'line')).toEqual([
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 },
    ]);
  });
});
