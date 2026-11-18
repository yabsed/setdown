import { expect, test } from 'vitest';
import type { LanguageCatalogEntry } from '../../protocol/language';
import { serverGroups, serverStatus } from './language-presentation';

const entry = (id: string, changes: Partial<LanguageCatalogEntry> = {}): LanguageCatalogEntry => ({
  id, name: id, languages: ['python'], description: '', homepage: '', configured: true,
  bundled: false, custom: false, enabled: true, automatic: true, selected: ['python'], sessions: [], ...changes,
});
const preparable = { state: 'available' as const, downloadsAllowed: true };

test('the list holds what this person has; a search reaches every other tool', () => {
  const catalog = [entry('never-used', { preparation: preparable }), entry('bundled', { bundled: true }),
    entry('installed', { preparation: { state: 'ready', source: 'managed' } }), entry('override', { managed: true, preparation: preparable })];
  expect(serverGroups(catalog).map(group => [group.id, group.entries.map(e => e.id)])).toEqual([
    ['detected', ['bundled', 'installed']],
    ['available', ['override']],
  ]);
  expect(serverGroups(catalog, 'never')[0]).toMatchObject({ id: 'available', entries: [{ id: 'never-used' }] });
  expect(serverGroups(catalog, 'no such tool')).toEqual([]);
  expect(serverGroups(catalog, ' PYTHON ').flatMap(group => group.entries)).toHaveLength(4);
});

test('a named program that is gone and a stopped tool need attention; a connection of your own has its group', () => {
  const catalog = [entry('custom', { custom: true, available: true }), entry('gone', { chosen: true, available: false }),
    entry('crashed', { preparation: { state: 'ready', source: 'managed' }, sessions: [{ root: '/project', state: 'failed' }] })];
  expect(serverGroups(catalog).map(group => [group.id, group.entries.map(e => e.id)])).toEqual([
    ['attention', ['crashed', 'gone']], ['manual', ['custom']],
  ]);
  expect(serverStatus(catalog[0]).label).toBe('Your connection');
  expect(serverStatus(catalog[1])).toEqual({ label: 'Program not found', tone: 'warning' });
});

test('a status says how the tool gets onto this computer', () => {
  expect(serverStatus(entry('bundled', { bundled: true })).label).toBe('Included');
  expect(serverStatus(entry('chosen', { chosen: true, available: true })).label).toBe('Your program');
  // The list does not look programs up, so an unchecked path is not reported as missing.
  expect(serverStatus(entry('unchecked', { chosen: true })).label).toBe('Your program');
  expect(serverStatus(entry('managed', { preparation: { state: 'ready', source: 'managed' } })).label).toBe('Installed');
  expect(serverStatus(entry('supported', { preparation: preparable })).label).toBe('Installs when needed');
  expect(serverStatus(entry('other', { preparation: { state: 'available', downloadsAllowed: false, asks: true } })).label).toBe('Asks before installing');
  expect(serverStatus(entry('off', { preparation: { state: 'available', downloadsAllowed: false } })).label).toBe('Downloads off');
  expect(serverStatus(entry('manual')).label).toBe('Install it yourself');
});

test('a live session and a program found on its own page are visible without a scan', () => {
  const live = entry('live', { sessions: [{ root: '/project', state: 'ready' }] });
  expect(serverStatus(live).label).toBe('Found on this computer');
  expect(serverStatus(entry('found', { available: true })).label).toBe('Found on this computer');
  expect(serverGroups([live])[0].id).toBe('detected');
});
