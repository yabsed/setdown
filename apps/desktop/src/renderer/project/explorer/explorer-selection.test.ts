import { describe, expect, test } from 'vitest';
import { explorerDropKind, selectEntry, topLevelPaths } from './explorer-selection';

describe('Explorer selection', () => {
  const visible = ['folder', 'folder/child', 'a', 'b', 'c'];
  test('Ctrl/Cmd toggles individual entries; Shift grows and shrinks from the anchor', () => {
    let selection = selectEntry({ paths: [], anchor: '' }, 'a', visible);
    selection = selectEntry(selection, 'c', visible, { ctrlKey: true });
    expect(selection.paths).toEqual(['a', 'c']);
    selection = selectEntry(selection, 'a', visible, { metaKey: true });
    expect(selection.paths).toEqual(['c']);
    selection = selectEntry(selection, 'folder/child', visible, { shiftKey: true });
    expect(selection).toEqual({ paths: ['folder/child', 'a'], anchor: 'a' });
    selection = selectEntry(selection, 'b', visible, { shiftKey: true });
    expect(selection.paths).toEqual(['a', 'b']);
    selection = selectEntry(selection, 'c', visible, { shiftKey: true, ctrlKey: true });
    expect(selection.paths).toEqual(['a', 'b', 'c']);
  });
  test('hidden/deleted entries cannot join a new range or additive selection', () => {
    expect(selectEntry({ paths: ['removed', 'a'], anchor: 'removed' }, 'c', visible, { shiftKey: true }))
      .toEqual({ paths: ['c'], anchor: 'c' });
    expect(selectEntry({ paths: ['removed', 'a'], anchor: 'a' }, 'c', visible, { ctrlKey: true }).paths).toEqual(['a', 'c']);
  });
  test('selected ancestors carry descendants exactly once without matching sibling prefixes', () => {
    expect(topLevelPaths(['/a/child', '/ab', '/a', '/a', '/a/deep/file', '/z']))
      .toEqual(['/ab', '/a', '/z']);
    expect(topLevelPaths(['C:\\a\\child', 'C:\\ab', 'C:\\a'])).toEqual(['C:\\ab', 'C:\\a']);
  });
  test('a drop moves entries of the open folder and copies in everything from outside it', () => {
    // Explorer entries and a folder tab showing the workspace: Setdown's own drag moves, Ctrl copies.
    expect(explorerDropKind(['/work/a.md', '/work/notes'], '/work', true, false)).toBe('move');
    expect(explorerDropKind(['/work/a.md'], '/work/', true, true)).toBe('copy');
    expect(explorerDropKind(['C:\\work\\a.md'], 'C:\\work', true, false)).toBe('move');
    // A folder tab showing another folder drags files the open folder does not own: they are copied in.
    expect(explorerDropKind(['/home/me/Downloads/report.pdf'], '/work', true, false)).toBe('import');
    expect(explorerDropKind(['/work/a.md', '/workshop/b.md'], '/work', true, false)).toBe('import');
    expect(explorerDropKind(['/work'], '/work', true, false)).toBe('import');
    // Another application's files are imported even when they already lie in the open folder.
    expect(explorerDropKind(['/work/a.md'], '/work', false, false)).toBe('import');
  });
});
