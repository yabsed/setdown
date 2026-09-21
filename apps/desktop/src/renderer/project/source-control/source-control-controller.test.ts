import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { GitDiff, GitDiffPreviewResult, PreviewBounds } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project, type GitDiffTabState } from '../project-state.svelte';
import { SourceControlController } from './source-control-controller';
import { LiveDocumentModelPort } from '../../editor/live-document-model';

vi.mock('../project-state.svelte', () => ({ project: {} }));
const bounds: PreviewBounds = { x: 260, y: 84, width: 850, height: 650 };
type Call = { kind: 'show'; id: string | null; bounds: PreviewBounds | null }
  | { kind: 'position'; id: string; line: number }
  | { kind: 'prime'; id: string }
  | { kind: 'prepare'; id: string; line: number; revision: number; requestId: string };
const controllers: SourceControlController[] = [];
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener() {},
    setTimeout: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
  });
  Object.assign(project, {
    gitDiffTabs: [], activeGitDiffId: null, gitDiff: null, gitDiffActive: false,
    gitDiffMode: 'source', gitDiffLine: 1, gitDiffTarget: null,
    gitLoading: false, gitBusy: false, error: '',
  });
});
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Populate readiness through the public rendering response, never a fabricated
 * previewId. Native preparation ACKs are explicit and can be delayed/superseded.
 */
function fixture(staged = false, automaticRendering = true) {
  const calls: Call[] = [];
  const models = new LiveDocumentModelPort();
  let buffer = 'after';
  const diff: GitDiff = {
    path: 'notes.md', filePath: '/project/notes.md', staged, patch: '',
    originalText: 'before', modifiedText: 'after',
    originalLabel: staged ? 'HEAD' : 'INDEX', modifiedLabel: staged ? 'INDEX' : 'WORKTREE',
    hunks: [{ oldStart: 120, oldLines: 1, newStart: 120, newLines: 1 }],
  };
  const tab: GitDiffTabState = {
    id: 'review', filePath: diff.filePath, staged, mode: 'source', line: 120,
    diff, loading: false, previewId: null, pendingPreviewId: null,
    previewLoading: false, previewDirty: true,
  };
  const pendingRenders: Array<() => void> = [];
  let revision = 0;
  const desktop = {
    showPreview(id: string | null, geometry: PreviewBounds | null) {
      calls.push({ kind: 'show', id, bounds: geometry });
    },
    sendPreviewCommand(id: string, message: Record<string, unknown>) {
      if (message.command === 'marktex:position-preview')
        calls.push({ kind: 'position', id, line: Number(message.sourceLine) });
      else if (message.command === 'marktex:prime-review') calls.push({ kind: 'prime', id });
      else if (message.command === 'marktex:prepare-review') calls.push({ kind: 'prepare', id,
        line: Number(message.sourceLine), revision: Number(message.revision), requestId: String(message.requestId) });
    },
    updateGitReviewState() {}, destroyPreview() {},
    getTheme: async () => ({ id: 'paper', revision: 0 }),
    prepareGitDiffPreview() {
      const result: GitDiffPreviewResult = { revision: ++revision,
        url: 'marktex-preview://document/test', themeId: 'paper', supported: true };
      return automaticRendering ? Promise.resolve(result)
        : new Promise<GitDiffPreviewResult>(resolve => pendingRenders.push(() => resolve(result)));
    },
  } as unknown as DesktopPort;
  const controller = new SourceControlController({ desktop, models,
    openWorkingTree: async () => true, activateWorkingTree: () => true,
    workingTreeBuffer: () => buffer, workingTreeChanged() {}, reviewChanged() {},
  });
  controllers.push(controller);
  project.gitDiffTabs.push(tab);
  const preparations = () => calls.filter((call): call is Extract<Call, { kind: 'prepare' }> => call.kind === 'prepare');
  return {
    controller, tab, calls, models, preparations,
    async activate(id = tab.id) { await controller.activateDiff(id); await flush(); },
    edit(text: string) { buffer = text; models.publish({ type: 'changed', path: tab.filePath, text }); },
    shown: () => calls.filter(call => call.kind === 'show' && call.id !== null),
    positions: () => calls.filter(call => call.kind === 'position'),
    ack(request = preparations().at(-1)!, override: Record<string, unknown> = {}) {
      assert.ok(request, 'a final preparation must have been requested');
      controller.previewMessage({ tabId: request.id, message: { type: 'marktex:review-prepared',
        requestId: request.requestId, revision: request.revision, ...override } });
    },
    async finishPreview() {
      const finish = pendingRenders.shift();
      assert.ok(finish, 'the application must actually request a render');
      finish(); await flush();
    },
  };
}

for (const staged of [false, true]) test(`cold first Esc waits for bounds and ACK (${staged ? 'staged' : 'working tree'})`, async () => {
  const f = fixture(staged); await f.activate();
  f.controller.showRendered();
  assert.equal(f.preparations().length, 0, 'never position an unsized preview');
  f.controller.layoutDiff(bounds);
  assert.equal(f.preparations().length, 1);
  assert.equal(f.preparations()[0].line, 120);
  assert.deepEqual(f.shown(), [], 'latest HTML alone cannot authorize first presentation');
  f.ack();
  assert.deepEqual(f.shown(), [{ kind: 'show', id: f.tab.previewId, bounds }]);
  assert.deepEqual(f.positions(), [], 'no redundant positioning after the final ACK');
  f.controller.showRendered();
  assert.equal(f.preparations().length, 1, 'duplicate Esc is idempotent');
});

test('invalid bounds do not consume the final position request', async () => {
  const f = fixture(); await f.activate(); f.controller.showRendered();
  for (const invalid of [null, { ...bounds, width: 0 }, { ...bounds, height: 0 },
    { ...bounds, x: NaN }, { ...bounds, width: Infinity }]) {
    f.controller.layoutDiff(invalid);
    assert.equal(f.preparations().length, 0);
    assert.equal(f.shown().length, 0);
  }
  f.controller.layoutDiff(bounds); f.ack();
  assert.equal(f.shown().length, 1);
});

test('ordinary resize does not snap back or restart preparation after presentation', async () => {
  const f = fixture(); await f.activate(); f.controller.showRendered();
  f.controller.layoutDiff(bounds); f.ack();
  f.controller.layoutDiff({ ...bounds, width: 700 });
  f.controller.layoutDiff({ ...bounds, width: 600 });
  assert.equal(f.preparations().length, 1);
  assert.equal(f.positions().length, 0);
});

test('warm Esc uses current layout and source line without another preparation ACK', async () => {
  const f = fixture(); await f.activate(); f.controller.showRendered();
  f.controller.layoutDiff(bounds); f.ack(); f.calls.length = 0;
  f.controller.toggleDiffMode(); f.controller.layoutDiff(null);
  f.controller.updateSourceLine(175); f.controller.showRendered();
  assert.equal(f.positions().length, 0);
  const resized = { ...bounds, width: 620 }; f.controller.layoutDiff(resized);
  assert.deepEqual(f.shown(), [{ kind: 'show', id: f.tab.previewId, bounds: resized }]);
  assert.deepEqual(f.positions(), [{ kind: 'position', id: f.tab.previewId, line: 175 }]);
  assert.equal(f.preparations().length, 0);
});

for (const layoutFirst of [false, true]) test(`Esc before rendering: ${layoutFirst ? 'layout' : 'render'} arrives first`, async () => {
  const f = fixture(false, false); await f.activate(); f.controller.showRendered();
  if (layoutFirst) f.controller.layoutDiff(bounds);
  await f.finishPreview();
  if (!layoutFirst) {
    assert.equal(f.preparations().length, 0);
    f.controller.layoutDiff(bounds);
  }
  assert.equal(f.preparations().length, 1);
  assert.equal(f.preparations()[0].line, 120);
  assert.equal(f.shown().length, 0);
  f.ack();
  assert.deepEqual(f.shown(), [{ kind: 'show', id: 'git-diff:review:a', bounds }]);
});

for (const leave of ['source', 'close', 'deactivate'] as const) test(`late preparation ACK cannot reveal after ${leave}`, async () => {
  const f = fixture(); await f.activate(); f.controller.showRendered(); f.controller.layoutDiff(bounds);
  const request = f.preparations()[0]; assert.ok(request);
  if (leave === 'source') f.controller.toggleDiffMode();
  else if (leave === 'close') f.controller.closeDiff();
  else f.controller.deactivateDiff();
  f.controller.layoutDiff(bounds); f.ack(request);
  assert.equal(f.shown().length, 0);
});

test('late layout and ACK after a tab switch cannot present the old preview', async () => {
  const f = fixture(); await f.activate(); f.controller.showRendered(); f.controller.layoutDiff(bounds);
  const old = f.preparations()[0];
  const second: GitDiffTabState = { ...f.tab, id: 'second', mode: 'source', line: 70,
    previewId: null, previewDirty: true };
  project.gitDiffTabs.push(second); await f.activate(second.id);
  f.controller.layoutDiff(bounds); f.ack(old);
  assert.equal(f.shown().length, 0);
  f.controller.showRendered();
  assert.equal(f.preparations().at(-1)?.line, 70);
  f.ack();
  assert.deepEqual(f.shown(), [{ kind: 'show', id: second.previewId, bounds }]);
});

test('a prewarm ACK cannot suppress the final navigation intent', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const f = fixture(); await f.activate(); f.controller.layoutDiff(bounds);
  await vi.advanceTimersByTimeAsync(0);
  assert.ok(f.calls.some(call => call.kind === 'prime'));
  f.controller.previewMessage({ tabId: f.tab.previewId!,
    message: { type: 'marktex:review-primed', primeId: 123, revision: 1 } });
  f.calls.length = 0; f.controller.showRendered();
  assert.equal(f.preparations().length, 1);
  assert.equal(f.preparations()[0].line, 120);
  assert.equal(f.shown().length, 0);
  f.ack(); assert.equal(f.shown().length, 1);
});

for (const revision of [0, 2, 99]) test(`wrong ACK revision ${revision} cannot commit the current line`, async () => {
  const f = fixture(); await f.activate(); f.controller.layoutDiff(bounds);
  f.controller.updateSourceLine(170); f.controller.showRendered();
  const request = f.preparations()[0];
  assert.equal(request.line, 170); assert.equal(request.revision, 1);
  f.ack(request, { revision }); assert.equal(f.shown().length, 0);
  f.ack(request); assert.equal(f.shown().length, 1);
});

test('edits and Undo update the same Working Tree snapshot, not the Index', async () => {
  const f = fixture(); await f.activate();
  const index = { ...f.tab, id: 'index', staged: true, diff: { ...f.tab.diff!, staged: true } };
  project.gitDiffTabs.push(index);
  f.edit('new live text');
  assert.equal(f.tab.diff?.modifiedText, 'new live text'); assert.equal(index.diff.modifiedText, 'after');
  f.edit('after'); assert.equal(f.tab.diff?.modifiedText, 'after');
});

test('first edit during initial rendering waits for latest content and retains Esc intent', async () => {
  const f = fixture(false, false); await f.activate();
  f.edit('first user edit'); f.controller.updateSourceLine(180);
  f.controller.layoutDiff(bounds); f.controller.showRendered();
  await f.finishPreview();
  assert.equal(f.preparations().length, 0, 'obsolete HTML cannot be prepared for presentation');
  assert.equal(f.shown().length, 0);
  await f.finishPreview();
  assert.equal(f.preparations()[0].line, 180);
  assert.equal(f.preparations()[0].revision, 2);
  f.ack(); assert.equal(f.shown().length, 1);
});

test('closing a document closes its Working Tree, not unrelated Index snapshots', async () => {
  const f = fixture(); await f.activate();
  const index = { ...f.tab, id: 'index', staged: true, diff: { ...f.tab.diff!, staged: true } };
  project.gitDiffTabs.push(index);
  f.models.publish({ type: 'closed', path: f.tab.filePath });
  assert.deepEqual(project.gitDiffTabs.map(tab => tab.id), ['index']);
});

test('restoring an inactive Working Tree review does not activate or suspend its ordinary document', async () => {
  project.folder = { path: '/project', name: 'project' };
  const activate = vi.fn(() => true);
  const open = vi.fn(async () => true);
  const changed = vi.fn();
  const desktop = {
    getGitReviewState: async () => ({ name: 'notes.md', path: '/project/notes.md', dirty: false,
      isUntitled: false, staged: false, active: false, mode: 'source', line: 1 }),
    getGitDiff: () => new Promise(() => {}),
    showPreview() {}, updateGitReviewState() {}, destroyPreview() {},
  } as unknown as DesktopPort;
  const controller = new SourceControlController({ desktop,
    activateWorkingTree: activate, openWorkingTree: open, workingTreeBuffer: () => null,
    workingTreeChanged() {}, reviewChanged: changed });
  controllers.push(controller);
  await controller.restore();
  assert.equal(project.gitDiffTabs.length, 1);
  assert.equal(project.gitDiffActive, false);
  assert.equal(activate.mock.calls.length, 0);
  assert.equal(open.mock.calls.length, 0);
  assert.deepEqual(changed.mock.calls, [[true, false]]);
});
