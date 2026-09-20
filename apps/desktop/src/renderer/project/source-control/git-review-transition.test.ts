import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import type { GitDiff, GitDiffPreviewResult, PreviewMessage } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project, type GitDiffTabState } from '../project-state.svelte';
import { SourceControlController } from './source-control-controller';
import { GitDiffViewportPort } from './git-diff-viewport';
import { reviewViewport } from '../../../core/preview/review-viewport';

vi.mock('../project-state.svelte', () => ({ project: {} }));
vi.mock('../../../core/diff/text-diff', () => ({ textDiffHunks: () => [] }));
const controllers: SourceControlController[] = [];
afterEach(() => { controllers.splice(0).forEach((c) => c.clear()); vi.unstubAllGlobals(); vi.useRealTimers(); });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture() {
  const events = new EventTarget(); vi.stubGlobal('window', events);
  Object.assign(project, { gitDiffTabs: [], gitDiffActive: true, activeGitDiffId: 'r',
    gitDiffMode: 'source', gitDiffLine: 200, gitDiffTarget: null, gitBusy: false, error: '',
    gitDiffTransitionPending: false, gitDiffTransitionNotice: false, gitDiffTransitionError: '' });
  let text = 'latest';
  const diff: GitDiff = { filePath: '/p/a.md', path: 'a.md', staged: false, originalText: 'base',
    modifiedText: text, originalLabel: 'INDEX', modifiedLabel: 'WORKTREE', patch: '', hunks: [] };
  const tab: GitDiffTabState = { id: 'r', filePath: diff.filePath, staged: false, line: 200, mode: 'source', diff,
    loading: false, previewId: null, pendingPreviewId: null, previewLoading: false, previewDirty: true };
  project.gitDiffTabs.push(tab); project.gitDiff = diff;
  const calls: { id: string; diff: GitDiff; resolve(value: GitDiffPreviewResult): void; reject(error: Error): void }[] = [];
  const commands: { id: string; message: Record<string, unknown> }[] = [];
  const shows: { id: string | null; mode: string; pending: boolean }[] = [];
  let showFails = false;
  const viewport = new GitDiffViewportPort();
  const source = reviewViewport(200); source.anchor.yRatio = .65; source.anchor.sourceColumn = 17;
  source.sourceSide = 'before'; source.band = [{ sourceLine: 195, yRatio: .3 }, { sourceLine: 201, yRatio: .8 }];
  viewport.register(() => source);
  const controller = new SourceControlController({
    desktop: { getTheme: async () => ({ id: 'paper' }),
      prepareGitDiffPreview: (id: string, input: GitDiff) => new Promise<GitDiffPreviewResult>((resolve, reject) => calls.push({ id, diff: input, resolve, reject })),
      showPreview: (id: string | null) => { if (id && showFails) throw new Error('show failed');
        shows.push({ id, mode: project.gitDiffMode, pending: project.gitDiffTransitionPending }); },
      sendPreviewCommand: (id: string, message: Record<string, unknown>) => commands.push({ id, message }),
      updateGitReviewState() {}, destroyPreview() {},
    } as unknown as DesktopPort, viewport,
    openWorkingTree: async () => true, activateWorkingTree: () => true, workingTreeBuffer: () => text,
    workingTreeChanged: (_path, value) => { text = value; }, reviewChanged() {},
  });
  controllers.push(controller); controller.layoutDiff({ x: 20, y: 80, width: 900, height: 700 });
  const finish = async (index = calls.length - 1) => {
    calls[index].resolve({ revision: index + 1, url: 'marktex-preview://document/test', themeId: 'paper', supported: true }); await tick();
  };
  const request = () => commands.filter((c) => c.message.command === 'marktex:prepare-review').at(-1)!;
  const ack = (entry = request(), overrides: Record<string, unknown> = {}) => controller.previewMessage({ tabId: entry.id, message: {
    type: 'marktex:review-prepared', requestId: entry.message.requestId, revision: entry.message.revision, ...overrides,
  } } as PreviewMessage);
  return { controller, tab, events, calls, commands, shows, viewport, source, finish, request, ack,
    failShow: () => { showFails = true; } };
}

test('Esc retains live Source through both typesetting and final positioning; native show is requested first', async () => {
  const f = fixture(); f.controller.showRendered(); await tick();
  assert.equal(project.gitDiffMode, 'source'); assert.equal(f.tab.mode, 'source');
  assert.equal(project.gitDiffTransitionPending, true); assert.equal(project.gitDiffLine, 200);
  await f.finish(); assert.equal(project.gitDiffMode, 'source');
  assert.equal(f.shows.some((call) => call.id), false);
  assert.equal(f.request().message.sourceLine, 200); assert.equal(f.request().message.sourceSide, 'before');
  f.ack();
  assert.deepEqual(f.shows.filter((call) => call.id), [{ id: 'git-diff:r:a', mode: 'source', pending: true }]);
  assert.equal(project.gitDiffMode, 'rendered'); assert.equal(project.gitDiffTransitionPending, false);
  assert.ok(f.commands.some((c) => c.message.command === 'marktex:verify-review-position'));
});
test('a mutable viewport and an old prewarm cannot overwrite the captured Escape position', async () => {
  const frames: FrameRequestCallback[] = []; vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  const f = fixture(); f.viewport.changed(); f.controller.showRendered();
  f.source.anchor.sourceLine = 1; f.source.band[0].sourceLine = 1;
  frames.splice(0).forEach((cb) => cb(0)); await tick(); await f.finish();
  assert.equal(f.request().message.sourceLine, 200);
  assert.deepEqual(f.request().message.band, [{ sourceLine: 195, yRatio: .3 }, { sourceLine: 201, yRatio: .8 }]);
});
for (const cancel of ['input', 'toggle', 'deactivate', 'close', 'overlay'] as const) {
  test(`${cancel} cancels pending show without applying an old source target`, async () => {
    const f = fixture(); f.controller.showRendered(); await tick(); await f.finish(); const old = f.request();
    if (cancel === 'input') f.viewport.interact();
    if (cancel === 'toggle') f.controller.toggleDiffMode();
    if (cancel === 'deactivate') f.controller.deactivateDiff();
    if (cancel === 'close') f.controller.closeDiff();
    if (cancel === 'overlay') f.events.dispatchEvent(Object.assign(new Event('setdown:native-overlay-visibility'), { detail: true }));
    f.ack(old);
    assert.equal(project.gitDiffMode, 'source'); assert.equal(project.gitDiffTransitionPending, false);
    assert.equal(f.shows.some((call) => call.id), false); assert.equal(f.viewport.takeSourceTarget('r'), null);
  });
}
test('typing while preparation is in flight keeps editing and does not auto-switch when latest prerender finishes', async () => {
  const f = fixture(); f.controller.showRendered(); await tick();
  f.controller.changeWorkingTree('continue editing');
  assert.equal(project.gitDiffMode, 'source'); assert.equal(project.gitDiffTransitionPending, false);
  await f.finish(0); await f.finish(1);
  assert.equal(f.calls[1].diff.modifiedText, 'continue editing'); assert.equal(f.shows.some((call) => call.id), false);
  f.controller.showRendered(); f.ack(); assert.equal(project.gitDiffMode, 'rendered');
});
for (const failure of ['render', 'position', 'show', 'timeout'] as const) {
  test(`${failure} failure keeps Source and permits another Escape`, async () => {
    vi.useFakeTimers(); const f = fixture(); f.controller.showRendered(); await tick();
    if (failure === 'render') { f.calls[0].reject(new Error('render failed')); await tick(); }
    else {
      await f.finish();
      if (failure === 'position') f.ack(undefined, { error: 'position failed' });
      if (failure === 'show') { f.failShow(); f.ack(); }
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(5000);
    }
    assert.equal(project.gitDiffMode, 'source'); assert.equal(project.gitDiffTransitionPending, false);
    assert.notEqual(project.gitDiffTransitionError, ''); assert.equal(f.viewport.takeSourceTarget('r'), null);
    assert.equal(f.shows.some((call) => call.id), false);
    f.controller.showRendered(); assert.equal(project.gitDiffTransitionPending, true); assert.equal(project.gitDiffTransitionError, '');
  });
}
test('duplicate Escape and passive viewport updates cannot cancel or duplicate work', async () => {
  const f = fixture(); f.controller.showRendered(); await tick(); f.controller.showRendered(); f.viewport.changed();
  assert.equal(f.calls.length, 1); assert.equal(project.gitDiffTransitionPending, true);
  await f.finish(); const first = f.request(); f.controller.showRendered();
  assert.equal(f.request(), first); f.ack();
  f.controller.toggleDiffMode(); f.commands.length = 0;
  f.controller.showRendered(); assert.equal(project.gitDiffMode, 'rendered');
  assert.equal(f.commands.some((c) => c.message.command === 'marktex:prepare-review'), false);
});
test('resized pending viewport rejects old ACK, preserves captured target and completes at the new bounds', async () => {
  const f = fixture(); f.controller.showRendered(); await tick(); await f.finish(); const old = f.request();
  f.controller.layoutDiff({ x: 20, y: 80, width: 600, height: 700 }); f.ack(old);
  assert.equal(project.gitDiffMode, 'source'); assert.equal(f.request().message.sourceLine, 200);
  f.ack(); assert.equal(project.gitDiffMode, 'rendered');
});
