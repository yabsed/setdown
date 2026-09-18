import { describe, expect, it } from 'vitest';

import { createMarkdownLink, createMarkdownTable, preferredEol } from './markdown-insertions';

describe('createMarkdownTable', () => {
  it('creates a GFM table with alignment markers', () => {
    expect(createMarkdownTable({
      headers: ['이름', '값'],
      rows: [['alpha', '10'], ['beta', '20']],
      alignments: ['left', 'right'],
    })).toBe([
      '| 이름 | 값 |',
      '| :--- | ---: |',
      '| alpha | 10 |',
      '| beta | 20 |',
    ].join('\n'));
  });

  it('escapes pipes and newlines inside cells', () => {
    expect(createMarkdownTable({
      headers: ['A|B'],
      rows: [['first\nsecond']],
      alignments: ['center'],
    })).toBe('| A\\|B |\n| :---: |\n| first<br>second |');
  });

  it('preserves the document newline convention', () => {
    expect(createMarkdownTable({
      headers: ['A'],
      rows: [],
      alignments: ['none'],
    }, '\r\n')).toBe('| A |\r\n| --- |');
  });
});

describe('createMarkdownLink', () => {
  it('uses an angle destination for paths with spaces and parentheses', () => {
    expect(createMarkdownLink('문서', './My File (final).md'))
      .toBe('[문서](<./My File (final).md>)');
  });

  it('escapes label brackets and title quotes', () => {
    expect(createMarkdownLink('문서 [초안]', 'https://example.com', 'A "title"'))
      .toBe('[문서 \\[초안\\]](<https://example.com> "A \\"title\\"")');
  });
});

describe('preferredEol', () => {
  it('returns the first newline style or LF for a single-line document', () => {
    expect(preferredEol('a\r\nb')).toBe('\r\n');
    expect(preferredEol('a')).toBe('\n');
  });
});
