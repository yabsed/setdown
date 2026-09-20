import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { GitDiff } from '../../protocol/desktop-api';
import type { WindowState } from '../windows/window-state';
import type { PreviewManager } from './preview-manager';
import type { ReviewAssembly, ReviewAssemblyResult } from './review-render-client';
import { PreviewRenderer } from './preview-renderer';

vi.mock('electron', () => ({ utilityProcess: { fork() { throw new Error('Unexpected native worker'); } } }));
vi.mock('../../core/document/document-state', () => ({ applyTextRevision() { throw new Error('unused'); } }));
vi.mock('../../core/preview/preview-preferences', () => ({
  normalizePreviewTheme: (theme: string) => theme, previewThemeBackground: () => '#fff',
}));
vi.mock('./review-render-client', () => ({ ReviewRenderClient: class {} }));

function fixture() {
  const calls: Array<{ id: string; htmlOnly: unknown }> = [];
  const messages: Record<string, unknown>[] = [];
  const assemblies: ReviewAssembly[] = [];
  let url = '';
  let visible = false;
  let loads = 0;
  let onRender = () => {};
  let omitColdTemplate = false;
  const view = {
    getVisible: () => visible, setBackgroundColor() {},
    webContents: { id: 12, once() {}, isDestroyed: () => false, getURL: () => url,
      send(_channel: string, message: Record<string, unknown>) { messages.push(message); } },
  };
  const previews = {
    views: new Map([['git-diff:r:a', { ownerWebContentsId: 7, view }]]),
    storeDocument: () => `marktex-preview://document/${++loads}`,
    async loadURL(_view: unknown, next: string) { url = next; },
    waitForUpdate: async () => {}, prepareReviewViewport: async () => {},
    markTheme() {}, syncTheme() {}, ensureSpare() {},
  } as unknown as PreviewManager;
  const renderer = new PreviewRenderer({ previews, workerPath: '/app/render-worker.cjs', roots: () => ['/p'], theme: () => 'paper' });
  const seam = renderer as unknown as {
    render: (...args: unknown[]) => Promise<Record<string, unknown>>;
    reviews: { assemble(input: ReviewAssembly): Promise<ReviewAssemblyResult> };
  };
  seam.render = async (id, text, _revision, _path, _theme, _hasPage, _defer, htmlOnly) => {
    calls.push({ id: String(id), htmlOnly }); onRender();
    return { html: `<p>${text}</p>`, totalLineCount: 1, baseHref: 'marktex-resource://p/', themeId: 'paper',
      template: htmlOnly || omitColdTemplate ? undefined : 'template' };
  };
  seam.reviews = { assemble: async (input) => {
    assemblies.push(input);
    return { supported: true, html: '<p>review</p>', template: input.needsTemplate ? 'review template' : undefined };
  } };
  const diff: GitDiff = { path: 'a.md', filePath: '/p/a.md', staged: true, originalText: 'base',
    modifiedText: 'modified', originalLabel: 'HEAD', modifiedLabel: 'INDEX', hunks: [], patch: '' };
  return { calls, messages, assemblies, seam,
    run: () => renderer.prepareDiff({} as WindowState, 'git-diff:r:a', diff, 'paper', 7),
    loads: () => loads, url: () => url,
    navigate: () => { url = 'marktex-preview://document/external'; },
    show: () => { visible = true; },
    duringRender: (callback: () => void) => { onRender = callback; },
    omitTemplate: () => { omitColdTemplate = true; },
  };
}

test('cold review requests only original HTML but retains the modified page template', async () => {
  const f = fixture();
  assert.equal((await f.run()).supported, true);
  assert.deepEqual(f.calls.map((call) => call.htmlOnly), [true, false]);
  assert.equal(f.assemblies[0].needsTemplate, true);
  assert.equal(f.loads(), 1);
});

test('warm review accepts HTML-only modified output and reuses the page', async () => {
  const f = fixture(); await f.run();
  const url = f.url(); f.calls.length = 0;
  assert.equal((await f.run()).supported, true);
  assert.deepEqual(f.calls, [{ id: 'git-diff:r:a:modified', htmlOnly: true }]);
  assert.equal(f.assemblies.at(-1)?.template, undefined);
  assert.equal(f.assemblies.at(-1)?.needsTemplate, false);
  assert.equal(f.messages.at(-1)?.command, 'marktex:update-html');
  assert.equal(f.loads(), 1);
  assert.equal(f.url(), url);
});

test('a page that changed before rendering takes the complete cold fallback', async () => {
  const f = fixture(); await f.run(); f.navigate(); f.calls.length = 0;
  assert.equal((await f.run()).supported, true);
  assert.deepEqual(f.calls, [{ id: 'git-diff:r:a:modified', htmlOnly: false }]);
  assert.equal(f.assemblies.at(-1)?.needsTemplate, true);
  assert.equal(f.loads(), 2);
});

test('navigation during fragment rendering rejects rather than using a missing template', async () => {
  const f = fixture(); await f.run();
  f.duringRender(f.navigate);
  await assert.rejects(f.run(), /changed during preparation/);
  assert.equal(f.loads(), 1);
  assert.equal(f.messages.length, 0);
  assert.equal(f.assemblies.length, 1);
});

test('promotion during rendering cannot overwrite the now-visible page', async () => {
  const f = fixture(); await f.run();
  f.duringRender(f.show);
  await assert.rejects(f.run(), /changed during preparation/);
  assert.equal(f.messages.length, 0);
  assert.equal(f.assemblies.length, 1);
});

test('cold output without a template stays unsupported and does not navigate', async () => {
  const f = fixture(); f.omitTemplate();
  assert.equal((await f.run()).supported, false);
  assert.equal(f.loads(), 0);
});

test('navigation during comparison assembly cannot install fragment output', async () => {
  const f = fixture(); await f.run();
  f.seam.reviews.assemble = async () => { f.navigate(); return { supported: true, html: 'obsolete' }; };
  await assert.rejects(f.run(), /changed during preparation/);
  assert.equal(f.messages.length, 0);
});
