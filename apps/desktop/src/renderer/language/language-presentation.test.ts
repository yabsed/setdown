import { expect, test } from 'vitest';
import type { LanguageCatalogEntry } from '../../protocol/language';
import { connectionSource, serverGroups, serverStatus } from './language-presentation';

const entry = (id: string, changes: Partial<LanguageCatalogEntry> = {}): LanguageCatalogEntry => ({
  id, name: id, languages: ['python'], description: '', homepage: '', configured: true,
  bundled: false, custom: false, enabled: true, automatic: true, selected: ['python'], sessions: [], ...changes,
});

test('all discoverable profiles are searchable in Available servers, regardless of installation or profile', () => {
  const catalog = [entry('missing', { discoverable: true }), entry('disabled-default', { enabled: false, discoverable: true }),
    entry('unprofiled', { configured: false, discoverable: true }), entry('undiscoverable'),
    entry('detected', { available: true }), entry('bundled', { bundled: true })];
  expect(serverGroups(catalog).map(group => [group.id, group.entries.map(e => e.id)])).toEqual([
    ['detected', ['bundled', 'detected']],
    ['available', ['disabled-default', 'missing', 'unprofiled']],
  ]);
  expect(serverGroups(catalog, 'missing')[0]).toMatchObject({ id: 'available', entries: [{ id: 'missing' }] });
  expect(serverGroups(catalog, 'undiscoverable')).toEqual([]);
  expect(serverGroups(catalog, ' PYTHON ')[0].entries).toHaveLength(2);
});

test('missing manual connections and failed servers stay visible for repair', () => {
  const catalog = [entry('custom', { custom: true }), entry('saved', { managed: true }),
    entry('crashed', { sessions: [{ root: '/project', state: 'failed' }] })];
  expect(serverGroups(catalog)[0]).toMatchObject({ id: 'attention', entries: [
    { id: 'crashed' }, { id: 'custom' }, { id: 'saved' },
  ] });
  expect(serverStatus(catalog[0]).label).toBe('Not detected');
  expect(serverStatus(catalog[2]).label).toBe('Failed');
});

test('detected unprofiled and ambiguous installations are actionable, not hidden', () => {
  const candidates = [{ id: 'one', path: '/bin/server', source: 'path' as const }];
  const unprofiled = entry('unprofiled', { configured: false, candidates });
  const ambiguous = entry('ambiguous', { candidates, selectionNeeded: true });
  expect(serverGroups([unprofiled, ambiguous])[0].entries).toHaveLength(2);
  expect(serverStatus(unprofiled).label).toBe('Setup needed');
  expect(serverStatus(ambiguous).label).toBe('Choose installation');
});

test('detection source and runtime status are independent, including disabled connections', () => {
  const manual = entry('manual', { available: true, candidates: [{ id: 'one', path: '/bin/server', source: 'explicit' }] });
  const disabled = entry('disabled', { available: true, enabled: false });
  const running = entry('running', { available: true, sessions: [{ root: '/project', state: 'ready' }] });
  expect(connectionSource(manual)).toBe('Manual');
  expect(connectionSource(disabled)).toBe('Detected');
  expect(serverStatus(disabled).label).toBe('Disabled');
  expect(serverGroups([disabled, manual, running]).map(group => [group.id, group.entries.map(e => e.id)])).toEqual([
    ['detected', ['running', 'disabled']], ['manual', ['manual']],
  ]);
});
