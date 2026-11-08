import { expect, test } from 'vitest';
import { parseBookmarks } from './bookmark-import';
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
