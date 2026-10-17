import { beforeEach, expect, test, vi } from 'vitest';
vi.hoisted(() => { vi.stubGlobal('$state', (value: unknown) => value); });
import { ProjectController } from './project-controller';
import { project } from './project-state.svelte';
import type { DesktopPort } from '../ports/desktop-port';
import type { ProjectEntry, ProjectFolder } from '../../protocol/desktop-api';

const file = (path: string): ProjectEntry => ({ path, name: path.split('/').at(-1)!, kind: 'document' });

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener() {}, setTimeout, clearTimeout, requestAnimationFrame: () => 1,
  });
  Object.assign(project, {
    folder: null, entries: [], expanded: [], error: '', searchQuery: '',
    git: null, gitLoading: false, gitBusy: false, gitDiffTabs: [],
  });
});

function folderFixture() {
  const desktop = {
    getProjectFolder: vi.fn(async (): Promise<ProjectFolder | null> => null),
    getRecentProjectFolders: vi.fn(async () => [{ path: '/previous', name: 'previous' }]),
    restoreProjectFolder: vi.fn(async (path: string) => ({ path, name: 'root' })),
    closeProjectFolder: vi.fn(async () => {}),
    readProjectDirectory: vi.fn(async (): Promise<ProjectEntry[]> => []),
    getGitStatus: vi.fn(), searchProject: vi.fn(async () => []),
    showPreview: vi.fn(), updateGitReviewState: vi.fn(),
  };
  const showDocument = vi.fn(async () => true), folderChanged = vi.fn();
  const controller = new ProjectController({
    desktop: desktop as unknown as DesktopPort, folderChanged,
    searchDocuments: () => [], showDocument,
    openWorkingTree: vi.fn(async () => true), activateWorkingTree: vi.fn(async () => true),
    workingTreeBuffer: () => null, workingTreeChanged: vi.fn(), reloadDocuments: vi.fn(async () => {}),
    highlight: vi.fn(), pathMoved: vi.fn(async () => {}), prepareRemove: vi.fn(async () => true),
    commitRemove: vi.fn(async () => {}), runMutation: async <T>(operation: () => Promise<T>) => operation(),
    reviewChanged: vi.fn(), resized: vi.fn(),
  });
  return { controller, desktop, showDocument, folderChanged };
}

test('fresh-window restore ignores stale renderer folder state and loads only history', async () => {
  const f = folderFixture();
  project.folder = { path: '/previous', name: 'previous' };
  await f.controller.restore();
  expect(project.folder).toBeNull();
  expect(project.recentFolders).toEqual([{ path: '/previous', name: 'previous' }]);
  expect(f.desktop.restoreProjectFolder).not.toHaveBeenCalled();
  expect(f.desktop.readProjectDirectory).not.toHaveBeenCalled();
  expect(f.showDocument).not.toHaveBeenCalled();
  expect(f.folderChanged).toHaveBeenCalledWith(null);
});

test('None invalidates a pending explorer read without opening or replacing documents', async () => {
  const f = folderFixture();
  let finish!: (entries: ProjectEntry[]) => void;
  f.desktop.readProjectDirectory.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const opening = f.controller.openFolderPath('/root');
  await vi.waitFor(() => expect(f.desktop.readProjectDirectory).toHaveBeenCalled());
  await f.controller.closeFolder();
  finish([file('/root/late.txt')]);
  await opening;
  expect(project.folder).toBeNull();
  expect(project.entries).toEqual([]);
  expect(project.expanded).toEqual([]);
  expect(project.searchResults).toEqual([]);
  expect(project.git).toBeNull();
  expect(f.desktop.closeProjectFolder).toHaveBeenCalledOnce();
  expect(f.desktop.searchProject).toHaveBeenCalledTimes(1); // Only the initial folder open cancels search.
  expect(f.folderChanged).toHaveBeenLastCalledWith(null);
  expect(f.showDocument).not.toHaveBeenCalled();
});

test('opening a dropped folder shows its top level without waiting for Git status', async () => {
  const desktop = {
    restoreProjectFolder: vi.fn(async (path: string) => ({ path, name: 'root' })),
    readProjectDirectory: vi.fn(async (): Promise<ProjectEntry[]> => [file('/root/a.md')]),
    getGitStatus: vi.fn(() => new Promise(() => {})),
    getRecentProjectFolders: vi.fn(async () => []),
    searchProject: vi.fn(async () => []),
    showPreview: vi.fn(), updateGitReviewState: vi.fn(),
  };
  const controller = new ProjectController({
    desktop: desktop as unknown as DesktopPort,
    searchDocuments: () => [],
    showDocument: vi.fn(async () => true),
    openWorkingTree: vi.fn(async () => true),
    activateWorkingTree: vi.fn(async () => true),
    workingTreeBuffer: () => null,
    workingTreeChanged: vi.fn(),
    reloadDocuments: vi.fn(async () => {}),
    highlight: vi.fn(),
    pathMoved: vi.fn(async () => {}),
    prepareRemove: vi.fn(async () => true),
    commitRemove: vi.fn(async () => {}),
    runMutation: async <T>(operation: () => Promise<T>) => operation(),
    reviewChanged: vi.fn(),
    resized: vi.fn(),
  });
  const opened = await Promise.race([
    controller.openFolderPath('/root').then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 500)),
  ]);
  expect(opened).toBe(true);
  expect(project.entries.map((entry) => entry.path)).toEqual(['/root/a.md']);
  expect(desktop.getGitStatus).toHaveBeenCalled();
});
