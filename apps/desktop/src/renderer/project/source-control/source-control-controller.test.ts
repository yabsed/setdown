import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { GitDiff, GitDiffPreviewResult, PreviewBounds } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project, type GitDiffTabState } from '../project-state.svelte';
import { SourceControlController } from './source-control-controller';
import { LiveDocumentModelPort } from '../../editor/live-document-model';

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
  const models = new LiveDocumentModelPort();
  let buffer = 'after';
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
      if (message.command === 'marktex:position-preview' || message.command === 'marktex:prepare-review') {
        calls.push({ kind: 'position', id, line: Number(message.sourceLine) });
        if (message.command === 'marktex:prepare-review') controller.previewMessage({ tabId: id, message: {
          type: 'marktex:review-prepared', revision: message.revision, requestId: message.requestId,
        } });
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
    desktop, models,
    openWorkingTree: async () => true,
    activateWorkingTree: () => true,
    workingTreeBuffer: () => buffer,
    workingTreeChanged() {},
    reviewChanged() {},
  });
  // A resident ID is not readiness. Seed its exact completed input and ACK
  // final positioning above; separate tests deliberately withhold these ACKs.
  const state = controller as unknown as {
    themeId: string;
    preparedPreviews: Map<string, { diff: GitDiff; revision: number; themeId: string }>;
  };
  const prepare = (target: GitDiffTabState) => {
    state.themeId = 'paper';
    state.preparedPreviews.set(target.previewId!, { diff: target.diff!, revision: 0, themeId: 'paper' });
  };
  if (prepared) prepare(tab);
  controllers.push(controller);
  project.gitDiffTabs.push(tab);
  return {
    controller, tab, calls, started, models, prepare,
    edit(text: string) { buffer = text; models.publish({ type: 'changed', path: tab.filePath, text }); },
    positions: () => calls.filter((call) => call.kind === 'position'),
    async finishPreview() {
      finish({ revision: 0, url: 'marktex-preview://document/test', themeId: 'paper', supported: true });
      await rendered;
      for (let i = 0; i < 8; i++) await Promise.resolve();
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
      { kind: 'position', id: f.tab.previewId, line: 120 },
      { kind: 'show', id: f.tab.previewId, bounds },
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
      { kind: 'position', id: 'git-diff:review:a', line: 120 },
      { kind: 'show', id: 'git-diff:review:a', bounds },
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
  project.gitDiffTabs.push(second); f.prepare(second);
  await f.controller.activateDiff(second.id);
  f.controller.layoutDiff(bounds);
  assert.equal(f.positions().length, 0);
  f.controller.showRendered();
  assert.deepEqual(f.positions(), [{ kind: 'position', id: second.previewId, line: 70 }]);
});

test('a prewarm ACK cannot suppress the final navigation intent', async () => {
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
      message: { type: 'marktex:review-primed', primeId: 123, revision: 0 },
    }), true);
    f.calls.length = 0;
    f.controller.showRendered();
    assert.deepEqual(f.positions(), [{ kind: 'position', id: f.tab.previewId, line: 120 }]);
    assert.deepEqual(f.calls.find((call) => call.kind === 'show'), {
      kind: 'show', id: f.tab.previewId, bounds,
    });
  } finally {
    vi.useRealTimers();
  }
});


for (const revision of [0, 1, 99]) test(`obsolete ACK revision ${revision} never suppresses current line`, async () => {
  const f = fixture();
  await f.controller.activateDiff(f.tab.id);
  f.controller.layoutDiff(bounds);
  f.controller.previewMessage({ tabId: f.tab.previewId!, message: {
    type: 'marktex:review-primed', primeId: 1, revision, sourceLine: 1,
  } });
  f.controller.updateSourceLine(170);
  f.controller.showRendered();
  assert.deepEqual(f.positions().at(-1), { kind: 'position', id: f.tab.previewId, line: 170 });
});

test('edits and Undo from either surface update the same review snapshot once, not the Index', async () => {
  const f = fixture();
  await f.controller.activateDiff(f.tab.id);
  const index = { ...f.tab, id: 'index', staged: true, diff: { ...f.tab.diff!, staged: true } };
  project.gitDiffTabs.push(index);
  f.edit('new live text');
  assert.equal(f.tab.diff?.modifiedText, 'new live text');
  assert.equal(index.diff.modifiedText, 'after');
  f.edit('after');
  assert.equal(f.tab.diff?.modifiedText, 'after');
});

test('first edit and Esc during initial rendering retain the source intent when the page arrives', async () => {
  const f = fixture(false, false);
  await f.controller.activateDiff(f.tab.id);
  await f.started;
  f.edit('first user edit');
  f.controller.updateSourceLine(180);
  f.controller.layoutDiff(bounds);
  f.controller.showRendered();
  await f.finishPreview();
  assert.deepEqual(f.positions()[0], { kind: 'position', id: 'git-diff:review:a', line: 180 });
});

test('closing the document closes its borrowed Working Tree, not unrelated Index snapshots', async () => {
  const f = fixture();
  await f.controller.activateDiff(f.tab.id);
  const index = { ...f.tab, id: 'index', staged: true, diff: { ...f.tab.diff!, staged: true } };
  project.gitDiffTabs.push(index);
  f.models.publish({ type: 'closed', path: f.tab.filePath });
  assert.deepEqual(project.gitDiffTabs.map(tab => tab.id), ['index']);
});
