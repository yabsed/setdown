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
});
