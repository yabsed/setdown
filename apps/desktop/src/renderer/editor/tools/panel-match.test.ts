import { describe, expect, it } from 'vitest';
import { matchRank } from './panel-match';

describe('what a typed word finds in a list', () => {
  it('a name that says the word comes before a row that only mentions it in its description', () => {
    const rows = [
      { label: 'Choose a previous result list…', detail: 'Results · Search, symbols, diagnostics' },
      { label: 'Next function or class', detail: 'Navigation · Uses language-server symbol positions' },
      { label: 'Go to Symbol...', detail: 'Ctrl+Shift+O' },
      { label: 'Rename Symbol', detail: 'F2' },
    ];
    const found = rows.map((row, index) => ({ row, index, rank: matchRank('symbol', row.label, row.detail) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index).map(item => item.row.label);
    expect(found).toEqual(['Go to Symbol...', 'Rename Symbol', 'Choose a previous result list…', 'Next function or class']);
  });
  it('the start of the name, then the start of one of its words, then the inside of a word', () => {
    expect(matchRank('format', 'Format Document')).toBe(0);
    expect(matchRank('format', 'Toggle Format on Type')).toBe(1);
    expect(matchRank('format', 'Reformat tables')).toBe(2);
    expect(matchRank('format', 'Show effective settings', 'Settings · Values, sources, formatting')).toBe(3);
  });
  it('letters in order still find a row, after every row that says the word; nothing in common finds none', () => {
    expect(matchRank('gts', 'Go to Symbol...')).toBe(4);
    expect(matchRank('xyz', 'Go to Symbol...', 'Ctrl+Shift+O')).toBe(Infinity);
  });
  it('a word of another script starts where the one before it ends', () => {
    expect(matchRank('기호', '기호로 이동')).toBe(0);
    expect(matchRank('이동', '기호로 이동')).toBe(1);
    expect(matchRank('호로', '기호로 이동')).toBe(2);
  });
});
