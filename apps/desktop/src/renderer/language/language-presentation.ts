import type { LanguageCatalogEntry } from '../../protocol/language';

export function installed(entry: LanguageCatalogEntry): boolean {
  return !!(entry.bundled || entry.preparation?.state === 'ready');
}
const found = (entry: LanguageCatalogEntry) => !!(entry.available || entry.candidates?.length || entry.sessions.some(session => session.state === 'ready'));

export function serverStatus(entry: LanguageCatalogEntry): { label: string; tone: 'neutral' | 'success' | 'warning' | 'error' } {
  if (entry.bundled) return { label: 'Included', tone: 'neutral' };
  if (installed(entry)) return { label: 'Installed', tone: 'neutral' };
  if (!found(entry)) return entry.preparation ? { label: entry.preparation.downloadsAllowed === false ? 'Downloads disabled' : 'Prepares when needed', tone: 'neutral' } : { label: 'Not found in searched locations', tone: entry.managed || entry.custom ? 'warning' : 'neutral' };
  if (!entry.configured) return { label: 'Setup needed', tone: 'warning' };
  if (entry.selectionNeeded) return { label: 'Choose executable', tone: 'warning' };
  return { label: 'Executable found', tone: 'neutral' };
}

export function connectionSource(entry: LanguageCatalogEntry): string {
  if (entry.bundled) return 'Included';
  if (entry.custom) return 'Custom connection';
  if (entry.candidates?.some(candidate => candidate.source === 'explicit')) return 'Selected executable';
  if (entry.preparation?.source === 'managed') return 'Managed by Setdown';
  return found(entry) ? 'External executable' : entry.preparation ? 'Automatic preparation' : entry.managed ? 'Saved connection' : 'External lookup';
}

/** Search all discoverable servers, while separating capability from detected installations. */
export function serverGroups(entries: LanguageCatalogEntry[], query = '') {
  const groups = [
    { id: 'detected', title: 'Provided and managed tools', entries: [] as LanguageCatalogEntry[] },
    { id: 'attention', title: 'Needs attention', entries: [] as LanguageCatalogEntry[] },
    { id: 'manual', title: 'Custom connections', entries: [] as LanguageCatalogEntry[] },
    { id: 'external', title: 'External executable candidates', entries: [] as LanguageCatalogEntry[] },
    { id: 'available', title: 'Other tools', entries: [] as LanguageCatalogEntry[] },
  ];
  const search = query.trim().toLowerCase();
  for (const entry of entries) {
    if (!entry.discoverable && !installed(entry) && !found(entry) && !entry.managed && !entry.custom && !entry.sessions.length) continue;
    if (!`${entry.name} ${entry.id} ${entry.languages.join(' ')}`.toLowerCase().includes(search)) continue;
    const tone = serverStatus(entry).tone;
    const group = tone === 'warning' || tone === 'error' ? groups[1] : entry.custom ? groups[2]
      : installed(entry) ? groups[0] : found(entry) ? groups[3] : groups[4];
    group.entries.push(entry);
  }
  for (const group of groups) group.entries.sort((a, b) => a.name.localeCompare(b.name));
  return groups.filter(group => group.entries.length);
}
