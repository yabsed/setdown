import { expect, test } from 'vitest';
import { presentEntries, typeaheadMatch } from './explorer-presentation';
import type { VisibleProjectEntry } from '../project-state.svelte';

const entry = (name: string, depth = 0, kind: VisibleProjectEntry['kind'] = 'document'): VisibleProjectEntry =>
  ({ path: name, name, depth, kind, expanded: kind === 'directory', loading: false });

test('filter retains ancestors, hides entire hidden subtrees, and sorts siblings without flattening hierarchy', () => {
  const entries = [entry('z', 0, 'directory'), entry('b.txt', 1), entry('a.ts', 1),
    entry('.hidden', 0, 'directory'), entry('secret.txt', 1), entry('a.txt')];
  expect(presentEntries(entries, '', false, 'name').map(item => item.name)).toEqual(['z', 'a.ts', 'b.txt', 'a.txt']);
  expect(presentEntries(entries, '.ts', true, 'name').map(item => item.name)).toEqual(['z', 'a.ts']);
  expect(presentEntries(entries, '', true, 'type').map(item => item.name)).toEqual(['.hidden', 'secret.txt', 'z', 'a.ts', 'b.txt', 'a.txt']);
  expect(presentEntries(entries, 'secret', false, 'name')).toEqual([]);
});
test('typeahead wraps and repeated prefixes move to the next item', () => {
  const entries = [entry('alpha'), entry('another'), entry('bravo')];
  expect(typeaheadMatch(entries, 'alpha', 'a')).toBe('another');
  expect(typeaheadMatch(entries, 'bravo', 'a')).toBe('alpha');
  expect(typeaheadMatch(entries, 'alpha', 'an')).toBe('another');
  expect(typeaheadMatch(entries, 'alpha', 'x')).toBeUndefined();
});
