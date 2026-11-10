import type { LanguageCatalogEntry } from '../../protocol/language';

export function installed(entry: LanguageCatalogEntry): boolean {
  return !!(entry.bundled || entry.available || entry.candidates?.length || entry.preparation?.state === 'ready' || entry.sessions.some(session => session.state === 'ready'));
}

export function serverStatus(entry: LanguageCatalogEntry): { label: string; tone: 'neutral' | 'success' | 'warning' | 'error' } {
  if (!installed(entry)) return entry.preparation ? { label: entry.preparation.downloadsAllowed === false ? 'Downloads disabled' : 'Prepares when needed', tone: 'neutral' } : { label: 'Not installed', tone: entry.managed || entry.custom ? 'warning' : 'neutral' };
  if (!entry.configured) return { label: 'Setup needed', tone: 'warning' };
  if (entry.selectionNeeded) return { label: 'Choose installation', tone: 'warning' };
  return { label: 'Installed', tone: 'neutral' };
}

export function connectionSource(entry: LanguageCatalogEntry): string {
  if (entry.bundled) return 'Included';
  if (entry.custom) return 'Custom connection';
  if (entry.candidates?.some(candidate => candidate.source === 'explicit')) return 'Selected executable';
  if (entry.preparation?.source === 'managed') return 'Managed by Setdown';
  return installed(entry) ? 'External installation' : entry.preparation ? 'Automatic preparation' : entry.managed ? 'Saved connection' : 'External installation';
}

/** Search all discoverable servers, while separating capability from detected installations. */
export function serverGroups(entries: LanguageCatalogEntry[], query = '') {
  const groups = [
    { id: 'detected', title: 'Installed tools', entries: [] as LanguageCatalogEntry[] },
    { id: 'attention', title: 'Needs attention', entries: [] as LanguageCatalogEntry[] },
    { id: 'manual', title: 'Custom connections', entries: [] as LanguageCatalogEntry[] },
    { id: 'available', title: 'Other tools', entries: [] as LanguageCatalogEntry[] },
  ];
  const search = query.trim().toLowerCase();
  for (const entry of entries) {
    if (!entry.discoverable && !installed(entry) && !entry.managed && !entry.custom && !entry.sessions.length) continue;
    if (!`${entry.name} ${entry.id} ${entry.languages.join(' ')}`.toLowerCase().includes(search)) continue;
    const tone = serverStatus(entry).tone;
    const group = tone === 'warning' || tone === 'error' ? groups[1] : !installed(entry) ? groups[3]
      : entry.custom ? groups[2] : groups[0];
    group.entries.push(entry);
  }
  for (const group of groups) group.entries.sort((a, b) => a.name.localeCompare(b.name));
  return groups.filter(group => group.entries.length);
}
