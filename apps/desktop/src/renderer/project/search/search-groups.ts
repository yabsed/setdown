import type { ProjectSearchResult } from '../../../protocol/desktop-api';

export type ProjectSearchGroup = {
  path: string;
  name: string;
  directory: string;
  results: ProjectSearchResult[];
};

export function groupSearchResults(results: ProjectSearchResult[]): ProjectSearchGroup[] {
  const groups = new Map<string, ProjectSearchGroup>();
  for (const result of results) {
    let group = groups.get(result.path);
    if (!group) {
      const separator = Math.max(result.relativePath.lastIndexOf('/'), result.relativePath.lastIndexOf('\\'));
      group = {
        path: result.path,
        name: result.name,
        directory: separator < 0 ? '' : result.relativePath.slice(0, separator),
        results: [],
      };
      groups.set(result.path, group);
    }
    group.results.push(result);
  }
  return [...groups.values()];
}
