import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ExactPairCache } from './exact-pair-cache';

test('identical completed HTML skips recomputation, changed math does not', () => {
  const cache = new ExactPairCache<string>(8, 8192); let computations = 0;
  const get = (a: string, b: string) => cache.getOrCreate(a, b, () => `${++computations}`, () => 2);
  assert.equal(get('base', '<math>x</math>'), get('base', '<math>x</math>'));
  assert.notEqual(get('base', '<math>x</math>'), get('base', '<math>y</math>'));
  assert.equal(computations, 2);
});
test('pair identities cannot collide through separator characters', () => {
  const cache = new ExactPairCache<string>(8, 8192);
  assert.equal(cache.getOrCreate('a\0b', 'c', () => 'first', () => 10), 'first');
  assert.equal(cache.getOrCreate('a', 'b\0c', () => 'second', () => 10), 'second');
});
test('source line shifts and styling changes invalidate exact keys', () => {
  const cache = new ExactPairCache<number>(8, 8192); let count = 0;
  for (const html of ['<p data-source-line="1">a</p>', '<p data-source-line="2">a</p>', '<p class="dark">a</p>']) {
    cache.getOrCreate(html, '', () => ++count, () => 8);
  }
  assert.equal(count, 3);
});
test('LRU evicts old pairs, not the recently used sibling', () => {
  const cache = new ExactPairCache<number>(2, 8192); let count = 0;
  const get = (b: string) => cache.getOrCreate('a', b, () => ++count, () => 8);
  get('b'); get('c'); get('b'); get('d');
  assert.equal(get('b'), 1); assert.equal(get('c'), 4);
});
test('oversized values bypass caching and do not evict useful entries', () => {
  const cache = new ExactPairCache<number>(2, 200); let count = 0;
  const get = (a: string) => cache.getOrCreate(a, '', () => ++count, () => 8);
  get('a'); get('large'.repeat(100)); get('large'.repeat(100));
  assert.equal(get('a'), 1); assert.equal(count, 3);
});
test('byte budget evicts even below the entry-count limit', () => {
  const cache = new ExactPairCache<number>(10, 200); let count = 0;
  const get = (a: string) => cache.getOrCreate(a, '', () => ++count, () => 8);
  get('a'); get('b'); assert.equal(get('a'), 3);
});
test('exceptions never poison an entry and clear resets the cache', () => {
  const cache = new ExactPairCache<number>(8, 8192);
  assert.throws(() => cache.getOrCreate('a', 'b', () => { throw new Error('bad'); }, () => 8));
  assert.equal(cache.getOrCreate('a', 'b', () => 2, () => 8), 2);
  cache.clear(); assert.equal(cache.getOrCreate('a', 'b', () => 3, () => 8), 3);
});
