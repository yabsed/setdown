import { describe, expect, test } from 'vitest';

import type { DocumentSnapshot } from './document';
import { applyTextRevision, hasUnsavedText, isDirty, lineCount } from './document-state';

const document: DocumentSnapshot = {
  path: '/tmp/note.md',
  name: 'note.md',
  text: '# before',
  savedText: '# before',
  revision: 3,
  savedRevision: 3,
  diskVersion: { mtimeMs: 1, size: 8 },
  isUntitled: false,
};

describe('document state', () => {
  test('ignores a late older update', () => {
    expect(applyTextRevision(document, 'stale', 2)).toBe(document);
  });

  test('marks an accepted edit as dirty', () => {
    expect(isDirty(applyTextRevision(document, '# after', 4))).toBe(true);
  });

  test('편집 revision이 남아 있어도 디스크 내용으로 되돌리면 clean이다', () => {
    expect(hasUnsavedText({ ...document, revision: 9 }, '# before')).toBe(false);
  });

  test('외부 변경을 기준으로 현재 내용을 유지하면 dirty다', () => {
    expect(hasUnsavedText({
      ...document,
      text: '# outside',
      savedText: '# outside',
    }, '# before')).toBe(true);
  });

  test('빈 새 문서는 편집하기 전까지 dirty가 아니다', () => {
    expect(isDirty({
      ...document,
      text: '',
      savedText: '',
      revision: 0,
      savedRevision: 0,
      isUntitled: true,
    })).toBe(false);
  });

  test('counts all common newline forms', () => {
    expect(lineCount('a\r\nb\rc\nd')).toBe(4);
  });
});
