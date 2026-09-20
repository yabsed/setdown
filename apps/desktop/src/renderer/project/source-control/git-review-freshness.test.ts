import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { GitDiff, GitDiffPreviewResult, PreviewMessage } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project, type GitDiffTabState } from '../project-state.svelte';
import type { GitDiffViewportPort } from './git-diff-viewport';
import { SourceControlController } from './source-control-controller';

vi.mock('../project-state.svelte', () => ({ project: {} }));
vi.mock('../../../core/diff/text-diff', () => ({ textDiffHunks: () => [] }));
vi.mock('../../../core/document/document-profile', () => ({ isMarkdownDocument: (path: string) => path.endsWith('.md') }));
vi.mock('./git-diff-viewport', () => ({ gitDiffViewport: {} }));
vi.mock('../../editor/live-document-model', () => ({ liveDocumentModels: { subscribe: () => () => {} } }));
vi.mock('../../../core/preview/review-viewport', () => ({ reviewViewport: (line: number) => ({ anchor: { sourceLine: line, yRatio: .372 }, band: [] }), reviewPositionCommand: (v: { anchor: { sourceLine: number; yRatio: number } }) => ({ sourceLine: v.anchor.sourceLine, topRatio: v.anchor.yRatio, sourceSide: 'after', settle: false }), readReviewBookmark: () => null }));

const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture() {
  Object.assign(project, { gitDiffTabs: [], gitDiffActive: true, activeGitDiffId: 'r',
    gitDiffMode: 'source', gitDiffLine: 1, gitDiffTarget: null, gitBusy: false, error: '' });
  let text = 'v1';
  const tab: GitDiffTabState = { id: 'r', filePath: '/p/a.md', staged: false, line: 1, mode: 'source',
    diff: { filePath: '/p/a.md', path: 'a.md', staged: false, originalText: 'base', modifiedText: text,
      originalLabel: 'INDEX', modifiedLabel: 'WORKTREE', patch: '', hunks: [] },
    loading: false, previewId: null, pendingPreviewId: null, previewLoading: false, previewDirty: true };
  project.gitDiffTabs.push(tab); project.gitDiff = tab.diff;
  const calls: Array<{ id: string; diff: GitDiff; resolve(value: GitDiffPreviewResult): void; reject(error: Error): void }> = [];
  const shows: Array<string | null> = [];
  const commands: Array<{ id: string; message: Record<string, unknown> }> = [];
  const destroyed: string[] = [];
  vi.stubGlobal('window', { addEventListener() {} });
  const controller = new SourceControlController({
    desktop: { getTheme: async () => ({ id: 'paper', revision: 0 }),
      prepareGitDiffPreview: (id: string, diff: GitDiff) => new Promise<GitDiffPreviewResult>((resolve, reject) => calls.push({ id, diff, resolve, reject })),
      showPreview: (id: string | null) => shows.push(id),
      sendPreviewCommand: (id: string, message: Record<string, unknown>) => commands.push({ id, message }),
      updateGitReviewState() {}, destroyPreview: (id: string) => destroyed.push(id),
    } as unknown as DesktopPort,
    viewport: { read: () => null, requestSource() {}, forget() {} } as unknown as GitDiffViewportPort,
    openWorkingTree: async () => true, activateWorkingTree: () => true,
    workingTreeBuffer: () => text, workingTreeChanged: (_path, value) => { text = value; }, reviewChanged() {},
  });
  controller.layoutDiff({ x: 20, y: 80, width: 900, height: 700 });
  const run = () => (controller as unknown as { preparePreview(tab: GitDiffTabState): Promise<void> }).preparePreview(tab);
  const finish = async (index = calls.length - 1) => {
    calls[index].resolve({ revision: index + 1, url: 'marktex-preview://document/test', themeId: 'paper', supported: true });
    await tick();
  };
  const request = () => commands.filter(x => x.message.command === 'marktex:prepare-review').at(-1)!;
  const ack = (value = request()) => controller.previewMessage({ tabId: value.id,
    message: { type: 'marktex:review-prepared', requestId: value.message.requestId, revision: value.message.revision } } as PreviewMessage);
  const warm = async () => { const work = run(); await tick(); await finish(); await work; controller.showRendered(); ack(); controller.toggleDiffMode(); shows.length = 0; commands.length = 0; };
  return { controller, tab, calls, shows, commands, destroyed, run, finish, request, ack, warm,
    silentEdit: (value: string) => { text = value; }, close: () => { controller.clear(); vi.unstubAllGlobals(); } };
}

test('latest first result waits for final position before one native show', async () => {
  const f = fixture(); try {
    const work = f.run(); await tick(); f.controller.showRendered();
    assert.equal(f.shows.filter(Boolean).length, 0);
    await f.finish(); await work;
    assert.equal(f.shows.filter(Boolean).length, 0);
    f.ack(); assert.deepEqual(f.shows.filter(Boolean), ['git-diff:r:a']);
    assert.equal(project.gitDiffPreviewReady, true);
  } finally { f.close(); }
});
test('older in-flight result is not promoted; newest work starts without another timer', async () => {
  const f = fixture(); try {
    const work = f.run(); await tick();
    f.controller.changeWorkingTree('v2'); f.controller.changeWorkingTree('v3'); f.controller.showRendered();
    await f.finish(0); await work;
    assert.equal(f.tab.previewId, null); assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].id, 'git-diff:r:a'); assert.equal(f.calls[1].diff.modifiedText, 'v3');
    assert.equal(f.shows.filter(Boolean).length, 0);
    await f.finish(1); f.ack(); assert.equal(f.shows.filter(Boolean).length, 1);
  } finally { f.close(); }
});
test('previewDirty=false during work cannot expose the stale old front on Escape', async () => {
  const f = fixture(); try {
    await f.warm(); f.controller.changeWorkingTree('v2');
    const work = f.run(); await tick(); assert.equal(f.tab.previewDirty, false);
    f.controller.showRendered(); assert.equal(f.shows.filter(Boolean).length, 0);
    await f.finish(); await work; f.ack(); assert.deepEqual(f.shows.filter(Boolean), ['git-diff:r:b']);
  } finally { f.close(); }
});
test('no-edit Escape preserves the existing no-ACK fast path', async () => {
  const f = fixture(); try {
    await f.warm(); f.controller.showRendered();
    assert.deepEqual(f.shows.filter(Boolean), ['git-diff:r:a']);
    assert.equal(f.commands.some(x => x.message.command === 'marktex:prepare-review'), false);
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});
test('Escape reads the actual buffer even before its change event arrives', async () => {
  const f = fixture(); try {
    await f.warm(); f.silentEdit('unpublished buffer edit'); f.controller.showRendered(); await tick();
    assert.equal(f.shows.filter(Boolean).length, 0);
    assert.equal(f.calls[1].diff.modifiedText, 'unpublished buffer edit');
    await f.finish(); f.ack(); assert.deepEqual(f.shows.filter(Boolean), ['git-diff:r:b']);
  } finally { f.close(); }
});
test('Source cancellation rejects a late final position ACK', async () => {
  const f = fixture(); try {
    const work = f.run(); await tick(); await f.finish(); await work;
    f.controller.showRendered(); const old = f.request(); f.controller.toggleDiffMode(); f.ack(old);
    assert.equal(project.gitDiffMode, 'source'); assert.equal(f.shows.filter(Boolean).length, 0);
  } finally { f.close(); }
});
test('resize replaces the pending final position request', async () => {
  const f = fixture(); try {
    const work = f.run(); await tick(); await f.finish(); await work;
    f.controller.showRendered(); const old = f.request();
    f.controller.layoutDiff({ x: 20, y: 80, width: 700, height: 700 });
    f.ack(old); assert.equal(f.shows.filter(Boolean).length, 0);
    f.ack(); assert.equal(f.shows.filter(Boolean).length, 1);
  } finally { f.close(); }
});
test('reusing an A/B view ID with a different revision is not a warm hit', async () => {
  const f = fixture(); try {
    await f.warm();
    for (const text of ['v2', 'v3']) {
      f.controller.changeWorkingTree(text); const work = f.run(); await tick(); await f.finish(); await work;
    }
    assert.equal(f.tab.previewId, 'git-diff:r:a');
    f.controller.showRendered(); assert.equal(f.shows.filter(Boolean).length, 0);
    f.ack(); assert.deepEqual(f.shows.filter(Boolean), ['git-diff:r:a']);
  } finally { f.close(); }
});
test('closed review cannot be resurrected by a final position ACK', async () => {
  const f = fixture(); try {
    const work = f.run(); await tick(); await f.finish(); await work;
    f.controller.showRendered(); const old = f.request(); f.controller.closeDiff(); f.ack(old);
    assert.equal(f.shows.filter(Boolean).length, 0); assert.equal(project.gitDiffTabs.length, 0);
  } finally { f.close(); }
});
test('duplicate Escape while rendering does not duplicate the render', async () => {
  const f = fixture(); try {
    const work = f.run(); await tick(); f.controller.showRendered(); f.controller.showRendered();
    assert.equal(f.calls.length, 1); await f.finish(); await work; f.ack();
    assert.equal(f.shows.filter(Boolean).length, 1);
  } finally { f.close(); }
});

test('unsupported stale work cannot cancel a newer Escape request', async () => {
  const f = fixture(); try {
    const work = f.run(); await tick(); f.controller.changeWorkingTree('v2'); f.controller.showRendered();
    f.calls[0].resolve({ revision: 1, url: null, themeId: 'paper', supported: false });
    await work; await tick();
    assert.equal(project.gitDiffMode, 'rendered'); assert.equal(f.calls.length, 2);
    await f.finish(1); f.ack(); assert.equal(f.shows.filter(Boolean).length, 1);
  } finally { f.close(); }
});
test('failure of stale work retries latest without reporting an obsolete error', async () => {
  const f = fixture(); try {
    const work = f.run(); await tick(); f.controller.changeWorkingTree('v2'); f.controller.showRendered();
    f.calls[0].reject(new Error('obsolete render failed'));
    await work; await tick();
    assert.equal(project.error, ''); assert.equal(f.calls.length, 2);
    await f.finish(1); f.ack(); assert.equal(f.shows.filter(Boolean).length, 1);
  } finally { f.close(); }
});
