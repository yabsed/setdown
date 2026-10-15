import type { VisibleProjectEntry } from '../project-state.svelte';

/** Filter only the loaded tree. Never recursively crawl disk for a keystroke. */
export function presentEntries(entries: VisibleProjectEntry[], filter: string, showHidden: boolean, sort: 'name' | 'type'): VisibleProjectEntry[] {
  const children = new Map<string, VisibleProjectEntry[]>();
  const parents: string[] = [];
  for (const entry of entries) {
    parents.length = entry.depth;
    const parent = parents.at(-1) ?? '';
    const rows = children.get(parent) ?? [];
    rows.push(entry); children.set(parent, rows); parents.push(entry.path);
  }
  const query = filter.trim().toLocaleLowerCase();
  const compare = (a: VisibleProjectEntry, b: VisibleProjectEntry) => Number(b.kind === 'directory') - Number(a.kind === 'directory')
    || (sort === 'type' ? extension(a.name).localeCompare(extension(b.name)) : 0)
    || a.name.localeCompare(b.name, undefined, { numeric: true });
  const visit = (parent: string): VisibleProjectEntry[] => [...children.get(parent) ?? []].sort(compare).flatMap(entry => {
    if (!showHidden && entry.name.startsWith('.')) return [];
    const descendants = visit(entry.path);
    return !query || entry.name.toLocaleLowerCase().includes(query) || descendants.length ? [entry, ...descendants] : [];
  });
  return visit('');
}
const extension = (name: string) => name.includes('.') && !name.startsWith('.') ? name.slice(name.lastIndexOf('.') + 1) : '';

export function typeaheadMatch(names: { path: string; name: string }[], current: string, text: string): string | undefined {
  const start = names.findIndex(entry => entry.path === current);
  const ordered = [...names.slice(start + 1), ...names.slice(0, start + 1)];
  return ordered.find(entry => entry.name.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()))?.path;
}
