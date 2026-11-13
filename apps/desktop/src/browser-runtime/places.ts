import Dexie, { type Table } from 'dexie';
import { BookmarkStore } from './bookmarks';
import { searchMinPlaces, type PlaceRecord } from './min-places.js';
import type { BrowserPlace } from '../protocol/browser';

declare global { interface Window { placesHost: { connect(): void } } }
const db = new Dexie('setdown-browser-places');
db.version(1).stores({ places: '&url, visitCount, lastVisit' });
db.version(2).stores({ places: '&url, visitCount, lastVisit', bookmarks: '&id, parentId, url, batch' }).upgrade(async transaction => {
  const rows = await transaction.table('places').toArray() as PlaceRecord[];
  await transaction.table('bookmarks').bulkAdd(rows.filter(p => p.isBookmarked).map((p, order) => ({ id: crypto.randomUUID(), parentId: '', kind: 'bookmark', url: p.url, title: p.title, order })));
});
const places = db.table('places') as Table<PlaceRecord, string>;
const bookmarks = new BookmarkStore(db, places);
let cache: PlaceRecord[];
const loaded = places.toArray().then(rows => { cache = rows; });
let mutations = Promise.resolve();
const expose = (p: PlaceRecord): BrowserPlace => ({ url: p.url, title: p.title, bookmarked: p.isBookmarked, lastVisit: p.lastVisit, visits: p.visitCount });

window.addEventListener('message', function connected(event) {
  if (event.source !== window || event.data !== 'setdown:places-port' || !event.ports[0]) return;
  window.removeEventListener('message', connected);
  const port = event.ports[0];
  port.onmessage = async ({ data }) => {
    const { id, action, input } = data;
    try {
      await loaded;
      if (action === 'bookmark-list') {
        await mutations;
        port.postMessage({ id, result: await bookmarks.list(input.parentId, input.query, input.offset) });
      } else if (action === 'bookmark-export') {
        await mutations;
        port.postMessage({ id, result: await bookmarks.all() });
      } else if (action === 'bookmark-import' || action === 'bookmark-undo') {
        mutations = mutations.catch(() => {}).then(async () => {
          if (action === 'bookmark-import') await bookmarks.import(input.nodes, input.batch);
          else await bookmarks.undo(input.batch);
          cache = await places.toArray();
        });
        await mutations; port.postMessage({ id, result: null });
      } else if (action === 'search') {
        await mutations;
        const candidates = input.scope === 'history' ? cache.filter(p => p.visitCount > 0) : cache;
        const result = searchMinPlaces(candidates, input.query, { searchBookmarks: input.scope === 'bookmarks', limit: input.scope === 'history' ? Math.max(100, candidates.length) : 100 });
        if (input.scope === 'history') result.sort((a, b) => b.lastVisit - a.lastVisit);
        port.postMessage({ id, result: result.slice(0, 100).map(expose) });
      } else if (action === 'update') {
        mutations = mutations.catch(() => {}).then(async () => {
          const index = cache.findIndex(p => p.url === input.url);
          const previous = cache[index];
          const record: PlaceRecord = { url: input.url, title: input.title || previous?.title || input.url,
            isBookmarked: input.bookmarked ?? previous?.isBookmarked ?? false,
            lastVisit: input.visit ? Date.now() : previous?.lastVisit ?? 0,
            visitCount: (previous?.visitCount ?? 0) + (input.visit ? 1 : 0) };
          if (!record.isBookmarked && !record.visitCount) {
            await db.transaction('rw', places, db.table('bookmarks'), async () => {
              if (input.bookmarked !== undefined) await bookmarks.star(record.url, record.title, record.isBookmarked);
              await places.delete(record.url);
            });
            if (index >= 0) cache.splice(index, 1); return;
          }
          await db.transaction('rw', places, db.table('bookmarks'), async () => {
            if (input.bookmarked !== undefined) await bookmarks.star(record.url, record.title, record.isBookmarked);
            await places.put(record);
          });
          if (index === -1) cache.push(record); else cache[index] = record;
        });
        await mutations;
        port.postMessage({ id, result: null });
      } else if (action === 'delete-history') {
        // Serialize with visits/bookmarks, updating IndexedDB and Min's cache
        // together. Erasing visits must never erase a saved bookmark.
        mutations = mutations.catch(() => {}).then(async () => {
          const removed = cache.filter(p => input.url === undefined || p.url === input.url);
          const bookmarks = removed.filter(p => p.isBookmarked).map(p => ({ ...p, visitCount: 0, lastVisit: 0 }));
          await db.transaction('rw', places, async () => {
            await places.bulkDelete(removed.filter(p => !p.isBookmarked).map(p => p.url));
            await places.bulkPut(bookmarks);
          });
          const urls = new Set(removed.map(p => p.url));
          cache = cache.filter(p => !urls.has(p.url)).concat(bookmarks);
        });
        await mutations;
        port.postMessage({ id, result: null });
      } else throw new Error('Unknown places request');
    } catch (error) { port.postMessage({ id, error: String(error) }); }
  };
  port.start();
});
window.placesHost.connect();
// Min's 42-day retention, outside first search and never deleting bookmarks.
setTimeout(async () => {
  await loaded;
  mutations = mutations.catch(() => {}).then(async () => {
    const cutoff = Date.now() - 42 * 86400000;
    const obsolete = cache.filter(p => !p.isBookmarked && p.lastVisit < cutoff);
    await places.bulkDelete(obsolete.map(p => p.url));
    cache = cache.filter(p => p.isBookmarked || p.lastVisit >= cutoff);
  });
  await mutations.catch(console.error);
}, 20_000);
