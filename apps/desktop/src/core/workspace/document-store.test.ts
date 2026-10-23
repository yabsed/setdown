import { describe, expect, it, vi } from 'vitest';
import { DocumentStore } from './document-store';
import type { DocumentSnapshot } from '../document/document';

const snapshot = (path = '/a.txt'): DocumentSnapshot => ({ path, name: 'a.txt', text: 'disk', savedText: 'disk',
  revision: 0, savedRevision: 0, isUntitled: false, diskVersion: { mtimeMs: 1, size: 4 } });

describe('document ownership independently of views', () => {
  it('coalesces concurrent ordinary/review acquisition without a hidden tab', async () => {
    const store = new DocumentStore();
    const read = vi.fn(async () => snapshot());
    const [a, b] = await Promise.all([store.acquire('/a.txt', 'file-view', read), store.acquire('/a.txt', 'review-view', read)]);
    expect(read).toHaveBeenCalledTimes(1); expect(a).toBe(b);
    expect([...a.references]).toEqual(['file-view', 'review-view']);
    a.text = 'unsaved'; a.revision++;
    expect(store.adopt(snapshot()).text).toBe('unsaved');
    const released = vi.fn(); store.onRelease(released);
    store.release(a.id, 'file-view'); expect(released).not.toHaveBeenCalled();
    store.release(a.id, 'review-view'); expect(released).toHaveBeenCalledWith(a);
    expect(store.documents).toEqual([]);
  });
  it('shares text and save metadata while keeping view identities independent', () => {
    const store = new DocumentStore();
    const a = { id: 'a', document: snapshot(), text: 'disk', revision: 0 };
    const b = { ...a, id: 'b', document: snapshot() };
    store.attach(a); store.attach(b);
    a.text = 'changed'; a.revision = 4;
    b.document = { ...b.document, path: '/renamed.txt', savedText: 'changed', savedRevision: 4 };
    expect(b.text).toBe('changed'); expect(b.revision).toBe(4);
    expect(a.document.path).toBe('/renamed.txt'); expect(a.id).toBe('a'); expect(b.id).toBe('b');
    expect(store.find('/a.txt')).toBeUndefined(); expect(store.find('/renamed.txt')).toBeDefined();
  });
  it('clears failed acquisitions so a later read can succeed', async () => {
    const store = new DocumentStore();
    await expect(store.acquire('/a.txt', 'a', async () => { throw Error('unavailable'); })).rejects.toThrow('unavailable');
    expect(store.documents).toEqual([]);
    expect((await store.acquire('/a.txt', 'a', async () => snapshot())).text).toBe('disk');
  });
});
