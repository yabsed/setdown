import { describe, expect, test } from 'vitest';
import type { ProjectSearchResult } from '../../../protocol/desktop-api';
import { groupSearchResults } from './search-groups';

function result(path: string, relativePath: string, line: number): ProjectSearchResult {
  return {
    path,
    relativePath,
    name: relativePath.split('/').at(-1)!,
    surface: 'viewer',
    line,
    column: 1,
    lineOccurrence: 1,
    ordinal: line,
    preview: `match ${line}`,
  };
}

describe('project search groups', () => {
  test('groups matches by document while preserving document and match order', () => {
    const grouped = groupSearchResults([
      result('/notes/one.md', 'notes/one.md', 2),
      result('/notes/one.md', 'notes/one.md', 8),
      result('/other/one.md', 'other/one.md', 3),
    ]);

    expect(grouped.map(({ path, name, directory, results }) => ({
      path, name, directory, lines: results.map(({ line }) => line),
    }))).toEqual([
      { path: '/notes/one.md', name: 'one.md', directory: 'notes', lines: [2, 8] },
      { path: '/other/one.md', name: 'one.md', directory: 'other', lines: [3] },
    ]);
  });
});
