import type { LanguageCatalogEntry } from '../../protocol/language';

export function installed(entry: LanguageCatalogEntry): boolean {
  return !!(entry.bundled || entry.available || entry.candidates?.length);
}

export function serverStatus(entry: LanguageCatalogEntry): { label: string; tone: 'neutral' | 'success' | 'warning' | 'error' } {
  if (entry.sessions.some(session => session.state === 'failed')) return { label: 'Failed', tone: 'error' };
  if (!installed(entry)) return { label: 'Not detected', tone: entry.managed || entry.custom ? 'warning' : 'neutral' };
  if (!entry.configured) return { label: 'Setup needed', tone: 'warning' };
  if (!entry.enabled) return { label: 'Disabled', tone: 'neutral' };
  if (entry.sessions.some(session => session.state === 'ready')) return { label: 'Running', tone: 'success' };
  if (entry.sessions.some(session => session.state === 'starting')) return { label: 'Starting', tone: 'neutral' };
  if (entry.selectionNeeded) return { label: 'Choose installation', tone: 'warning' };
  if (!entry.selected.length) return { label: 'Choose primary', tone: 'warning' };
  return { label: 'Detected', tone: 'neutral' };
}

export function connectionSource(entry: LanguageCatalogEntry): string {
  if (entry.bundled) return 'Included';
  if (entry.custom || entry.candidates?.some(candidate => candidate.source === 'explicit')) return 'Manual';
  return installed(entry) ? 'Detected' : entry.managed ? 'Saved connection' : 'Auto-detect supported';
}

/** Search all discoverable servers, while separating capability from detected installations. */
export function serverGroups(entries: LanguageCatalogEntry[], query = '') {
  const groups = [
    { id: 'detected', title: 'Detected', entries: [] as LanguageCatalogEntry[] },
    { id: 'attention', title: 'Needs attention', entries: [] as LanguageCatalogEntry[] },
    { id: 'manual', title: 'Manual connections', entries: [] as LanguageCatalogEntry[] },
    { id: 'available', title: 'Available servers', entries: [] as LanguageCatalogEntry[] },
  ];
  const search = query.trim().toLowerCase();
  for (const entry of entries) {
    if (!entry.discoverable && !installed(entry) && !entry.managed && !entry.custom && !entry.sessions.length) continue;
    if (!`${entry.name} ${entry.id} ${entry.languages.join(' ')}`.toLowerCase().includes(search)) continue;
    const tone = serverStatus(entry).tone;
    const group = tone === 'warning' || tone === 'error' ? groups[1] : !installed(entry) ? groups[3]
      : connectionSource(entry) === 'Manual' ? groups[2] : groups[0];
    group.entries.push(entry);
  }
  for (const group of groups) group.entries.sort((a, b) =>
    Number(b.sessions.some(s => s.state === 'ready')) - Number(a.sessions.some(s => s.state === 'ready')) || a.name.localeCompare(b.name));
  return groups.filter(group => group.entries.length);
}
