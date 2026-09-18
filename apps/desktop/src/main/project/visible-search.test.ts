import { describe, expect, test } from 'vitest';
import { indexVisibleHtml, searchVisibleText } from './visible-search';

describe('visible project search', () => {
  const html = [
    '<h1 data-source-line="1">Finite-<strong>Dimensional</strong> Spaces</h1>',
    '<p data-source-line="3"><strong>Visible</strong> text</p>',
    '<span data-source-line="5" class="katex">',
    '<span class="katex-mathml"><math><annotation>\\frac{1}{2}</annotation></math></span>',
    '<span class="katex-html" aria-hidden="true"><span>1</span><span>2</span></span>',
    '</span>',
  ].join('');

  test('searches rendered text across markup boundaries', () => {
    expect(searchVisibleText(indexVisibleHtml(html), 'finite-dimensional', 10))
      .toMatchObject([{ line: 1, ordinal: 0 }]);
    expect(searchVisibleText(indexVisibleHtml(html), 'Visible', 10))
      .toMatchObject([{ line: 3, ordinal: 0 }]);
  });

  test('does not expose Markdown or hidden math source syntax', () => {
    const index = indexVisibleHtml(html);
    expect(searchVisibleText(index, '**', 10)).toEqual([]);
    expect(searchVisibleText(index, '\\frac', 10)).toEqual([]);
    expect(searchVisibleText(index, '12', 10)).toHaveLength(1);
  });
});
