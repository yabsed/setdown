import { expect, test, vi } from 'vitest';
import { createWorkspaceTab, WorkspaceState, type WorkspaceTab } from '../../../core/workspace/workspace-state';
import type { TabMenuCommand, TabMenuContext } from '../../../core/workspace/tab-menu';
import { createTabMenu } from './tab-menu';

const anchor = { sourceLine: 1, yRatio: .372, reason: 'empty-document', confidence: 'fallback' } as const;
const file = (path: string, isUntitled = false): WorkspaceTab => createWorkspaceTab(path, { path, name: path.split('/').at(-1)!, text: '', savedText: '',
  revision: 0, savedRevision: 0, diskVersion: { mtimeMs: 0, size: 0 }, isUntitled }, 'editor', anchor);
function fixture(root: string | null = '/project') {
  const workspace = new WorkspaceState(), dirty = new Set<string>();
  let choice: TabMenuCommand | null = null;
  const shown: Array<{ context: TabMenuContext; copy: { path: string; relative: string }; point: { x: number; y: number } }> = [];
  const tabs = { close: vi.fn(async () => true), closeMany: vi.fn(async () => true), pin: vi.fn(), stick: vi.fn(),
    dirty: (tab: { id: string }) => dirty.has(tab.id), copyToGroup: vi.fn(async () => {}), moveToGroup: vi.fn(async () => {}) };
  const options = { workspace, tabs, root: () => root, revealInFolder: vi.fn(async () => {}), revealInExplorer: vi.fn(async () => {}),
    moveToWindow: vi.fn(), failed: vi.fn(),
    desktop: { showTabMenu: async (context: TabMenuContext, copy: { path: string; relative: string }, point: { x: number; y: number }) => { shown.push({ context, copy, point }); return choice; } } };
  const menu = createTabMenu(options);
  return { workspace, dirty, tabs, options, shown, choose: async (id: string, command: TabMenuCommand | null) => { choice = command; await menu.show(id, { x: 4, y: 8 }); return shown.at(-1)!; } };
}

test('describes a tab by what each command could act on', async () => {
  const f = fixture();
  for (const path of ['/project/a.md', '/project/docs/b.md', '/elsewhere/c.md']) f.workspace.add(file(path));
  f.workspace.add(file('/drafts/Untitled-1', true));
  f.workspace.add({ kind: 'web', id: 'web', surface: 'web', page: { url: 'https://example.org/page' } as never });
  f.workspace.add({ kind: 'terminal', id: 'terminal', surface: 'terminal', title: 'Terminal 1', cwd: '', exited: false });
  f.workspace.groups.stick('/project/a.md'); f.dirty.add('/elsewhere/c.md');
  expect(await f.choose('/project/docs/b.md', null)).toEqual({ point: { x: 4, y: 8 }, copy: { path: '/project/docs/b.md', relative: 'docs/b.md' },
    context: { location: 'file', inProject: true, others: true, right: true, saved: true, all: true, preview: false, pinned: false,
      copyable: true, moves: ['up', 'down', 'left', 'right'], detachable: true } });
  expect((await f.choose('/project/a.md', null)).context).toMatchObject({ pinned: true, others: true });
  expect(await f.choose('/elsewhere/c.md', null)).toMatchObject({ copy: { path: '/elsewhere/c.md', relative: '' }, context: { location: 'file', inProject: false } });
  expect(await f.choose('/drafts/Untitled-1', null)).toMatchObject({ copy: { path: '', relative: '' }, context: { location: 'none' } });
  expect(await f.choose('web', null)).toMatchObject({ copy: { path: 'https://example.org/page', relative: '' }, context: { location: 'address', copyable: false } });
  expect((await f.choose('terminal', null)).context).toMatchObject({ location: 'none', right: false, copyable: false });
  for (const mock of Object.values(f.tabs)) if (vi.isMockFunction(mock)) expect(mock).not.toHaveBeenCalled();
});

test('a sole tab can only join an adjacent group and cannot leave a window it would empty', async () => {
  const f = fixture(null); f.workspace.add(file('/project/a.md'));
  expect((await f.choose('/project/a.md', null)).context).toMatchObject({ inProject: false, others: false, right: false, saved: true, all: true, moves: [], detachable: false });
  f.workspace.add(file('/project/b.md')); f.workspace.groups.move('/project/b.md', 'group-0', 'right');
  expect((await f.choose('/project/a.md', null)).context).toMatchObject({ moves: ['right'], detachable: true });
  await f.choose('/project/a.md', 'move-right');
  expect(f.tabs.moveToGroup).toHaveBeenCalledExactlyOnceWith('/project/a.md', { groupId: f.workspace.groups.owner('/project/b.md')!.id, direction: null });
  await f.choose('/project/a.md', 'move-left');
  expect(f.tabs.moveToGroup).toHaveBeenCalledOnce();
});

test('runs each command against the tab the menu was opened on', async () => {
  const f = fixture();
  for (const path of ['/project/pin.md', '/project/a.md', '/project/b.md', '/project/c.md']) f.workspace.add(file(path));
  f.workspace.groups.stick('/project/pin.md'); f.dirty.add('/project/c.md');
  const id = '/project/a.md', group = 'group-0';
  await f.choose(id, 'close'); expect(f.tabs.close).toHaveBeenCalledExactlyOnceWith(id);
  for (const [command, targets] of [['close-others', ['/project/b.md', '/project/c.md']], ['close-right', ['/project/b.md', '/project/c.md']],
    ['close-saved', [id, '/project/b.md']], ['close-all', [id, '/project/b.md', '/project/c.md']]] as const) {
    await f.choose(id, command); expect(f.tabs.closeMany).toHaveBeenLastCalledWith(targets);
  }
  await f.choose(id, 'keep-open'); expect(f.tabs.pin).toHaveBeenCalledExactlyOnceWith(id);
  await f.choose(id, 'pin'); await f.choose(id, 'unpin'); expect(f.tabs.stick.mock.calls).toEqual([[id, true], [id, false]]);
  await f.choose(id, 'split-right'); await f.choose(id, 'split-up');
  expect(f.tabs.copyToGroup.mock.calls).toEqual([[id, group, 'right'], [id, group, 'up']]);
  await f.choose(id, 'move-down'); expect(f.tabs.moveToGroup).toHaveBeenCalledExactlyOnceWith(id, { groupId: group, direction: 'down' });
  await f.choose(id, 'reveal-folder'); expect(f.options.revealInFolder).toHaveBeenCalledExactlyOnceWith(id, group);
  await f.choose(id, 'reveal-explorer'); expect(f.options.revealInExplorer).toHaveBeenCalledExactlyOnceWith(id);
  await f.choose(id, 'move-window'); expect(f.options.moveToWindow).toHaveBeenCalledExactlyOnceWith(id);
  // Main already copied; the renderer has nothing left to do.
  await f.choose(id, 'copy-path'); await f.choose(id, 'copy-relative-path');
  expect(f.tabs.close).toHaveBeenCalledOnce(); expect(f.options.failed).not.toHaveBeenCalled();
});

test('a command for a tab that closed while its menu was open does nothing, and failures are reported', async () => {
  const f = fixture(); f.workspace.add(file('/project/a.md')); f.workspace.add(file('/project/b.md'));
  f.options.desktop.showTabMenu = async () => { f.workspace.remove('/project/a.md'); return 'close-others'; };
  await f.choose('/project/a.md', null);
  expect(f.tabs.closeMany).not.toHaveBeenCalled();
  f.options.desktop.showTabMenu = async () => 'close';
  f.tabs.close.mockRejectedValueOnce(Error('disk full'));
  await f.choose('/project/b.md', null);
  expect(f.options.failed).toHaveBeenCalledExactlyOnceWith(Error('disk full'));
});
