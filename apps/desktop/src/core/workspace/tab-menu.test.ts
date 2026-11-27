import { expect, it } from 'vitest';
import { clusterOfCommand, readTabMenuContext, tabCloseTargets, tabMenu, type TabMenuContext, type TabMenuItem } from './tab-menu';

const context: TabMenuContext = { location: 'file', inProject: true, others: true, right: true, saved: true, all: true,
  preview: true, pinned: false, copyable: true, moves: ['right'], detachable: true, cluster: false, clusters: [] };
const rows = (items: TabMenuItem[]): string[] => items.flatMap(item => item.type === 'separator' ? ['-']
  : item.type === 'submenu' ? [`${item.label} >`, ...rows(item.items).map(row => `  ${row}`)]
    : [`${item.label}${item.enabled ? '' : ' (off)'}${item.accelerator ? ` [${item.accelerator}]` : ''}`]);

it('lists the tab commands in VS Code order', () => {
  expect(rows(tabMenu(context))).toEqual([
    'Close [CmdOrCtrl+W]', 'Close Others', 'Close to the Right', 'Close Saved', 'Close All', '-',
    'Add Tab to New Group', '-',
    'Copy', 'Copy Path', 'Copy Relative Path', '-',
    'Reveal in Folder Tab', 'Reveal in Explorer View', '-',
    'Keep Open', 'Pin', '-',
    'Split Right', 'Split & Move >', '  Split Up', '  Split Down', '  Split Left', '  Split Right', '  -',
    '  Move Above (off)', '  Move Below (off)', '  Move Left (off)', '  Move Right', '-',
    'Move into New Window',
  ]);
});

it('disables commands without a target and omits the sections a tab has no location for', () => {
  const sole: TabMenuContext = { location: 'none', inProject: false, others: false, right: false, saved: false, all: false,
    preview: false, pinned: true, copyable: false, moves: [], detachable: false, cluster: false, clusters: [] };
  expect(rows(tabMenu(sole)).filter(row => !row.startsWith('  '))).toEqual([
    'Close [CmdOrCtrl+W]', 'Close Others (off)', 'Close to the Right (off)', 'Close Saved (off)', 'Close All (off)', '-',
    'Add Tab to New Group', '-', 'Keep Open (off)', 'Unpin', '-', 'Split Right (off)', 'Split & Move >', '-', 'Move into New Window (off)',
  ]);
  expect(rows(tabMenu({ ...sole, location: 'address' }))).toContain('Copy Address');
  // Only a file or a folder can be copied as one.
  expect(rows(tabMenu({ ...sole, location: 'address' }))).not.toContain('Copy');
  expect(rows(tabMenu({ ...context, inProject: false }))).toEqual(expect.arrayContaining(['Copy Relative Path (off)', 'Reveal in Explorer View (off)']));
});

it('reads only known values from an IPC context', () => {
  expect(readTabMenuContext(null)).toBeNull();
  expect(readTabMenuContext({ location: 'javascript:', others: 1, right: true, moves: ['right', 'sideways', 'up'], extra: true })).toEqual({
    location: 'none', inProject: false, others: false, right: true, saved: false, all: false,
    preview: false, pinned: false, copyable: false, detachable: false, moves: ['up', 'right'], cluster: false, clusters: [],
  });
  expect(readTabMenuContext(context)).toEqual(context);
});

it('offers tab groups as Firefox does: one item, then a submenu once the strip has another group', () => {
  const grouped = rows(tabMenu({ ...context, cluster: true, clusters: [{ id: 'cluster-2', title: 'Reading' }, { id: 'cluster-5', title: 'Unnamed group (Purple)' }] }));
  expect(grouped.slice(5, 12)).toEqual(['-', 'Add Tab to Group >', '  New Group', '  -', '  Reading', '  Unnamed group (Purple)', 'Remove from Group']);
  // A tab in the strip's only tab group has no other to join; it can start a new one or leave.
  expect(rows(tabMenu({ ...context, cluster: true })).slice(5, 9)).toEqual(['-', 'Add Tab to New Group', 'Remove from Group', '-']);
  const add = tabMenu({ ...context, clusters: [{ id: 'cluster-2', title: 'Reading' }] }).flatMap(item => item.type === 'submenu' ? item.items : [])
    .find(item => item.type === 'command' && item.label === 'Reading');
  expect(add).toMatchObject({ command: 'cluster-add:cluster-2', enabled: true });
});

it('takes only tab groups that look like the strip\'s own from an IPC context and from a command', () => {
  expect(readTabMenuContext({ cluster: 'yes', clusters: [{ id: 'cluster-3', title: 'Work' }, { id: '../etc', title: 'x' }, { id: 'cluster-4', title: '   ' },
    { id: 'cluster-5' }, null, 'cluster-6', { id: 'cluster-7', title: 'n'.repeat(500) }] })).toMatchObject({ cluster: false,
    clusters: [{ id: 'cluster-3', title: 'Work' }, { id: 'cluster-7', title: 'n'.repeat(120) }] });
  expect(readTabMenuContext({ clusters: 'cluster-1' })?.clusters).toEqual([]);
  expect(readTabMenuContext({ clusters: Array.from({ length: 200 }, (_, index) => ({ id: `cluster-${index}`, title: 'g' })) })?.clusters).toHaveLength(64);
  expect(clusterOfCommand('cluster-add:cluster-12')).toBe('cluster-12');
  for (const command of ['cluster-add:', 'cluster-add:group-0', 'cluster-add:cluster-1; rm', 'cluster-new', 'close']) expect(clusterOfCommand(command)).toBeNull();
});

it('bulk closes leave pinned tabs and, for Close Saved, unsaved ones', () => {
  const group = { tabs: ['pin-a', 'pin-b', 'c', 'd', 'e'], sticky: 2 }, dirty = (id: string) => id === 'd' || id === 'pin-a';
  expect(tabCloseTargets('close-others', group, 'd', dirty)).toEqual(['c', 'e']);
  expect(tabCloseTargets('close-others', group, 'pin-a', dirty)).toEqual(['c', 'd', 'e']);
  expect(tabCloseTargets('close-right', group, 'c', dirty)).toEqual(['d', 'e']);
  expect(tabCloseTargets('close-right', group, 'pin-a', dirty)).toEqual(['c', 'd', 'e']);
  expect(tabCloseTargets('close-right', group, 'e', dirty)).toEqual([]);
  expect(tabCloseTargets('close-saved', group, 'c', dirty)).toEqual(['c', 'e']);
  expect(tabCloseTargets('close-all', group, 'c', dirty)).toEqual(['c', 'd', 'e']);
});
