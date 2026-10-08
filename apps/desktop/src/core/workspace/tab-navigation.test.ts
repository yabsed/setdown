import { expect, test } from 'vitest';
import { recordVisit, type TabNavigation } from './tab-navigation';

test('new visits replace a forward branch and repeated locations do not add a duplicate', () => {
  const navigation: TabNavigation = { entries: [], index: -1 };
  recordVisit(navigation, { kind: 'file', url: 'file:///a.md' });
  recordVisit(navigation, { kind: 'web', url: 'https://example.org' });
  recordVisit(navigation, { kind: 'file', url: 'file:///b.pdf' });
  navigation.index = 0;
  recordVisit(navigation, { kind: 'file', url: 'file:///c.md' });
  recordVisit(navigation, { kind: 'file', url: 'file:///c.md' });
  expect(navigation.entries.map(v => v.url)).toEqual(['file:///a.md', 'file:///c.md']);
  expect(navigation.index).toBe(1);
});
test('resource history has a bounded lifetime without retaining live readers', () => {
  const navigation: TabNavigation = { entries: [], index: -1 };
  for (let i = 0; i < 100; i++) recordVisit(navigation, { kind: 'file', url: `file:///${i}.md` });
  expect(navigation.entries).toHaveLength(64);
  expect(navigation.entries[0].url).toBe('file:///36.md');
  expect(navigation.index).toBe(63);
});
