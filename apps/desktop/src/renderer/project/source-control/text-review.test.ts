import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { GitDiff } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project } from '../project-state.svelte';
import { SourceControlController } from './source-control-controller';

vi.mock('../project-state.svelte', () => ({ project: {} }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { addEventListener() {}, setTimeout, clearTimeout });
  Object.assign(project, { gitDiffTabs: [], activeGitDiffId: null, gitDiff: null,
    gitDiffActive: false, gitDiffMode: 'source', gitDiffLine: 1, gitDiffTarget: null,
    gitLoading: false, gitBusy: false, error: '' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

for (const staged of [false, true]) test(`text ${staged ? 'Index' : 'Working Tree'} has no preview allocation, timers or mapping`, async () => {
  const unexpected: string[] = [];
  let live = 'unsaved live buffer';
  const diff: GitDiff = { path: 'main.cpp', filePath: '/project/main.cpp', staged, patch: '',
    originalText: 'base', modifiedText: 'stored version', originalLabel: staged ? 'HEAD' : 'INDEX',
    modifiedLabel: staged ? 'INDEX' : 'WORKTREE', hunks: [] };
  const controller = new SourceControlController({
    desktop: { getGitDiff: async () => diff, showPreview() {}, updateGitReviewState() {},
      createPreview() { unexpected.push('create'); }, destroyPreview() { unexpected.push('destroy'); },
      prepareGitDiffPreview() { unexpected.push('render'); },
      sendPreviewCommand() { unexpected.push('preview command'); },
      getPreviewThemeAssets() { unexpected.push('theme assets'); },
    } as unknown as DesktopPort,
    openWorkingTree: async () => true, activateWorkingTree: () => true,
    workingTreeBuffer: () => live, workingTreeChanged: (_path, text) => { live = text; },
    reviewChanged() {},
  });
  try {
    await controller.review(diff.filePath, staged);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(project.gitDiff?.modifiedText, staged ? 'stored version' : live);
    assert.equal(project.gitDiffMode, 'source');
    controller.layoutDiff({ x: 200, y: 80, width: 1000, height: 600 });
    controller.updateSourceLine(2);
    controller.showRendered();
    controller.toggleDiffMode();
    for (let index = 0; index < 20; index++) controller.changeWorkingTree(`edit ${index}`);
    await controller.applyTheme('paper');
    assert.equal(project.gitDiffMode, 'source');
    assert.equal(vi.getTimerCount(), 0);
    assert.equal(project.gitDiffTabs[0].previewId, null);
    assert.equal(project.gitDiffTabs[0].previewDirty, false);
    if (!staged) assert.equal(live, 'edit 19');
  } finally { controller.clear(); }
  assert.deepEqual(unexpected, []);
});
