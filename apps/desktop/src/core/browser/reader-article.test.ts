import { describe, expect, test } from 'vitest';
import { readReaderAnchor, readReaderSnapshot } from './reader-article';

const anchor = { ordinal: 42, yRatio: 0.372, text: 'Third paragraph', scrollRatio: 0.25 };

describe('readReaderAnchor', () => {
  test('accepts a well-formed anchor and clamps ratios', () => {
    expect(readReaderAnchor(anchor)).toEqual(anchor);
    expect(readReaderAnchor({ ...anchor, yRatio: 2, scrollRatio: -1 })).toEqual({ ...anchor, yRatio: 1, scrollRatio: 0 });
  });

  test('rejects missing or non-integer ordinals', () => {
    expect(readReaderAnchor(null)).toBeNull();
    expect(readReaderAnchor({ ...anchor, ordinal: 1.5 })).toBeNull();
    expect(readReaderAnchor({ ...anchor, ordinal: -1 })).toBeNull();
    expect(readReaderAnchor({ yRatio: 0 })).toBeNull();
  });
});

describe('readReaderSnapshot', () => {
  const snapshot = { title: 'Title', byline: 'Author', siteName: 'Site', content: '<p>Body</p>', anchor };

  test('binds the article to the page URL actually extracted', () => {
    const result = readReaderSnapshot(snapshot, 'https://example.org/article');
    expect(result?.article).toEqual({
      url: 'https://example.org/article', title: 'Title', byline: 'Author', siteName: 'Site', content: '<p>Body</p>',
    });
    expect(result?.anchor).toEqual(anchor);
  });

  test('rejects malformed or oversized extraction output', () => {
    expect(readReaderSnapshot(null, 'https://example.org')).toBeNull();
    expect(readReaderSnapshot({ ...snapshot, content: 42 }, 'https://example.org')).toBeNull();
    expect(readReaderSnapshot({ ...snapshot, content: 'x'.repeat(5_000_001) }, 'https://example.org')).toBeNull();
    expect(readReaderSnapshot({ ...snapshot, anchor: null }, 'https://example.org')).toBeNull();
  });
});
