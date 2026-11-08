import { describe, expect, it } from 'vitest';
import { ByteCache } from './byte-cache';
describe('recomputable byte cache', () => {
  it('evicts the least recently used value by bytes and rejects oversized replacements', () => {
    const cache = new ByteCache<string, string>(10, 3);
    cache.set('a', 'a', 4); cache.set('b', 'b', 4); expect(cache.get('a')).toBe('a');
    cache.set('c', 'c', 4); expect(cache.get('b')).toBeUndefined(); expect(cache.bytes).toBe(8);
    cache.set('a', 'large', 11); expect(cache.get('a')).toBeUndefined(); expect(cache.bytes).toBe(4);
    cache.trim(); expect(cache.size).toBe(0); expect(cache.bytes).toBe(0);
  });
  it('bounds zero-cost entries too', () => {
    const cache = new ByteCache<number, number>(10, 2);
    for (let i = 0; i < 100; i++) cache.set(i, i, 0);
    expect(cache.size).toBe(2); expect(cache.get(97)).toBeUndefined();
  });
});
