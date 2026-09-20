import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { GitDiff, GitDiffPreviewResult, PreviewMessage } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { reviewViewport } from '../../../core/preview/review-viewport';
import { project, type GitDiffTabState } from '../project-state.svelte';
import { GitDiffViewportPort } from './git-diff-viewport';
import { SourceControlController } from './source-control-controller';

vi.mock('../project-state.svelte', () => ({ project: {} }));
vi.mock('../../../core/diff/text-diff', () => ({ textDiffHunks: () => [] }));
vi.mock('../../editor/live-document-model', () => ({ liveDocumentModels: { subscribe: () => () => {} } }));
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  vi.stubGlobal('window', { addEventListener() {} });
  Object.assign(project, { gitDiffTabs: [], gitDiffActive: true, activeGitDiffId: 'r', gitDiffMode: 'source',
    gitDiffLine: 200, gitDiffTarget: null, gitDiffSwitchPending: false, gitDiffTransitionError: '', error: '' });
  let text = 'version 1';
  const tab: GitDiffTabState = { id: 'r', filePath: '/p/note.md', staged: false, line: 200, mode: 'source',
    diff: { path: 'note.md', filePath: '/p/note.md', staged: false, originalText: 'Index', modifiedText: text,
      originalLabel: 'INDEX', modifiedLabel: 'WORKTREE', patch: '', hunks: [] },
    loading: false, previewId: null, pendingPreviewId: null, previewLoading: false, previewDirty: true };
  project.gitDiffTabs.push(tab); project.gitDiff = tab.diff;
  const viewport = new GitDiffViewportPort();
  const source = reviewViewport(200); source.anchor.yRatio = .73; source.anchor.sourceColumn = 12;
  viewport.register(() => source);
  const renders: Array<{ id: string; diff: GitDiff; resolve(value: GitDiffPreviewResult): void; reject(error: Error): void }> = [];
  const shows: Array<{ id: string | null; mode: string }> = [];
  const commands: Array<{ id: string; message: Record<string, unknown> }> = [];
  const controller = new SourceControlController({ viewport,
    desktop: { getTheme: async () => ({ id: 'paper' }),
      prepareGitDiffPreview: (id: string, diff: GitDiff) => new Promise<GitDiffPreviewResult>((resolve, reject) => renders.push({ id, diff, resolve, reject })),
      showPreview: (id: string | null) => shows.push({ id, mode: project.gitDiffMode }),
      sendPreviewCommand: (id: string, message: Record<string, unknown>) => commands.push({ id, message }),
      destroyPreview() {}, updateGitReviewState() {},
    } as unknown as DesktopPort,
    openWorkingTree: async () => true, activateWorkingTree: () => true,
    workingTreeBuffer: () => text, workingTreeChanged: (_path, value) => { text = value; }, reviewChanged() {},
  });
  controller.layoutDiff({ x: 20, y: 80, width: 900, height: 700 });
  const finish = async (index = renders.length - 1, supported = true) => {
    renders[index].resolve({ revision: index + 1, url: 'marktex-preview://document/test', themeId: 'paper', supported }); await tick();
  };
  const request = () => commands.filter((x) => x.message.command === 'marktex:prepare-review').at(-1)!;
  const ack = (value = request(), extra = {}) => controller.previewMessage({ tabId: value.id, message: {
    type: 'marktex:review-prepared', revision: value.message.revision, requestId: value.message.requestId, ...extra,
  } } as PreviewMessage);
  const warm = async () => { controller.showRendered(); await tick(); await finish(); ack(); controller.toggleDiffMode();
    viewport.takeSourceTarget(tab.id); shows.length = 0; commands.length = 0; };
  return { controller, tab, viewport, source, renders, commands, shows, finish, request, ack, warm,
    silentEdit(value: string) { text = value; }, shown: () => shows.filter((x) => x.id),
    close() { controller.clear(); vi.unstubAllGlobals(); } };
}

test('cold Escape retains Source through render and final positioning; only ready commit changes mode', async () => {
  const f = fixture(); try {
    f.controller.showRendered(); await tick();
    assert.equal(project.gitDiffMode, 'source'); assert.equal(f.tab.mode, 'source');
    assert.equal(project.gitDiffSwitchPending, true); assert.equal(f.shown().length, 0);
    await f.finish();
    assert.equal(project.gitDiffMode, 'source'); assert.equal(f.shown().length, 0);
    assert.equal(f.request().message.sourceLine, 200); assert.equal(f.request().message.topRatio, .73);
    f.ack();
    assert.equal(f.shown().length, 1); assert.equal(f.shown()[0].mode, 'source', 'request native show before retiring Source');
    assert.equal(project.gitDiffMode, 'rendered'); assert.equal(project.gitDiffSwitchPending, false);
    assert.ok(f.commands.some((x) => x.message.command === 'marktex:verify-review-position'), 'keep cold reveal correction');
  } finally { f.close(); }
});
test('edited Escape never exposes the previously ready front or removes Source early', async () => {
  const f = fixture(); try {
    await f.warm(); f.controller.changeWorkingTree('version 2'); f.controller.showRendered(); await tick();
    assert.equal(project.gitDiffMode, 'source'); assert.equal(f.shown().length, 0);
    await f.finish(); assert.equal(project.gitDiffMode, 'source'); f.ack();
    assert.equal(f.shown()[0].id, 'git-diff:r:b'); assert.equal(project.gitDiffMode, 'rendered');
  } finally { f.close(); }
});
test('unchanged Escape stays synchronous with no extra render, prepare ACK or timer', async () => {
  const f = fixture(); try {
    await f.warm(); const count = f.renders.length; f.controller.showRendered();
    assert.equal(project.gitDiffMode, 'rendered'); assert.equal(f.shown().length, 1);
    assert.equal(f.renders.length, count); assert.equal(f.request(), undefined);
  } finally { f.close(); }
});
test('duplicate Escape and delayed prewarming notices do not cancel or duplicate handoff', async () => {
  const f = fixture(); try {
    f.controller.showRendered(); f.controller.showRendered(); f.viewport.changed(); await tick();
    assert.equal(f.renders.length, 1); assert.equal(project.gitDiffSwitchPending, true);
    await f.finish(); const request = f.request(); f.controller.showRendered();
    assert.equal(f.request(), request); f.ack(); assert.equal(f.shown().length, 1);
  } finally { f.close(); }
});
test('new typing while rendering cancels automatic transition without resetting the source target', async () => {
  const f = fixture(); try {
    f.controller.showRendered(); await tick(); f.controller.changeWorkingTree('new input');
    assert.equal(project.gitDiffSwitchPending, false); assert.equal(project.gitDiffMode, 'source');
    assert.equal(f.viewport.takeSourceTarget('r'), null);
    await f.finish(0); assert.equal(f.renders.length, 2); await f.finish(1);
    assert.equal(f.shown().length, 0); assert.equal(f.request(), undefined);
    f.controller.showRendered(); f.ack(); assert.equal(f.shown().length, 1);
  } finally { f.close(); }
});
for (const phase of ['render', 'position']) test(`deliberate source interaction cancels during ${phase}`, async () => {
  const f = fixture(); try {
    f.controller.showRendered(); await tick(); if (phase === 'position') await f.finish();
    const old = f.request(); f.viewport.interact('r');
    assert.equal(project.gitDiffSwitchPending, false); assert.equal(f.viewport.takeSourceTarget('r'), null);
    if (phase === 'render') await f.finish(); else f.ack(old);
    assert.equal(project.gitDiffMode, 'source'); assert.equal(f.shown().length, 0);
  } finally { f.close(); }
});
test('another tab interaction does not cancel the active pending request', async () => {
  const f = fixture(); try {
    f.controller.showRendered(); await tick(); f.viewport.interact('other');
    assert.equal(project.gitDiffSwitchPending, true); await f.finish(); f.ack(); assert.equal(f.shown().length, 1);
  } finally { f.close(); }
});
test('explicit toggle cancels but does not re-reveal the already visible editor', async () => {
  const f = fixture(); try {
    f.controller.showRendered(); await tick(); await f.finish(); const old = f.request();
    f.controller.toggleDiffMode(); f.ack(old);
    assert.equal(project.gitDiffMode, 'source'); assert.equal(f.shown().length, 0);
    assert.equal(f.viewport.takeSourceTarget('r'), null);
  } finally { f.close(); }
});
for (const outcome of ['reject', 'unsupported', 'position-error']) test(`${outcome} leaves usable Source and permits explicit retry`, async () => {
  const f = fixture(); try {
    f.controller.showRendered(); await tick();
    if (outcome === 'reject') { f.renders[0].reject(new Error('typesetting failed')); await tick(); }
    else if (outcome === 'unsupported') await f.finish(0, false);
    else { await f.finish(); f.ack(f.request(), { error: 'position failed' }); }
    assert.equal(project.gitDiffMode, 'source'); assert.equal(project.gitDiffSwitchPending, false);
    assert.ok(project.gitDiffTransitionError); assert.equal(f.shown().length, 0);
    assert.equal(f.viewport.takeSourceTarget('r'), null);
    f.controller.showRendered(); await tick();
    assert.equal(project.gitDiffTransitionError, ''); assert.equal(project.gitDiffSwitchPending, true);
    if (outcome !== 'position-error') await f.finish();
    f.ack(); assert.equal(f.shown().length, 1);
  } finally { f.close(); }
});
test('latest buffer change before event delivery cannot show an obsolete revision', async () => {
  const f = fixture(); try {
    f.controller.showRendered(); await tick(); f.silentEdit('newer unpublished buffer'); await f.finish(0);
    assert.equal(project.gitDiffMode, 'source'); assert.equal(f.shown().length, 0);
    assert.equal(f.renders[1].diff.modifiedText, 'newer unpublished buffer'); await f.finish(1); f.ack();
    assert.equal(f.shown().length, 1);
  } finally { f.close(); }
});
for (const close of [false, true]) test(`late completion after ${close ? 'close' : 'tab deactivation'} cannot reopen Viewer`, async () => {
  const f = fixture(); try {
    f.controller.showRendered(); await tick(); await f.finish(); const old = f.request();
    if (close) f.controller.closeDiff(); else f.controller.deactivateDiff();
    f.ack(old); assert.equal(f.shown().length, 0); assert.equal(project.gitDiffSwitchPending, false);
  } finally { f.close(); }
});
test('resizing pending presentation rejects the previous geometry without hiding Source', async () => {
  const f = fixture(); try {
    f.controller.showRendered(); await tick(); await f.finish(); const old = f.request();
    f.controller.layoutDiff({ x: 20, y: 80, width: 600, height: 500 }); f.ack(old);
    assert.equal(project.gitDiffMode, 'source'); assert.equal(f.shown().length, 0);
    f.ack(); assert.equal(f.shown().length, 1);
  } finally { f.close(); }
});
