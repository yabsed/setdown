import { expect, it } from 'vitest';
import { readTabMenuContext, tabCloseTargets, tabMenu, type TabMenuContext, type TabMenuItem } from './tab-menu';

const context: TabMenuContext = { location: 'file', inProject: true, others: true, right: true, saved: true, all: true,
  preview: true, pinned: false, copyable: true, moves: ['right'], detachable: true };
const rows = (items: TabMenuItem[]): string[] => items.flatMap(item => item.type === 'separator' ? ['-']
  : item.type === 'submenu' ? [`${item.label} >`, ...rows(item.items).map(row => `  ${row}`)]
    : [`${item.label}${item.enabled ? '' : ' (off)'}${item.accelerator ? ` [${item.accelerator}]` : ''}`]);

it('lists the tab commands in VS Code order', () => {
  expect(rows(tabMenu(context))).toEqual([
    'Close [CmdOrCtrl+W]', 'Close Others', 'Close to the Right', 'Close Saved', 'Close All', '-',
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
    preview: false, pinned: true, copyable: false, moves: [], detachable: false };
  expect(rows(tabMenu(sole)).filter(row => !row.startsWith('  '))).toEqual([
    'Close [CmdOrCtrl+W]', 'Close Others (off)', 'Close to the Right (off)', 'Close Saved (off)', 'Close All (off)', '-',
    'Keep Open (off)', 'Unpin', '-', 'Split Right (off)', 'Split & Move >', '-', 'Move into New Window (off)',
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
    preview: false, pinned: false, copyable: false, detachable: false, moves: ['up', 'right'],
  });
  expect(readTabMenuContext(context)).toEqual(context);
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
