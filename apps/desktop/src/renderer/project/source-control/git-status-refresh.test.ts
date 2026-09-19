import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { DocumentSnapshot, GitSnapshot } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project } from '../project-state.svelte';
import { SourceControlController } from './source-control-controller';

vi.mock('../project-state.svelte', () => ({ project: {} }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const snapshot = (branch: string): GitSnapshot => ({
  repository: true, branch, upstream: '', ahead: 0, behind: 0, changes: [],
});
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
// Each read observes new async state, not an earlier assert's null narrowing.
const currentBranch = () => project.git?.branch;

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener() {}, setTimeout, clearTimeout });
  Object.assign(project, {
    folder: { path: '/project', name: 'project' }, git: null, gitLoading: false,
    gitBusy: false, gitDiffTabs: [], activeGitDiffId: null, gitDiffTarget: null,
    gitDiffActive: false, gitDiffMode: 'source', error: '',
  });
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const reads: ReturnType<typeof deferred<GitSnapshot>>[] = [];
  const mutation = deferred<GitSnapshot>();
  const desktop = {
    getGitStatus: () => {
      const read = deferred<GitSnapshot>();
      reads.push(read);
      return read.promise;
    },
    stageGit: () => mutation.promise,
    showPreview() {}, destroyPreview() {}, updateGitReviewState() {},
  } as unknown as DesktopPort;
  const controller = new SourceControlController({
    desktop, openWorkingTree: async () => true, activateWorkingTree: () => true,
    workingTreeBuffer: () => null, workingTreeChanged() {}, reviewChanged() {},
  });
  return { controller, reads, mutation };
}

test('overlapping status requests are serialized and one trailing read is retained', async () => {
  const f = fixture();
  const first = f.controller.refresh();
  const second = f.controller.refresh();
  const third = f.controller.refresh();
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(snapshot('old'));
  await turn();
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve(snapshot('new'));
  await Promise.all([first, second, third]);
  assert.equal(currentBranch(), 'new');
  assert.equal(project.gitLoading, false);
});

test('saving a document updates status without an open Git review', async () => {
  const f = fixture();
  const done = f.controller.documentSaved({ path: '/project/note.md' } as DocumentSnapshot);
  await turn();
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(snapshot('saved'));
  await done;
  assert.equal(currentBranch(), 'saved');
});

test('changing folders discards the old result and drains the new folder request', async () => {
  const f = fixture();
  const oldRead = f.controller.refresh();
  f.controller.clear();
  project.folder = { path: '/other', name: 'other' };
  const newRead = f.controller.refresh();
  f.reads[0].resolve(snapshot('wrong-folder'));
  await turn();
  assert.equal(project.git, null);
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve(snapshot('other'));
  await Promise.all([oldRead, newRead]);
  assert.equal(currentBranch(), 'other');
});

test('a read started before a Git mutation cannot overwrite its newer snapshot', async () => {
  const f = fixture();
  const reading = f.controller.refresh();
  const staging = f.controller.stage(['/project/note.md']);
  f.mutation.resolve(snapshot('staged'));
  await staging;
  f.reads[0].resolve(snapshot('stale-before-stage'));
  await reading;
  assert.equal(currentBranch(), 'staged');
});

test('a status request during a mutation runs after the mutation finishes', async () => {
  const f = fixture();
  const staging = f.controller.stage(['/project/note.md']);
  await f.controller.refresh();
  assert.equal(f.reads.length, 0);
  f.mutation.resolve(snapshot('staged'));
  await staging;
  await turn();
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(snapshot('latest'));
  await turn();
  assert.equal(currentBranch(), 'latest');
  assert.equal(project.gitLoading, false);
});

test('failed reads release loading and allow later refreshes', async () => {
  const f = fixture();
  const failed = f.controller.refresh();
  f.reads[0].reject(new Error('status unavailable'));
  await failed;
  assert.equal(project.gitLoading, false);
  assert.equal(project.error, 'status unavailable');
  const retry = f.controller.refresh();
  f.reads[1].resolve(snapshot('recovered'));
  await retry;
  assert.equal(currentBranch(), 'recovered');
});
