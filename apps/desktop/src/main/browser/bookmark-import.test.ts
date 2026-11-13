import { expect, test } from 'vitest';
import { parseBookmarks } from './bookmark-import';
import { serializeBookmarks, type BookmarkNode } from '../../core/browser/bookmarks';
const parse = (text: string) => parseBookmarks(new TextEncoder().encode(text));
test('Chrome and Firefox folder exports preserve Unicode, ordering and per-folder duplicates', () => {
  const result = parse('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>개발 &amp; 문서</H3><DL><DT><A HREF="https://example.com/a?x=1&amp;y=2">문서</A><DT><A HREF="https://example.com/a?x=1&amp;y=2">Duplicate</A><DT><H3>Nested</H3><DL><DT><A HREF="https://example.com/a?x=1&amp;y=2">Other folder</A></DL></DL><DT><A HREF="javascript:alert(1)">Unsafe</A><DT><A HREF="https://example.com/B">Last</A></DL>');
  expect(result.skipped).toBe(2);
  const [folder, link, nested, other, last] = result.nodes;
  expect(folder.title).toBe('개발 & 문서'); expect(link.parentId).toBe(folder.id);
  expect(nested.parentId).toBe(folder.id); expect(other.parentId).toBe(nested.id);
  expect(last.parentId).toBe(''); expect(last.url).toBe('https://example.com/B');
  expect(link.url).toBe(other.url); expect(link.url).toContain('x=1&y=2');
});
test('rejects oversized, excessively nested, unsupported and malformed inputs without executing them', () => {
  expect(() => parseBookmarks(new Uint8Array(10 * 1024 * 1024 + 1))).toThrow('10 MiB');
  expect(() => parse('<DL>'.repeat(40))).toThrow('deeply');
  expect(() => parse('not an export')).toThrow('HTML');
  expect(parse('<DL><A HREF="data:text/html,test">x</A><A HREF="https://user:secret@example.com">x</A><A HREF="file:///tmp/test">x</A></DL>').nodes).toEqual([]);
});
test('exported bookmark HTML is the import format: structure, order, Unicode and escaping survive a round trip', () => {
  const nodes: BookmarkNode[] = [
    { id: 'f', parentId: '', kind: 'folder', title: '개발 & <문서>', order: 2 },
    { id: 'b2', parentId: 'f', kind: 'bookmark', title: 'Second "quoted"', url: 'https://example.com/b?x=1&y=2', order: 5 },
    { id: 'b1', parentId: 'f', kind: 'bookmark', title: 'First', url: 'https://example.com/a', order: 1 },
    { id: 'n', parentId: 'f', kind: 'folder', title: 'Nested', order: 9 },
    { id: 'b3', parentId: 'n', kind: 'bookmark', title: '깊은 항목', url: 'https://example.com/c', order: 0 },
    { id: 'e', parentId: '', kind: 'folder', title: 'Empty', order: 3 },
    { id: 't', parentId: '', kind: 'bookmark', title: 'Top', url: 'https://example.com/top', order: 1 },
    // Its folder is gone: kept at the top level instead of being dropped.
    { id: 'o', parentId: 'missing', kind: 'bookmark', title: 'Orphan', url: 'https://example.com/orphan', order: 4 },
  ];
  const html = serializeBookmarks(nodes);
  expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>\n')).toBe(true);
  expect(html).toContain('<H3>개발 &amp; &lt;문서&gt;</H3>');
  expect(html).toContain('HREF="https://example.com/b?x=1&amp;y=2">Second &quot;quoted&quot;</A>');
  // Chrome only reads the file when each bookmark ends its own line.
  expect(html.split('\n').filter(line => line.includes('<A HREF=')).length).toBe(5);
  const parsed = parse(html);
  expect(parsed.skipped).toBe(0);
  const byId = new Map(parsed.nodes.map(node => [node.id, node]));
  const shape = parsed.nodes.map(node => [node.kind, node.title, node.url ?? '', byId.get(node.parentId)?.title ?? '']);
  expect(shape).toEqual([
    ['bookmark', 'Top', 'https://example.com/top', ''],
    ['folder', '개발 & <문서>', '', ''],
    ['bookmark', 'First', 'https://example.com/a', '개발 & <문서>'],
    ['bookmark', 'Second "quoted"', 'https://example.com/b?x=1&y=2', '개발 & <문서>'],
    ['folder', 'Nested', '', '개발 & <문서>'],
    ['bookmark', '깊은 항목', 'https://example.com/c', 'Nested'],
    ['folder', 'Empty', '', ''],
    ['bookmark', 'Orphan', 'https://example.com/orphan', ''],
  ]);
  expect(serializeBookmarks([])).toContain('<DL><p>\n</DL><p>');
});
