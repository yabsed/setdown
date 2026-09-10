import { describe, expect, test } from 'vitest';
import type { DocumentSnapshot } from './contracts';
import { applyTextRevision, isDirty, lineCount } from './document-state';

const document: DocumentSnapshot = {
  path: '/tmp/note.md',
  name: 'note.md',
  text: '# before',
  revision: 3,
  savedRevision: 3,
  diskVersion: { mtimeMs: 1, size: 8 },
};

describe('document state', () => {
  test('ignores a late older update', () => {
    expect(applyTextRevision(document, 'stale', 2)).toBe(document);
  });

  test('marks an accepted edit as dirty', () => {
    expect(isDirty(applyTextRevision(document, '# after', 4))).toBe(true);
  });

  test('counts all common newline forms', () => {
    expect(lineCount('a\r\nb\rc\nd')).toBe(4);
  });
});
