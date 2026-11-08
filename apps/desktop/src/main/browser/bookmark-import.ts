import { Parser } from 'htmlparser2';
import { randomUUID } from 'node:crypto';
import type { BookmarkNode } from '../../core/browser/bookmarks';

export function parseBookmarks(bytes: Uint8Array): { nodes: BookmarkNode[]; skipped: number } {
  if (bytes.length > 10 * 1024 * 1024) throw Error('Bookmark files must be smaller than 10 MiB.');
  const header = new TextDecoder().decode(bytes.subarray(0, 4096));
  const encoding = /charset\s*=\s*["']?([\w-]+)/i.exec(header)?.[1] ?? 'utf-8';
  let html: string;
  try { html = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw Error('Cannot decode this bookmark file. Export it as UTF-8 HTML.'); }
  if (!/NETSCAPE-Bookmark-file|<dl[\s>]/i.test(html)) throw Error('Choose a Chrome or Firefox bookmark HTML export.');
  const nodes: BookmarkNode[] = [], parents = [''];
  const orders = new Map<string, number>(), duplicates = new Set<string>();
  let skipped = 0, pending = '', tag = '', title = '', href = '', count = 0;
  const finish = () => {
    if (!tag) return;
    const parentId = parents.at(-1)!;
    const label = title.trim().slice(0, 1000);
    let url: string | undefined;
    if (tag === 'a') {
      try { const parsed = new URL(href); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Error(); url = parsed.href; }
      catch { skipped++; tag = ''; return; }
      const key = JSON.stringify([parentId, url]);
      if (duplicates.has(key)) { skipped++; tag = ''; return; }
      duplicates.add(key);
    }
    const node: BookmarkNode = { id: randomUUID(), parentId, kind: tag === 'h3' ? 'folder' : 'bookmark', title: label || url || 'Untitled folder', order: orders.get(parentId) ?? 0, ...(url ? { url } : {}) };
    orders.set(parentId, node.order + 1); nodes.push(node);
    if (nodes.length > 50_000) throw Error('Bookmark files may contain at most 50,000 items.');
    if (tag === 'h3') pending = node.id;
    tag = '';
  };
  const parser = new Parser({
    onopentag(name, attrs) {
      if (++count > 300_000) throw Error('Bookmark HTML is too complex.');
      if (name === 'dl') { finish(); parents.push(pending || parents.at(-1)!); pending = ''; if (parents.length > 34) throw Error('Bookmark folders are nested too deeply.'); }
      else if (name === 'h3' || name === 'a') { finish(); tag = name; title = ''; href = attrs.href ?? ''; }
      else if (name === 'dt') finish();
    },
    ontext(text) { if (tag) title += text.slice(0, Math.max(0, 1000 - title.length)); },
    onclosetag(name) { if (name === tag) finish(); if (name === 'dl') { finish(); if (parents.length > 1) parents.pop(); pending = ''; } },
  }, { decodeEntities: true });
  parser.end(html); finish();
  return { nodes, skipped };
}
