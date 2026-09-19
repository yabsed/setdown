import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { GitDiff, GitDiffPreviewResult, PreviewBounds } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project, type GitDiffTabState } from '../project-state.svelte';
import { SourceControlController } from './source-control-controller';

// Exercise controller ordering without mounting Svelte or native Electron views.
vi.mock('../project-state.svelte', () => ({ project: {} }));

const bounds: PreviewBounds = { x: 260, y: 84, width: 850, height: 650 };
type Call = { kind: 'show'; id: string | null; bounds: PreviewBounds | null }
  | { kind: 'position'; id: string; line: number }
  | { kind: 'prime'; id: string; primeId: number };
const controllers: SourceControlController[] = [];

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener() {},
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
  Object.assign(project, {
    gitDiffTabs: [], activeGitDiffId: null, gitDiff: null, gitDiffActive: false,
    gitDiffMode: 'source', gitDiffLine: 1, gitDiffTarget: null,
    gitLoading: false, gitBusy: false, error: '',
  });
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.clear();
  vi.unstubAllGlobals();
});

function fixture(staged = false, prepared = true) {
  const calls: Call[] = [];
  const diff: GitDiff = {
    path: 'notes.md', filePath: '/project/notes.md', staged, patch: '',
    originalText: 'before', modifiedText: 'after',
    originalLabel: staged ? 'HEAD' : 'INDEX',
    modifiedLabel: staged ? 'INDEX' : 'WORKTREE',
    hunks: [{ oldStart: 120, oldLines: 1, newStart: 120, newLines: 1 }],
  };
  const tab: GitDiffTabState = {
    id: 'review', filePath: diff.filePath, staged, mode: 'source', line: 120,
    diff, loading: false, previewId: prepared ? 'git-diff:review:a' : null,
    pendingPreviewId: null, previewLoading: false, previewDirty: !prepared,
  };
  let announceStart!: () => void;
  let finish!: (result: GitDiffPreviewResult) => void;
  const started = new Promise<void>((resolve) => { announceStart = resolve; });
  const rendered = new Promise<GitDiffPreviewResult>((resolve) => { finish = resolve; });
  const desktop = {
    showPreview(id: string | null, geometry: PreviewBounds | null) {
      calls.push({ kind: 'show', id, bounds: geometry });
    },
    sendPreviewCommand(id: string, message: Record<string, unknown>) {
      if (message.command === 'marktex:position-preview') {
        calls.push({ kind: 'position', id, line: Number(message.sourceLine) });
      } else if (message.command === 'marktex:prime-review') {
        calls.push({ kind: 'prime', id, primeId: Number(message.primeId) });
      }
    },
    updateGitReviewState() {},
    destroyPreview() {},
    getTheme: async () => ({ id: 'paper', revision: 0 }),
    prepareGitDiffPreview() { announceStart(); return rendered; },
  } as unknown as DesktopPort;
  const controller = new SourceControlController({
    desktop,
    openWorkingTree: async () => true,
    activateWorkingTree: () => true,
    workingTreeBuffer: () => diff.modifiedText,
    workingTreeChanged() {},
    reviewChanged() {},
  });
  controllers.push(controller);
  project.gitDiffTabs.push(tab);
  return {
    controller, tab, calls, started,
    positions: () => calls.filter((call) => call.kind === 'position'),
    async finishPreview() {
      finish({ revision: 0, url: 'marktex-preview://document/test', themeId: 'paper', supported: true });
      await rendered;
      await Promise.resolve();
    },
  };
}

for (const staged of [false, true]) {
  test(`cold first Esc waits for layout (${staged ? 'staged' : 'working tree'})`, async () => {
    const f = fixture(staged);
    await f.controller.activateDiff(f.tab.id);
    f.controller.showRendered();
    assert.equal(f.positions().length, 0, 'must not measure an unsized native preview');
    f.controller.layoutDiff(bounds);
    assert.deepEqual(f.calls.slice(-2), [
      { kind: 'show', id: f.tab.previewId, bounds },
      { kind: 'position', id: f.tab.previewId, line: 120 },
    ]);
    f.controller.showRendered(); // duplicate DOM / IPC Escape must be idempotent
    assert.equal(f.positions().length, 1);
  });
}

test('null, zero-sized and non-finite bounds do not consume the position request', async () => {
  const f = fixture();
  await f.controller.activateDiff(f.tab.id);
  f.controller.showRendered();
  for (const invalid of [null, { ...bounds, width: 0 }, { ...bounds, height: 0 },
    { ...bounds, x: Number.NaN }, { ...bounds, width: Number.POSITIVE_INFINITY }]) {
    f.controller.layoutDiff(invalid);
    assert.equal(f.positions().length, 0);
  }
  f.controller.layoutDiff(bounds);
  assert.equal(f.positions().length, 1);
});

test('ordinary resize does not repeatedly snap back to the source cursor', async () => {
  const f = fixture();
  await f.controller.activateDiff(f.tab.id);
  f.controller.showRendered();
  f.controller.layoutDiff(bounds);
  f.controller.layoutDiff({ ...bounds, width: 700 });
  f.controller.layoutDiff({ ...bounds, width: 600 });
  assert.equal(f.positions().length, 1);
});

test('warm Esc also waits for current layout and keeps the user-selected source line', async () => {
  const f = fixture();
  await f.controller.activateDiff(f.tab.id);
  f.controller.showRendered();
  f.controller.layoutDiff(bounds);
  f.calls.length = 0;
  f.controller.toggleDiffMode(); // rendered -> source
  f.controller.layoutDiff(null);
  f.controller.updateSourceLine(175);
  f.controller.showRendered();
  assert.equal(f.positions().length, 0, 'old bounds must not authorize a new positioning request');
  const resized = { ...bounds, width: 620 };
  f.controller.layoutDiff(resized);
  assert.deepEqual(f.calls.slice(-2), [
    { kind: 'show', id: f.tab.previewId, bounds: resized },
    { kind: 'position', id: f.tab.previewId, line: 175 },
  ]);
});

for (const layoutFirst of [false, true]) {
  test(`Esc before render completes: ${layoutFirst ? 'layout' : 'render'} arrives first`, async () => {
    const f = fixture(false, false);
    await f.controller.activateDiff(f.tab.id);
    f.controller.showRendered();
    await f.started;
    assert.equal(f.positions().length, 0);
    if (layoutFirst) f.controller.layoutDiff(bounds);
    await f.finishPreview();
    if (!layoutFirst) {
      assert.equal(f.positions().length, 0, 'a ready page still needs native bounds');
      f.controller.layoutDiff(bounds);
    }
    assert.deepEqual(f.calls.slice(-2), [
      { kind: 'show', id: 'git-diff:review:a', bounds },
      { kind: 'position', id: 'git-diff:review:a', line: 120 },
    ]);
    assert.equal(f.positions().length, 1);
  });
}

for (const leave of ['source', 'close', 'deactivate'] as const) {
  test(`pending first position is cancelled on ${leave}`, async () => {
    const f = fixture();
    await f.controller.activateDiff(f.tab.id);
    f.controller.showRendered();
    if (leave === 'source') f.controller.toggleDiffMode();
    else if (leave === 'close') f.controller.closeDiff();
    else f.controller.deactivateDiff();
    f.controller.layoutDiff(bounds);
    assert.equal(f.positions().length, 0);
  });
}

test('a late layout after switching tabs does not position the old preview', async () => {
  const f = fixture();
  await f.controller.activateDiff(f.tab.id);
  f.controller.showRendered();
  const second: GitDiffTabState = {
    ...f.tab, id: 'second', mode: 'source', line: 70, previewId: 'git-diff:second:a',
  };
  project.gitDiffTabs.push(second);
  await f.controller.activateDiff(second.id);
  f.controller.layoutDiff(bounds);
  assert.equal(f.positions().length, 0);
  f.controller.showRendered();
  assert.deepEqual(f.positions(), [{ kind: 'position', id: second.previewId, line: 70 }]);
});

test('acknowledged source prewarm makes warm Esc a show-only native transition', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  const f = fixture();
  try {
    await f.controller.activateDiff(f.tab.id);
    f.controller.layoutDiff(bounds);
    await vi.advanceTimersByTimeAsync(0);
    const prime = f.calls.find((call): call is Extract<Call, { kind: 'prime' }> => call.kind === 'prime');
    assert.ok(prime);
    assert.equal(f.controller.previewMessage({
      tabId: prime.id,
      message: { type: 'marktex:review-primed', primeId: prime.primeId },
    }), true);
    f.calls.length = 0;
    f.controller.showRendered();
    assert.deepEqual(f.calls.filter((call) => call.kind === 'position'), []);
    assert.deepEqual(f.calls.find((call) => call.kind === 'show'), {
      kind: 'show', id: f.tab.previewId, bounds,
    });
  } finally {
    vi.useRealTimers();
  }
});
