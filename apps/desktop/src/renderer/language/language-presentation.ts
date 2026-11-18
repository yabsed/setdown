import type { LanguageCatalogEntry } from '../../protocol/language';

export function installed(entry: LanguageCatalogEntry): boolean {
  return !!(entry.bundled || entry.preparation?.state === 'ready');
}
/** Ready for a file that needs it: shipped, already prepared, or serving a file now. */
export function usable(entry: LanguageCatalogEntry): boolean {
  return installed(entry) || entry.sessions.some(session => session.state === 'ready');
}
const running = (entry: LanguageCatalogEntry) => entry.sessions.some(session => session.state === 'ready');

/** One short status for a tool. It says how the tool gets onto this computer, never
 * what else was found there: the program is looked up when a file needs it. */
export function serverStatus(entry: LanguageCatalogEntry): { label: string; tone: 'neutral' | 'success' | 'warning' | 'error' } {
  if (entry.bundled) return { label: 'Included', tone: 'neutral' };
  if (entry.chosen || entry.custom) return entry.available === false && !running(entry) ? { label: 'Program not found', tone: 'warning' } : { label: entry.custom ? 'Your connection' : 'Your program', tone: 'neutral' };
  if (installed(entry)) return { label: 'Installed', tone: 'neutral' };
  if (entry.available || running(entry)) return { label: 'Found on this computer', tone: 'neutral' };
  if (!entry.preparation) return { label: 'Install it yourself', tone: 'neutral' };
  return { label: entry.preparation.asks ? 'Asks before installing' : entry.preparation.downloadsAllowed === false ? 'Downloads off' : 'Installs when needed', tone: 'neutral' };
}

/** Without a search the list holds what this person has: tools that are set up, their own
 * connections and anything that stopped. A search reaches every other tool. */
export function serverGroups(entries: LanguageCatalogEntry[], query = '') {
  const groups = [
    { id: 'attention', title: 'Needs attention', entries: [] as LanguageCatalogEntry[] },
    { id: 'manual', title: 'Your connections', entries: [] as LanguageCatalogEntry[] },
    { id: 'detected', title: 'Set up', entries: [] as LanguageCatalogEntry[] },
    { id: 'available', title: 'Other tools', entries: [] as LanguageCatalogEntry[] },
  ];
  const search = query.trim().toLowerCase();
  for (const entry of entries) {
    if (entry.notebook) { if (!search || `${entry.name} ${entry.id}`.toLowerCase().includes(search)) groups[2].entries.push(entry); continue; }
    if (!`${entry.name} ${entry.id} ${entry.languages.join(' ')}`.toLowerCase().includes(search)) continue;
    const failed = entry.sessions.some(session => session.state === 'failed');
    const group = failed || serverStatus(entry).tone === 'warning' ? groups[0] : entry.custom ? groups[1]
      : installed(entry) || entry.chosen || entry.sessions.length ? groups[2] : groups[3];
    if (group === groups[3] && !search && !entry.managed) continue;
    group.entries.push(entry);
  }
  for (const group of groups) group.entries.sort((a, b) => a.name.localeCompare(b.name));
  return groups.filter(group => group.entries.length);
}
