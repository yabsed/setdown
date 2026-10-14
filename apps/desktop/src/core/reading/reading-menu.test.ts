import { expect, it } from 'vitest';
import { readingMenu } from './reading-menu';
it('offers selection actions and only exports supported by the addressed surface', () => {
  expect(readingMenu({ selection: 'selected text', link: '', pdf: true }).map(row => row.command)).toEqual(['copy', 'search', 'select-all', 'find', 'export-pdf']);
  expect(readingMenu({ selection: '', link: 'javascript:bad()', markdown: true }).map(row => row.command)).toEqual(['select-all', 'find', 'export-markdown']);
  expect(readingMenu({ selection: '', link: 'https://example.org/' }).map(row => row.command)).toEqual(['copy-link', 'open-link', 'select-all', 'find']);
});
