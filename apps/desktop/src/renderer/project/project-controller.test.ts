import { beforeEach, expect, test, vi } from 'vitest';
vi.hoisted(() => { vi.stubGlobal('$state', (value: unknown) => value); });
import { ProjectController } from './project-controller';
import { project } from './project-state.svelte';
import type { DesktopPort } from '../ports/desktop-port';
import type { ProjectEntry } from '../../protocol/desktop-api';

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

test('opening a dropped folder shows its top level without waiting for Git status', async () => {
  const desktop = {
    restoreProjectFolder: vi.fn(async (path: string) => ({ path, name: 'root' })),
    readProjectDirectory: vi.fn(async (): Promise<ProjectEntry[]> => [file('/root/a.md')]),
    getGitStatus: vi.fn(() => new Promise(() => {})),
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
