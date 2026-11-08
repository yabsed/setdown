import { expect, it } from 'vitest';
import { PreviewHtmlStore } from './preview-html-store';
it('serves oversized HTML after RAM eviction and protects a navigation lease', async () => {
  const store = new PreviewHtmlStore(8);
  try {
    store.put('large', 'a'.repeat(10000));
    const release = store.lease('large');
    store.put('recent', 'ok'); store.trim(new Set(['recent']), true);
    expect(store.bytes).toBe(0); expect(await store.get('large')).toBe('a'.repeat(10000));
    release(); store.trim(new Set(['recent']), true);
    expect(await store.get('large')).toBeNull(); expect(await store.get('recent')).toBe('ok');
  } finally { await store.dispose(); }
});
