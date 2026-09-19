import { describe, expect, test } from 'vitest';
import { selectSearchMatch } from './reader-tools';

describe('preview search targeting', () => {
  test('selects the exact occurrence when a source line contains repeated matches', () => {
    const spans = [
      { start: 3, end: 3 },
      { start: 8, end: 8 },
      { start: 8, end: 8 },
      { start: 12, end: 12 },
    ];
    expect(selectSearchMatch(spans, 8, 0, 1)).toBe(1);
    expect(selectSearchMatch(spans, 8, 1, 2)).toBe(2);
  });

  test('uses the document occurrence when rendered blocks lack an exact line anchor', () => {
    const spans = [{ start: 1, end: 1 }, { start: 1, end: 1 }, { start: 5, end: 5 }];
    expect(selectSearchMatch(spans, 3, 0, 1)).toBe(1);
  });

  test('uses the rendered occurrence as the exact project-search identity', () => {
    const spans = [{ start: 1, end: 5 }, { start: 3, end: 3 }, { start: 3, end: 3 }];
    expect(selectSearchMatch(spans, 3, 0, 2)).toBe(2);
  });
});
