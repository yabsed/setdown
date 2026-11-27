import { expect, test } from 'vitest';
import { bytesIdentity, byteSize, readingNote, sideSummary, sizeChange, versionLabel, withheld } from './compared-file';

test('sizes and version names read as a person says them', () => {
  expect([byteSize(0), byteSize(1023), byteSize(1536), byteSize(5 * 1024 * 1024)]).toEqual(['0 B', '1023 B', '1.5 KB', '5.0 MB']);
  expect(['WORKTREE', 'INDEX', 'EMPTY', 'HEAD', 'abcdef12'].map(versionLabel)).toEqual(['Working Tree', 'Index', 'Nothing', 'HEAD', 'abcdef12']);
  expect(sideSummary({ missing: true })).toBe('not in this version');
  expect(sideSummary({ size: 2048 })).toBe('2.0 KB');
  expect(sideSummary({ reason: 'unreadable' })).toBe('');
  expect(sideSummary(undefined)).toBe('');
});

test('the change between two versions is one phrase', () => {
  expect(sizeChange({ sides: { original: { size: 1024 }, modified: { size: 3072 } } })).toBe('2.0 KB larger');
  expect(sizeChange({ sides: { original: { size: 3072 }, modified: { size: 1024 } } })).toBe('2.0 KB smaller');
  expect(sizeChange({ sides: { original: { size: 7 }, modified: { size: 7 } } })).toBe('Same size');
  expect(sizeChange({ sides: { original: { missing: true }, modified: { size: 7 } } })).toBe('Added');
  expect(sizeChange({ sides: { original: { size: 7 }, modified: { missing: true } } })).toBe('Deleted');
  expect(sizeChange({ sides: { original: { reason: 'binary' }, modified: { size: 7 } } })).toBeUndefined();
  expect(sizeChange({})).toBeUndefined();
});

test('a comparison without text says why; one with text says nothing', () => {
  expect(withheld({ originalText: 'a', modifiedText: 'b' })).toBeUndefined();
  expect(withheld({ originalText: null, modifiedText: null, sides: { original: { size: 4, reason: 'binary' }, modified: { size: 5, reason: 'binary' } } })?.title).toBe('Binary file');
  expect(withheld({ originalText: 'a', modifiedText: null, sides: { original: { size: 1 }, modified: { size: 99, reason: 'large' } } })?.title).toBe('Too large to compare as text');
  expect(withheld({ originalText: null, modifiedText: 'a', sides: { original: { reason: 'unreadable', detail: 'fatal: bad object' }, modified: { size: 1 } } }))
    .toEqual({ title: 'This version could not be read', detail: 'fatal: bad object' });
  // A comparison from an older main process carries no notes.
  expect(withheld({ originalText: null, modifiedText: null })?.title).toBe('Binary file');
});

test('text read past the strict decoder is announced; ordinary text is not', () => {
  expect(readingNote({ sides: { original: { size: 1 }, modified: { size: 2 } } })).toBeUndefined();
  expect(readingNote({})).toBeUndefined();
  expect(readingNote({ sides: { original: { size: 1 }, modified: { size: 2, reason: 'encoding' } } })).toContain('not valid UTF-8');
  expect(readingNote({ sides: { original: { size: 1, reason: 'encoding', detail: 'UTF-16' }, modified: { size: 2 } } })).toContain('UTF-16');
  expect(readingNote({ sides: { original: { size: 1, reason: 'line-endings' }, modified: { size: 2 } } })).toContain('mixes line endings');
  expect(readingNote({ sides: { original: { size: 1 }, modified: { size: 2, reason: 'control' } } })).toContain('control characters');
  expect(readingNote({ sides: { original: { submodule: true }, modified: { submodule: true } } })).toContain('submodule');
  // What withholds the text is the notice's to say, not this line's.
  expect(readingNote({ sides: { original: { reason: 'binary' }, modified: { reason: 'large' } } })).toBeUndefined();
});

test('the same bytes keep their identity; a changed byte or length does not', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  expect(bytesIdentity(bytes)).toBe(bytesIdentity(new Uint8Array([1, 2, 3, 4])));
  expect(bytesIdentity(bytes)).not.toBe(bytesIdentity(new Uint8Array([1, 2, 3, 5])));
  expect(bytesIdentity(bytes)).not.toBe(bytesIdentity(new Uint8Array([1, 2, 3, 4, 0])));
  expect(bytesIdentity(new Uint8Array())).toBe('0:811c9dc5');
});
