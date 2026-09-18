import { describe, expect, test } from 'vitest';
import { searchHighlightParts } from './search-highlight';

describe('project search highlighting', () => {
  test('marks every case-insensitive occurrence without changing text', () => {
    expect(searchHighlightParts('Needle and NEEDLE.', 'needle')).toEqual([
      { text: 'Needle', match: true },
      { text: ' and ', match: false },
      { text: 'NEEDLE', match: true },
      { text: '.', match: false },
    ]);
  });

  test('treats regular-expression characters as plain text', () => {
    expect(searchHighlightParts('a+b and ab', 'a+b')[0]).toEqual({ text: 'a+b', match: true });
  });
});
