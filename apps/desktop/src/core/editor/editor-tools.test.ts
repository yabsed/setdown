import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
import { taskLocations } from './task-locations';
import { CopyStore } from './copy-store';
import { ResultHistory } from './result-history';
import { textTarget, disjointSpans } from './text-targets';
import { changeInteger, reflowParagraph, sortLines } from './text-transforms';

test('copies preserve CRLF, cursor fragments, named append and the last explicit copy after cutting', () => {
  const copies = new CopyStore(); const a = copies.add(['한글 😄\r\n', 'second\r\n'], 'lines', '/a.md')!;
  copies.name(a.id, 'Experiment'); copies.add(['deleted'], 'characters', '/a.md', true);
  expect(copies.lastCopy).toBe(a.id); expect(copies.paste(a.id, 2)).toEqual(a.fragments);
  expect(() => copies.paste(a.id, 3)).toThrow('3 cursors');
  copies.append(a.id, ['more\r\n', 'last\r\n'], 'lines'); expect(copies.paste(a.id, 2)[0]).toBe('한글 😄\r\nmore\r\n');
  expect(() => copies.append(a.id, ['x'], 'characters')).toThrow('same selection shape');
});
test('result snapshots retain their own selections and source after filtering and later searches', () => {
  const history = new ResultHistory(); const a = history.add({ title: 'A', query: 'a', provider: 'search', root: '/p', group: 'left', truncated: false,
    entries: [{ label: 'one', detail: '', location: { path: '/p/a.md', line: 1, column: 1 } }, { label: 'two', detail: '' }] });
  history.pin(a.id, true); a.selected = 1;
  history.add({ ...a, title: 'B', entries: [] }); expect(history.move('left', -1)).toBe(a); expect(a.selected).toBe(1);
  const filtered = history.filter(a.id, 'one'); expect(filtered.entries).toHaveLength(1); expect(a.entries).toHaveLength(2);
  history.markStale('/p/a.md'); expect(a.stale).toBe(true); expect(filtered.stale).toBe(true);
  expect(history.list('right')).toEqual([]);
});
test('quote and word targets use UTF-16 offsets without splitting emoji or combining marks', () => {
  const source = 'name = "한글 😄 \\"quoted\\" é";';
  const span = textTarget(source, source.indexOf('😄'), 'quote')!;
  expect(source.slice(span.start, span.end)).toBe('한글 😄 \\"quoted\\" é');
  expect(textTarget('""', 1, 'quote')).toEqual({ start: 1, end: 1 });
  expect(textTarget('"broken', 4, 'quote')).toBeNull();
  const word = textTarget('é 이름', 1, 'word')!; expect('é 이름'.slice(word.start, word.end)).toBe('é');
});
test('Markdown sections use parsed headings and ignore fence lookalikes', () => {
  const source = '# A\nbody\n```md\n# fake\n```\n## child\nmore\n# B\ntail\n';
  const section = textTarget(source, source.indexOf('body'), 'section', true)!;
  expect(source.slice(section.start, section.end)).toBe(source.slice(0, source.indexOf('# B')));
  expect(textTarget(source, source.indexOf('# fake'), 'link-label')).toBeNull();
  const link = '[한글 [label]](a(b).md)';
  const target = textTarget(link, 4, 'link-destination')!; expect(link.slice(target.start, target.end)).toBe('a(b).md');
  expect(() => disjointSpans([{ start: 0, end: 3 }, { start: 1, end: 4 }])).toThrow('overlap');
});
test('integer edits preserve prefixes and padding and never infer octal or overflowing numbers', () => {
  expect(changeInteger('x = -009', 4, 1)?.text).toBe('-008');
  expect(changeInteger('x = 0x00ff', 4, 1)?.text).toBe('0x0100');
  expect(changeInteger('9007199254740993', 0, 1)?.text).toBe('9007199254740994');
  expect(changeInteger('abc12', 0, 1)).toBeNull();
});
test('line transforms preserve line endings and Markdown hard breaks', () => {
  expect(sortLines('a10\r\na2\r\n', 'numeric', '\r\n')).toBe('a2\r\na10\r\n');
  expect(sortLines('b\na\nb\n', 'stable-unique')).toBe('b\na\n');
  expect(() => reflowParagraph('keep hard break  \nnext', 30)).toThrow('hard line breaks');
  expect(reflowParagraph('one two three four five six seven eight nine ten', 20).split('\n').every(line => line.length <= 20)).toBe(true);
});

test('full pinned stores reject new values without losing the current entry', () => {
  const copies = new CopyStore(1); const first = copies.add(['original'], 'characters', '/a')!;
  copies.pin(first.id, true);
  assert.throws(() => copies.add(['next'], 'characters', '/a'));
  assert.equal(copies.lastCopy, first.id); assert.equal(copies.list()[0].fragments[0], 'original');
  const results = new ResultHistory(1);
  const old = results.add({ title: 'First', entries: [], provider: 'search', root: '/', query: '', group: 'one', truncated: false }); results.pin(old.id, true);
  assert.throws(() => results.add({ title: 'Second', entries: [], provider: 'search', root: '/', query: '', group: 'one', truncated: false }));
  assert.equal(results.current('one')?.id, old.id);
});

test('link destination edits preserve angle brackets and titles and reject malformed titles', () => {
  for (const [text, target] of [['[label](path(a).md "keep title")', 'path(a).md'], ['[label](<한글 path.md> "keep (title)")', '한글 path.md'], ['[label]()', '']]) {
    const span = textTarget(text, 3, 'link-destination'); expect(span).not.toBeNull(); expect(text.slice(span!.start, span!.end)).toBe(target);
  }
  expect(textTarget('[x](target "unterminated)', 2, 'link-destination')).toBeNull();
});

test('combined paste explicitly broadcasts even when the cursor count matches', () => {
  const copies = new CopyStore(), entry = copies.add(['one', 'two'], 'block', '/a')!;
  expect(copies.paste(entry.id, 2)).toEqual(['one', 'two']);
  expect(copies.paste(entry.id, 2, true)).toEqual(['one\ntwo', 'one\ntwo']);
});


test('task output keeps Unicode locations, explicit roots and Windows drives without executing text', () => {
  const output = 'src/한글.py:12:3: missing name\n  File "relative path.py", line 24, in run\nC:\\work\\app.ts:8:2: error\nhttps://example.test:90: warning\nnot a location';
  const parsed = taskLocations(output, '/project');
  expect(parsed.entries.map(item => item.location)).toEqual([
    { path: '/project/src/한글.py', line: 12, column: 3 },
    { path: '/project/relative path.py', line: 24, column: 1 },
    { path: 'C:\\work\\app.ts', line: 8, column: 2 },
  ]);
  expect(parsed.unparsed).toContain('not a location');
  expect(taskLocations(Array.from({ length: 1200 }, (_, i) => `a.py:${i + 1}: err`).join('\n'), '/p').entries).toHaveLength(1000);
});
