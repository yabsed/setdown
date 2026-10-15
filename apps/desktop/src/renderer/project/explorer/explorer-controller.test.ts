import { beforeEach, expect, test, vi } from 'vitest';
vi.hoisted(() => { vi.stubGlobal('$state', (value: unknown) => value); });
import { ExplorerController } from './explorer-controller';
import { project } from '../project-state.svelte';
import { tree, selectPaths } from './explorer-tree-state.svelte';
import type { DesktopPort } from '../../ports/desktop-port';
import type { ProjectEntry } from '../../../protocol/desktop-api';

const file = (path: string): ProjectEntry => ({ path, name: path.split('/').at(-1)!, kind: 'document' });
beforeEach(() => {
  Object.assign(project, { folder: { path: '/root', name: 'root' }, entries: [], expanded: [], error: '' });
  Object.assign(tree, { root: '/root', scroll: 0, filter: '' }); selectPaths([]);
});
function fixture(read = vi.fn(async (_path: string): Promise<ProjectEntry[]> => [file('/root/a')])) {
  const desktop = { readProjectDirectory: read, trashProjectEntry: vi.fn(async () => {}),
    renameProjectEntry: vi.fn(async (from: string) => ({ from, to: '/root/z' })) };
  const options = { desktop: desktop as unknown as DesktopPort, showDocument: vi.fn(async () => true),
    pathMoved: vi.fn(async () => {}), prepareRemove: vi.fn(async () => true), commitRemove: vi.fn(async () => {}),
    runMutation: async <T>(operation: () => Promise<T>) => operation() };
  return { controller: new ExplorerController(options), desktop, options };
}

test('old project reads cannot replace the tree or errors of a newly opened folder', async () => {
  let finish!: (entries: ProjectEntry[]) => void;
  const f = fixture(vi.fn(path => path === '/root' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([file('/new/b')])));
  const old = f.controller.reset(project.folder!);
  project.folder = { path: '/new', name: 'new' }; await f.controller.reset(project.folder);
  finish([file('/root/a')]); await old;
  expect(project.entries.map(entry => entry.path)).toEqual(['/new/b']);
  expect(tree.root).toBe('/new');
});

test('newer directory results win; unchanged rows retain selection', async () => {
  const f = fixture(); await f.controller.reset(project.folder!); selectPaths(['/root/a']);
  let finish!: (entries: ProjectEntry[]) => void;
  f.desktop.readProjectDirectory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = f.controller.refresh();
  f.desktop.readProjectDirectory.mockResolvedValue([file('/root/a'), file('/root/b')]);
  await f.controller.refresh(); finish([file('/root/obsolete')]); await old;
  expect(project.entries.map(entry => entry.name)).toEqual(['a', 'b']);
  expect(tree.selection.paths).toEqual(['/root/a']);
});

test('failed trash leaves the document and selection alive; successful trash commits afterward', async () => {
  const f = fixture(); await f.controller.reset(project.folder!); selectPaths(['/root/a']);
  f.desktop.trashProjectEntry.mockRejectedValueOnce(new Error('Trash unavailable'));
  await expect(f.controller.trash('/root/a')).rejects.toThrow('Trash unavailable');
  expect(f.options.commitRemove).not.toHaveBeenCalled(); expect(tree.selection.paths).toEqual(['/root/a']);
  f.desktop.readProjectDirectory.mockResolvedValue([file('/root/b')]);
  await f.controller.trash('/root/a');
  expect(f.options.commitRemove).toHaveBeenCalledWith('/root/a');
  expect(tree.selection.paths).toEqual(['/root/b']);
});

test('rename maps selected and focused paths before refresh and document retargeting', async () => {
  const f = fixture(); await f.controller.reset(project.folder!); selectPaths(['/root/a']);
  f.desktop.readProjectDirectory.mockResolvedValue([file('/root/z')]);
  await f.controller.rename('/root/a', 'z');
  expect(tree.selection.paths).toEqual(['/root/z']); expect(tree.focused).toBe('/root/z');
  expect(f.options.pathMoved).toHaveBeenCalledWith('/root/a', '/root/z');
});
