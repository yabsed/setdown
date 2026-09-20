import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type { GitDiff, GitDiffPreviewResult, PreviewBounds } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project, type GitDiffTabState } from '../project-state.svelte';
import { SourceControlController } from './source-control-controller';
import { GitDiffViewportPort } from './git-diff-viewport';
import { reviewViewport } from '../../../core/preview/review-viewport';

vi.mock('../project-state.svelte', () => ({ project: {} }));
const controllers: SourceControlController[] = [];
const bounds: PreviewBounds = { x: 260, y: 70, width: 900, height: 700 };
beforeEach(() => {
  vi.stubGlobal('window', { addEventListener() {}, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout });
  Object.assign(project, { gitDiffTabs: [], activeGitDiffId: null, gitDiffActive: false,
    gitDiffMode: 'source', gitDiffLine: 1, gitDiff: null, gitDiffTarget: null,
    gitBusy: false, error: '' });
});
afterEach(() => { controllers.splice(0).forEach((controller) => controller.clear()); vi.unstubAllGlobals(); });

function fixture(staged = false) {
  const commands: { id: string; message: Record<string, unknown> }[] = [];
  const shows: (string | null)[] = [];
  const viewport = new GitDiffViewportPort();
  const diff: GitDiff = { path: 'notes.md', filePath: '/project/notes.md', staged, patch: '',
    originalText: 'before', modifiedText: 'after', originalLabel: 'INDEX', modifiedLabel: 'WORKTREE',
    hunks: [{ oldStart: 80, oldLines: 1, newStart: 80, newLines: 1 }] };
  const tab: GitDiffTabState = { id: 'review', filePath: diff.filePath, staged, mode: 'source',
    line: 80, diff, loading: false, previewId: 'git-diff:review:a', pendingPreviewId: null,
    previewLoading: false, previewDirty: false };
  let resolveRender!: (value: GitDiffPreviewResult) => void;
  let signalStart!: () => void;
  const started = new Promise<void>((resolve) => { signalStart = resolve; });
  const render = new Promise<GitDiffPreviewResult>((resolve) => { resolveRender = resolve; });
  let buffer = diff.modifiedText;
  const controller = new SourceControlController({
    desktop: { showPreview(id: string | null) { shows.push(id); },
      sendPreviewCommand(id: string, message: Record<string, unknown>) { commands.push({ id, message }); },
      destroyPreview() {}, updateGitReviewState() {}, getTheme: async () => ({ id: 'paper' }),
      prepareGitDiffPreview: () => { signalStart(); return render; },
    } as unknown as DesktopPort,
    viewport, openWorkingTree: async () => true, activateWorkingTree: () => true,
    workingTreeBuffer: () => buffer, workingTreeChanged(_path, text) { buffer = text; }, reviewChanged() {},
  });
  // Model the completed page explicitly; a previewId alone is not proof that
  // its content matches the current buffer. Native presentation is ACKed below.
  const state = controller as unknown as {
    themeId: string;
    preparedPreviews: Map<string, { diff: GitDiff; revision: number; themeId: string }>;
  };
  state.themeId = 'paper';
  state.preparedPreviews.set(tab.previewId!, { diff, revision: 0, themeId: 'paper' });
  controllers.push(controller); project.gitDiffTabs.push(tab);
  const positions = () => commands.filter((command) =>
    ['marktex:position-preview', 'marktex:prepare-review'].includes(String(command.message.command)));
  const ack = () => {
    const request = commands.filter((command) => command.message.command === 'marktex:prepare-review').at(-1);
    if (request) controller.previewMessage({ tabId: request.id, message: {
      type: 'marktex:review-prepared', requestId: request.message.requestId, revision: request.message.revision,
    } });
  };
  const token = () => commands.filter((command) => command.message.command === 'marktex:observe-viewport'
    && typeof command.message.observationId === 'number').at(-1)!.message.observationId as number;
  const sample = (line: number, extra: Record<string, unknown> = {}, id = tab.previewId!, observationId = token()) => {
    controller.previewMessage({ tabId: id, message: { type: 'marktex:viewport-state',
      source: 'crossnote', observationId, sequence: 1,
      anchor: { sourceLine: line, yRatio: .6, sourceSide: 'after', blockOffset: .4 }, ...extra } });
  };
  return { controller, tab, viewport, commands, shows, positions, token, sample, started, ack,
    async open() { await controller.activateDiff(tab.id); controller.showRendered(); controller.layoutDiff(bounds); ack(); },
    async finish() { resolveRender({ revision: 0, url: 'marktex-preview://document/new', themeId: 'paper', supported: true });
      await render; for (let i = 0; i < 8; i++) await Promise.resolve(); ack(); },
  };
}

for (const staged of [false, true]) test(`same-page Viewer resume never repositions (${staged})`, async () => {
  const f = fixture(staged); await f.open(); f.sample(300);
  f.commands.length = 0; f.controller.deactivateDiff();
  await f.controller.activateDiff(f.tab.id); f.controller.layoutDiff(bounds);
  assert.equal(project.gitDiffMode, 'rendered');
  assert.equal(f.positions().length, 0);
  assert.equal(f.tab.line, 80, 'reading does not overwrite source cursor');
  assert.equal(f.shows.at(-1), f.tab.previewId);
});

test('Esc samples the live reader synchronously and passes cursor height and column', async () => {
  const f = fixture(); const source = reviewViewport(175); source.anchor.yRatio = .81; source.anchor.sourceColumn = 24;
  let reads = 0; f.viewport.register((id) => { assert.equal(id, f.tab.id); reads++; return source; });
  await f.open();
  assert.equal(reads, 1);
  assert.equal(f.positions()[0].message.sourceLine, 175);
  assert.equal(f.positions()[0].message.topRatio, .81);
  assert.deepEqual(f.positions()[0].message.band, []);
  f.controller.showRendered(); assert.equal(reads, 1, 'duplicate Escape is idempotent');
});

test('Esc carries the visible band when the cursor is offscreen', async () => {
  const f = fixture(); const source = reviewViewport(240);
  source.band = [{ sourceLine: 236, yRatio: .2 }, { sourceLine: 247, yRatio: .8 }];
  f.viewport.register(() => source); await f.open();
  assert.deepEqual(f.positions()[0].message.band, source.band);
});

test('original-side navigation keeps its own coordinates', async () => {
  const f = fixture(); const source = reviewViewport(500); source.sourceSide = 'before';
  f.viewport.register(() => source); await f.open();
  assert.equal(f.positions()[0].message.sourceSide, 'before');
  assert.equal(f.positions()[0].message.sourceLine, 500);
});

test('first Esc retains intent until both page and bounds are ready', async () => {
  const f = fixture(); await f.controller.activateDiff(f.tab.id);
  f.controller.showRendered(); assert.equal(f.positions().length, 0);
  f.controller.layoutDiff({ ...bounds, width: 0 }); assert.equal(f.positions().length, 0);
  f.controller.layoutDiff(bounds); assert.equal(f.positions().length, 1); f.ack();
  f.controller.layoutDiff({ ...bounds, width: 500 }); assert.equal(f.positions().length, 1);
});

test('resuming after a layout change restores the Viewer bookmark, not the source line', async () => {
  const f = fixture(); await f.open(); f.sample(300);
  f.controller.deactivateDiff(); f.commands.length = 0;
  await f.controller.activateDiff(f.tab.id); f.controller.layoutDiff({ ...bounds, width: 620 });
  assert.equal(f.positions().at(-1)?.message.sourceLine, 300);
  assert.equal(f.positions().at(-1)?.message.blockOffset, .4);
});

test('hidden A/B and obsolete observation messages cannot overwrite reading state', async () => {
  const f = fixture(); await f.open(); f.sample(300);
  f.sample(1, {}, 'git-diff:review:b'); f.sample(2, {}, f.tab.previewId!, f.token() - 1);
  f.sample(3, { sequence: 0 }); f.sample(4, { sequence: 2, anchor: { sourceLine: NaN, yRatio: 0 } });
  f.controller.deactivateDiff(); f.commands.length = 0;
  await f.controller.activateDiff(f.tab.id); f.controller.layoutDiff({ ...bounds, height: 650 });
  assert.equal(f.positions().at(-1)?.message.sourceLine, 300);
});

test('final scroll sample after deactivation still belongs to its original tab', async () => {
  const f = fixture(); await f.open(); const token = f.token();
  f.controller.deactivateDiff(); f.sample(325, { sequence: 2 }, f.tab.previewId!, token);
  f.commands.length = 0; await f.controller.activateDiff(f.tab.id);
  f.controller.layoutDiff({ ...bounds, height: 650 });
  assert.equal(f.positions().at(-1)?.message.sourceLine, 325);
});

for (const active of [true, false]) test(`A/B completion restores reading position (active=${active})`, async () => {
  const f = fixture(); await f.open(); f.sample(300);
  f.tab.previewDirty = true;
  f.controller.deactivateDiff(); await f.controller.activateDiff(f.tab.id);
  f.controller.layoutDiff(bounds); await f.started;
  if (!active) f.controller.deactivateDiff();
  f.commands.length = 0; await f.finish();
  if (!active) { assert.equal(f.positions().length, 0); await f.controller.activateDiff(f.tab.id); f.controller.layoutDiff(bounds); }
  assert.equal(f.tab.previewId, 'git-diff:review:b');
  assert.equal(f.positions().at(-1)?.message.sourceLine, 300);
  assert.equal(f.positions().at(-1)?.message.blockOffset, .4);
});

test('new Esc wins over an old Viewer bookmark and old samples', async () => {
  const f = fixture(); await f.open(); f.sample(300); const token = f.token();
  f.controller.toggleDiffMode();
  f.viewport.register(() => reviewViewport(450));
  f.commands.length = 0; f.controller.showRendered(); f.controller.layoutDiff(bounds);
  f.sample(3, { sequence: 99 }, f.tab.previewId!, token);
  assert.equal(f.positions().at(-1)?.message.sourceLine, 450);
});

test('left-side double click requests the left source rather than interpreting it as current text', async () => {
  const f = fixture(); await f.open();
  f.controller.previewMessage({ tabId: f.tab.previewId!, message: { type: 'edit-at-anchor',
    anchor: { sourceLine: 210, sourceColumn: 4, yRatio: .7, sourceSide: 'before' } } });
  const target = f.viewport.takeSourceTarget(f.tab.id);
  assert.equal(target?.sourceSide, 'before'); assert.equal(target?.anchor.sourceLine, 210);
  assert.equal(project.gitDiffMode, 'source');
});

test('closing the tab cancels pending navigation and drops stale input targets', async () => {
  const f = fixture(); await f.controller.activateDiff(f.tab.id); f.controller.showRendered();
  f.viewport.requestSource(f.tab.id, reviewViewport(1));
  f.controller.closeDiff(); f.controller.layoutDiff(bounds);
  assert.equal(f.positions().length, 0); assert.equal(f.viewport.takeSourceTarget(f.tab.id), null);
});

for (const layoutFirst of [false, true]) test(`cold page and layout completion ordering (${layoutFirst})`, async () => {
  const f = fixture(); f.tab.previewId = null; f.tab.previewDirty = true;
  await f.controller.activateDiff(f.tab.id); f.controller.showRendered();
  await f.started;
  if (layoutFirst) f.controller.layoutDiff(bounds);
  assert.equal(f.positions().length, 0);
  await f.finish();
  if (!layoutFirst) { assert.equal(f.positions().length, 0); f.controller.layoutDiff(bounds); }
  assert.equal(f.positions().length, 1);
  assert.equal(f.positions()[0].message.sourceLine, 80);
});
