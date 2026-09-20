import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { GitDiffPreviewResult } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project, type GitDiffTabState } from '../project-state.svelte';
import { GitDiffViewportPort } from './git-diff-viewport';
import { SourceControlController } from './source-control-controller';

vi.mock('../project-state.svelte', () => ({ project: {} }));
vi.mock('../../../core/diff/text-diff', () => ({ textDiffHunks: () => { throw new Error('UI source diff computed'); } }));

function fixture(front = false) {
  Object.assign(project, { gitDiffTabs: [], gitDiffActive: true, activeGitDiffId: 'r',
    gitDiffMode: 'source', gitDiffLine: 1, gitDiffTarget: null, gitBusy: false, error: '' });
  let text = 'revision 1';
  const tab: GitDiffTabState = {
    id: 'r', filePath: '/p/a.md', staged: false, line: 1, mode: 'source',
    diff: { filePath: '/p/a.md', path: 'a.md', staged: false,
      originalText: 'base', modifiedText: text, originalLabel: 'INDEX', modifiedLabel: 'WORKTREE', patch: '', hunks: [] },
    loading: false, previewId: front ? 'git-diff:r:a' : null, pendingPreviewId: null,
    previewLoading: false, previewDirty: true,
  };
  project.gitDiffTabs.push(tab); project.gitDiff = tab.diff;
  const calls: Array<{ id: string; resolve(value: GitDiffPreviewResult): void }> = [];
  const shows: Array<string | null> = [];
  vi.stubGlobal('window', { addEventListener() {} });
  const controller = new SourceControlController({
    desktop: {
      getTheme: async () => ({ id: 'paper', revision: 0 }),
      prepareGitDiffPreview: (id: string) => new Promise<GitDiffPreviewResult>((resolve) => calls.push({ id, resolve })),
      showPreview: (id: string | null) => shows.push(id),
      sendPreviewCommand() {}, updateGitReviewState() {}, destroyPreview() {},
    } as unknown as DesktopPort,
    viewport: new GitDiffViewportPort(), openWorkingTree: async () => true,
    activateWorkingTree: () => true, workingTreeBuffer: () => text,
    workingTreeChanged: (_path, value) => { text = value; }, reviewChanged() {},
  });
  return {
    controller, tab, calls, shows,
    run: () => (controller as unknown as { preparePreview(tab: GitDiffTabState): Promise<void> }).preparePreview(tab),
    finish(index: number) { calls[index].resolve({ revision: index + 1, url: 'marktex-preview://document/test', themeId: 'paper', supported: true }); },
    close() { controller.clear(); vi.unstubAllGlobals(); },
  };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test('Esc during the first render does not dirty, discard or duplicate it', async () => {
  const f = fixture();
  try {
    const work = f.run(); await tick(); assert.equal(f.calls.length, 1);
    f.controller.showRendered(); await f.run();
    assert.equal(f.tab.previewDirty, false);
    assert.equal(f.calls.length, 1);
    f.finish(0); await work;
    assert.equal(f.tab.previewId, 'git-diff:r:a');
    await f.run(); assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});
test('superseded snapshot remains hidden while newest input starts one immediate followup', async () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    const work = f.run(); await tick();
    f.controller.changeWorkingTree('revision 2');
    f.controller.changeWorkingTree('revision 3');
    await f.run(); assert.equal(f.calls.length, 1);
    f.finish(0); await work;
    assert.equal(f.tab.previewId, null);
    assert.equal(f.tab.diff?.modifiedText, 'revision 3');
    assert.equal(f.tab.previewLoading, true);
    assert.equal(f.calls.length, 2, 'no extra timer is needed for the latest work');
    assert.equal(f.calls[1].id, 'git-diff:r:a');
    f.finish(1); await tick();
    assert.equal(f.tab.previewDirty, false);
    assert.equal(f.tab.previewId, 'git-diff:r:a');
    await vi.advanceTimersByTimeAsync(1000); assert.equal(f.calls.length, 2);
  } finally { f.close(); vi.useRealTimers(); }
});
test('Esc keeps Source while the new result is held', async () => {
  const f = fixture(true);
  try {
    f.controller.layoutDiff({ x: 20, y: 80, width: 900, height: 700 });
    const work = f.run(); await tick();
    f.controller.showRendered();
    assert.equal(f.shows.at(-1), null);
    assert.equal(project.gitDiffMode, 'source');
    assert.equal(project.gitDiffTransitionPending, true);
    assert.equal(f.calls.length, 1);
    f.finish(0); await work;
    assert.equal(f.tab.previewId, 'git-diff:r:b');
    assert.equal(f.shows.filter(Boolean).length, 0, 'final hidden position must acknowledge before showing');
  } finally { f.close(); }
});
test('a result from an obsolete Index is not promoted', async () => {
  vi.useFakeTimers();
  const f = fixture(true);
  try {
    const work = f.run(); await tick();
    f.tab.diff = { ...f.tab.diff!, originalText: 'different staged content' };
    f.tab.previewDirty = true;
    f.finish(0); await work;
    assert.equal(f.tab.previewId, 'git-diff:r:a');
    assert.equal(f.tab.previewLoading, true);
    assert.equal(f.calls.length, 2);
  } finally { f.close(); vi.useRealTimers(); }
});
test('closing the review while rendering cannot resurrect it', async () => {
  const f = fixture();
  try {
    const work = f.run(); await tick(); f.controller.closeDiff();
    f.finish(0); await work;
    assert.equal(project.gitDiffTabs.length, 0);
    assert.equal(project.gitDiffActive, false);
  } finally { f.close(); }
});
