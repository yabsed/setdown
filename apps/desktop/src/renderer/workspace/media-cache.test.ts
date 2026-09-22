import { expect, it } from 'vitest';
import { MediaCache } from './media-cache';
import { createWorkspaceTab } from '../../core/workspace/workspace-state';

const tab = (id: string) => createWorkspaceTab(id, { kind: 'pdf', path: `/${id}.pdf`, name: id,
  text: '', savedText: '', revision: 0, savedRevision: 0, isUntitled: false,
  diskVersion: { size: 100, mtimeMs: 1 } }, 'pdf', { sourceLine: 1, yRatio: 0, reason: 'empty-document', confidence: 'fallback' });

it('retains visited identities, evicts the least recently used surface, and restores its latest position', () => {
  const tabs = ['a', 'b', 'c', 'd'].map(tab), cache = new MediaCache();
  const first = cache.sync(tabs, 'a')[0];
  cache.sync(tabs, 'b'); cache.sync(tabs, 'c');
  expect(cache.sync(tabs, 'a').at(-1)).toBe(first);
  expect(cache.sync(tabs, null)).toHaveLength(3);
  expect(cache.sync(tabs, 'd').map((entry) => entry.id)).toEqual(['c', 'a', 'd']);
  tabs[1].readingPosition = { kind: 'pdf', page: 8, left: 0, top: 5, zoom: 1.5, rotation: 90 };
  expect(cache.sync(tabs, 'b').at(-1)?.position).toEqual(tabs[1].readingPosition);
});

it('invalidates closed, replaced and renamed surfaces without mounting unvisited background tabs', () => {
  const tabs = ['a', 'b'].map(tab), cache = new MediaCache();
  expect(cache.sync(tabs, null)).toEqual([]);
  const first = cache.sync(tabs, 'a')[0];
  tabs[0].document = { ...tabs[0].document, diskVersion: { size: 200, mtimeMs: 2 } };
  expect(cache.sync(tabs, 'a')[0].key).not.toBe(first.key);
  tabs[0].document.path = '/renamed.pdf';
  expect(cache.sync(tabs, null)).toEqual([]);
  cache.sync(tabs, 'b');
  expect(cache.sync([tabs[0]], null)).toEqual([]);
});

it('pins every visible group even beyond cache capacity and evicts hidden readers first', () => {
  const tabs = ['a', 'b', 'c', 'd', 'e'].map(tab), cache = new MediaCache();
  const pinned = ['a', 'b', 'c', 'd'];
  expect(cache.sync(tabs, 'd', pinned).map(entry => entry.id)).toEqual(pinned);
  expect(cache.sync(tabs, 'e', ['a', 'b', 'e']).map(entry => entry.id)).toEqual(['a', 'b', 'e']);
});
