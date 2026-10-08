import Dexie, { type Table } from 'dexie';
import { searchMinPlaces, type PlaceRecord } from './min-places.js';
import type { BrowserPlace } from '../protocol/browser';

declare global { interface Window { placesHost: { connect(): void } } }
const db = new Dexie('setdown-browser-places');
db.version(1).stores({ places: '&url, visitCount, lastVisit' });
const places = db.table('places') as Table<PlaceRecord, string>;
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
      if (action === 'search') {
        await mutations;
        const result = searchMinPlaces(cache, input.query, { searchBookmarks: input.bookmarksOnly, limit: 100 }).map(expose);
        port.postMessage({ id, result });
      } else if (action === 'update') {
        mutations = mutations.catch(() => {}).then(async () => {
          const index = cache.findIndex(p => p.url === input.url);
          const previous = cache[index];
          const record: PlaceRecord = { url: input.url, title: input.title || previous?.title || input.url,
            isBookmarked: input.bookmarked ?? previous?.isBookmarked ?? false,
            lastVisit: input.visit ? Date.now() : previous?.lastVisit ?? Date.now(),
            visitCount: (previous?.visitCount ?? 0) + (input.visit ? 1 : 0) };
          await places.put(record);
          if (index === -1) cache.push(record); else cache[index] = record;
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
