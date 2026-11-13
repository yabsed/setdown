export type BookmarkNode = { id: string; parentId: string; kind: 'folder' | 'bookmark'; title: string; url?: string; order: number; batch?: string };
export type BookmarkListing = { nodes: BookmarkNode[]; trail: Array<{ id: string; title: string }>; total: number };
export type BookmarkImportResult = { batch: string; added: number; skipped: number };
export type BookmarkExportResult = { path: string; bookmarks: number };

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

/**
 * The Netscape bookmark file other browsers import (the inverse of the HTML
 * import). The header is the one Chrome writes; every item ends with a line
 * break because Chrome ignores a file that has none between bookmarks.
 */
export function serializeBookmarks(nodes: BookmarkNode[]): string {
  const folders = new Set(nodes.filter(node => node.kind === 'folder').map(node => node.id));
  const children = new Map<string, BookmarkNode[]>();
  // An item whose folder no longer exists is kept at the top level rather than dropped.
  for (const node of nodes) {
    const parent = folders.has(node.parentId) ? node.parentId : '';
    children.set(parent, [...children.get(parent) ?? [], node]);
  }
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.', '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
  const visited = new Set<string>();
  const write = (parent: string, depth: number) => {
    const indent = '    '.repeat(depth);
    for (const node of [...children.get(parent) ?? []].sort((a, b) => a.order - b.order)) {
      if (node.kind === 'bookmark') { if (node.url) lines.push(`${indent}<DT><A HREF="${escapeHtml(node.url)}">${escapeHtml(node.title)}</A>`); continue; }
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      lines.push(`${indent}<DT><H3>${escapeHtml(node.title)}</H3>`, `${indent}<DL><p>`);
      write(node.id, depth + 1);
      lines.push(`${indent}</DL><p>`);
    }
  };
  write('', 1);
  lines.push('</DL><p>', '');
  return lines.join('\n');
}
