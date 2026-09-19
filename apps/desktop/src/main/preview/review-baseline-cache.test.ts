import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ReviewBaselineCache } from './review-baseline-cache';

test('baseline reuse requires same text and complete render context', () => {
  const cache = new ReviewBaselineCache<string>();
  cache.set('review', 'base', 'path/theme/roots/epoch', '<p>base</p>', 100);
  assert.equal(cache.get('review', 'base', 'path/theme/roots/epoch'), '<p>base</p>');
  assert.equal(cache.get('review', 'new index', 'path/theme/roots/epoch'), undefined);
  assert.equal(cache.get('review', 'base', 'other/theme/roots/epoch'), undefined);
  cache.delete('review'); assert.equal(cache.get('review', 'base', 'path/theme/roots/epoch'), undefined);
});
test('imports/raw HTML/media/front matter bypass the cache', () => {
  const cache = new ReviewBaselineCache<string>();
  for (const text of ['@import "x.md"', '<img src="x">', '![image](x.png)', '!include x.md', '---\ntitle: X\n---', '```python {cmd=true}\n']) {
    cache.set('review', text, 'context', 'html', 10);
    assert.equal(cache.get('review', text, 'context'), undefined);
  }
});
test('baseline cache has a byte budget and LRU eviction', () => {
  const cache = new ReviewBaselineCache<string>(20, 2);
  cache.set('a', 'a', 'x', 'A', 10); cache.set('b', 'b', 'x', 'B', 10);
  assert.equal(cache.get('a', 'a', 'x'), 'A');
  cache.set('c', 'c', 'x', 'C', 10);
  assert.equal(cache.get('b', 'b', 'x'), undefined);
  cache.set('huge', 'huge', 'x', 'H', 21);
  assert.equal(cache.get('huge', 'huge', 'x'), undefined);
  cache.clear(); assert.equal(cache.get('a', 'a', 'x'), undefined);
});
