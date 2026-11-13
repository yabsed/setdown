import type Dexie from 'dexie';
import type { Table } from 'dexie';
import type { BookmarkNode, BookmarkListing } from '../core/browser/bookmarks';
import type { PlaceRecord } from './min-places';

/** Bookmark folders are separate from URL visit history. All mutations share the
 * Places transaction queue; its search cache is published only after commit. */
export class BookmarkStore {
  private nodes: Table<BookmarkNode, string>;
  constructor(private db: Dexie, private places: Table<PlaceRecord, string>) { this.nodes = db.table('bookmarks'); }
  async list(parentId: string, query: string, offset: number): Promise<BookmarkListing> {
    const needle = query.trim().toLocaleLowerCase();
    const collection = needle ? this.nodes.filter(node => `${node.title}\n${node.url ?? ''}`.toLocaleLowerCase().includes(needle)) : this.nodes.where('parentId').equals(parentId);
    const total = await collection.count();
    const nodes = needle ? await collection.offset(offset).limit(100).toArray() : (await collection.sortBy('order')).slice(offset, offset + 100);
    const trail: BookmarkListing['trail'] = [];
    for (let id = parentId, depth = 0; id && depth++ < 40;) {
      const node = await this.nodes.get(id); if (!node) break;
      trail.unshift({ id: node.id, title: node.title }); id = node.parentId;
    }
    return { nodes, trail, total };
  }
  all(): Promise<BookmarkNode[]> { return this.nodes.toArray(); }
  async star(url: string, title: string, bookmarked: boolean) {
    if (!bookmarked) { await this.nodes.where('url').equals(url).delete(); return; }
    if (await this.nodes.where('url').equals(url).count()) return;
    await this.nodes.add({ id: crypto.randomUUID(), parentId: '', kind: 'bookmark', url, title, order: Date.now() });
  }
  async import(nodes: BookmarkNode[], batch: string) {
    const root: BookmarkNode = { id: batch, parentId: '', kind: 'folder', title: `Imported ${new Date().toLocaleString()}`, order: Date.now(), batch };
    await this.db.transaction('rw', this.nodes, this.places, async () => {
      const urls = [...new Set(nodes.flatMap(node => node.url ? [node.url] : []))];
      const old = await this.places.bulkGet(urls), titles = new Map(nodes.map(node => [node.url, node.title]));
      await this.places.bulkPut(urls.map((url, index) => ({ url, title: titles.get(url) || url, visitCount: 0, lastVisit: 0, ...old[index], isBookmarked: true })));
      await this.nodes.bulkAdd([root, ...nodes.map(node => ({ ...node, parentId: node.parentId || batch, batch }))]);
    });
  }
  async undo(batch: string) {
    await this.db.transaction('rw', this.nodes, this.places, async () => {
      const removed = await this.nodes.where('batch').equals(batch).toArray();
      await this.nodes.where('batch').equals(batch).delete();
      for (const url of new Set(removed.flatMap(node => node.url ? [node.url] : []))) {
        if (await this.nodes.where('url').equals(url).count()) continue;
        const place = await this.places.get(url);
        if (!place) continue;
        if (place.visitCount) await this.places.put({ ...place, isBookmarked: false });
        else await this.places.delete(url);
      }
    });
  }
}
