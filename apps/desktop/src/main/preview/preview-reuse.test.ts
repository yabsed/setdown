import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { GitDiff } from '../../protocol/desktop-api';
import type { WindowState } from '../windows/window-state';
import type { PreviewManager } from './preview-manager';
import { PreviewRenderer } from './preview-renderer';

vi.mock('electron', () => ({ utilityProcess: { fork() { throw new Error('Unexpected native process in unit test'); } } }));

function fixture() {
  const calls: Array<{ kind: string; id?: string; message?: Record<string, unknown> }> = [];
  const views = new Map<string, {
    ownerWebContentsId: number; view: { getVisible(): boolean; setBackgroundColor(): void;
      webContents: { getURL(): string; isDestroyed(): boolean; send(name: string, value: Record<string, unknown>): void } };
  }>();
  const urls = new Map<string, string>();
  let visible = false;
  let dead = false;
  let acknowledge = async () => {};
  for (const id of ['git-diff:r:a', 'git-diff:r:b']) views.set(id, {
    ownerWebContentsId: 7, view: { getVisible: () => visible, setBackgroundColor() {},
      webContents: { getURL: () => urls.get(id) ?? '', isDestroyed: () => dead,
        send(_name, message) { calls.push({ kind: 'send', id, message }); } } },
  });
  const previews = {
    views, storeDocument: () => `marktex-preview://document/${calls.length}`,
    async loadURL(view: unknown, url: string) {
      const id = [...views].find(([, entry]) => entry.view === view)![0];
      calls.push({ kind: 'load', id }); urls.set(id, url);
    },
    waitForUpdate(id: string, _revision: number, strict: boolean) {
      assert.equal(strict, true); calls.push({ kind: 'wait', id }); return acknowledge();
    },
    async prepareReviewViewport(_owner: number, id: string) { calls.push({ kind: 'prepare', id }); },
    markTheme() {}, syncTheme() {}, ensureSpare() {},
  } as unknown as PreviewManager;
  const renderer = new PreviewRenderer({ previews, workerPath: '/app/render-worker.cjs', roots: () => ['/p'], theme: () => 'paper' });
  const seam = renderer as unknown as {
    render: (...args: unknown[]) => Promise<Record<string, unknown>>;
    reviews: { assemble(input: { originalHtml: string; modifiedHtml: string; needsTemplate: boolean }): Promise<unknown> };
  };
  seam.render = async (id, text, revision) => {
    calls.push({ kind: 'render', id: String(id) });
    return { html: `<p>${text}</p>`, template: 'sanitized template', themeId: 'paper', totalLineCount: 20, baseHref: 'marktex-resource://p/', revision };
  };
  seam.reviews = { assemble: async (input) => ({ supported: true,
    html: `${input.originalHtml}${input.modifiedHtml}`, template: input.needsTemplate ? 'assembled template' : undefined }) };
  const diff: GitDiff = { path: 'a.md', filePath: '/p/a.md', staged: false, originalText: 'base',
    modifiedText: 'revision1', originalLabel: 'INDEX', modifiedLabel: 'WORKTREE', hunks: [], patch: '' };
  return { renderer, calls, urls, seam, diff,
    run: (id = 'git-diff:r:a', next = diff) => renderer.prepareDiff({} as WindowState, id, next, 'paper', 7),
    hold: (promise: Promise<void>) => { acknowledge = () => promise; },
    show: () => { visible = true; }, close: () => { dead = true; },
  };
}

test('warm A/B updates preserve URL and never navigate again', async () => {
  const f = fixture();
  await f.run('git-diff:r:a'); await f.run('git-diff:r:b');
  const before = [...f.urls];
  await f.run('git-diff:r:a', { ...f.diff, modifiedText: 'revision2' });
  await f.run('git-diff:r:b', { ...f.diff, modifiedText: 'revision3' });
  assert.equal(f.calls.filter((call) => call.kind === 'load').length, 2);
  assert.deepEqual([...f.urls], before);
  assert.equal(f.calls.filter((call) => call.kind === 'render' && call.id?.endsWith(':original')).length, 1);
  assert.equal(f.calls.filter((call) => call.kind === 'send' && call.message?.command === 'marktex:update-html').length, 2);
});
test('update acknowledgment precedes hidden viewport preparation', async () => {
  const f = fixture(); await f.run(); f.calls.length = 0;
  let finish!: () => void;
  f.hold(new Promise<void>((resolve) => { finish = resolve; }));
  let done = false;
  const work = f.run().then(() => { done = true; });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(done, false);
  assert.equal(f.calls.some((call) => call.kind === 'prepare'), false);
  assert.ok(f.calls.findIndex((call) => call.kind === 'wait') < f.calls.findIndex((call) => call.kind === 'send'));
  finish(); await work; assert.equal(f.calls.at(-1)?.kind, 'prepare');
});
test('the displayed front is never overwritten in place', async () => {
  const f = fixture(); await f.run(); f.show();
  await assert.rejects(f.run(), /visible/);
});
test('unsupported content does not replace the last valid page', async () => {
  const f = fixture(); await f.run(); const before = [...f.urls];
  f.seam.reviews = { assemble: async () => ({ supported: false }) };
  assert.equal((await f.run()).supported, false);
  assert.deepEqual([...f.urls], before);
  assert.equal(f.calls.filter((call) => call.kind === 'load').length, 1);
});
test('closed view during rendering cannot install results', async () => {
  const f = fixture();
  const work = f.run(); f.close();
  await assert.rejects(work, /closed or transferred/);
  assert.equal(f.calls.filter((call) => call.kind === 'load').length, 0);
});
test('installation failure rejects without claiming readiness', async () => {
  const f = fixture(); await f.run();
  f.hold(Promise.reject(new Error('missing acknowledgment')));
  await assert.rejects(f.run(), /missing acknowledgment/);
  assert.equal(f.calls.filter((call) => call.kind === 'prepare').length, 1);
});
