import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { GitDiff } from '../../protocol/desktop-api';
import type { WindowState } from '../windows/window-state';
import type { PreviewManager } from './preview-manager';
import { PreviewRenderer } from './preview-renderer';
import type { ReviewAssembly, ReviewAssemblyResult } from './review-render-client';

vi.mock('electron', () => ({ utilityProcess: { fork() { throw new Error('Unexpected native process in unit test'); } } }));

function fixture() {
  const calls: Array<{ kind: string; id?: string; revision?: number; message?: Record<string, unknown> }> = [];
  const views = new Map<string, {
    ownerWebContentsId: number; view: { getVisible(): boolean; setBackgroundColor(): void;
      webContents: { once(): void; getURL(): string; isDestroyed(): boolean; send(name: string, value: Record<string, unknown>): void } };
  }>();
  const urls = new Map<string, string>();
  let visible = false;
  let dead = false;
  let acknowledge = async () => {};
  const addView = (id: string) => views.set(id, {
    ownerWebContentsId: 7, view: { getVisible: () => visible, setBackgroundColor() {},
      webContents: { once() {}, getURL: () => urls.get(id) ?? '', isDestroyed: () => dead,
        send(_name, message) { calls.push({ kind: 'send', id, message }); } } },
  });
  for (const id of ['git-diff:r:a', 'git-diff:r:b']) addView(id);
  let loadGate = async (_id: string) => {};
  const previews = {
    create(_owner: number, id: string) { if (!views.has(id)) addView(id); },
    views, storeDocument: () => `marktex-preview://document/${calls.length}`,
    async loadURL(view: unknown, url: string) {
      const id = [...views].find(([, entry]) => entry.view === view)![0];
      calls.push({ kind: 'load', id }); await loadGate(id); urls.set(id, url);
    },
    waitForUpdate(id: string, revision: number, strict: boolean) {
      assert.equal(strict, true); calls.push({ kind: 'wait', id, revision }); return acknowledge();
    },
    async prepareReviewViewport(_owner: number, id: string) { calls.push({ kind: 'prepare', id }); },
    markTheme() {}, syncTheme() {}, ensureSpare() {},
  } as unknown as PreviewManager;
  const renderer = new PreviewRenderer({ previews, workerPath: '/app/render-worker.cjs', roots: () => ['/p'], theme: () => 'paper' });
  const seam = renderer as unknown as {
    render: (...args: unknown[]) => Promise<Record<string, unknown>>;
    reviews: { assemble(input: ReviewAssembly): Promise<ReviewAssemblyResult>;
      seed?(from: string, to: string, revision: number): void };
  };
  seam.render = async (id, text, revision) => {
    calls.push({ kind: 'render', id: String(id) });
    return { html: `<p>${text}</p>`, template: 'sanitized template', themeId: 'paper', totalLineCount: 20, baseHref: 'marktex-resource://p/', revision };
  };
  seam.reviews = { seed() {}, assemble: async (input) => ({ supported: true,
    html: `${input.originalHtml}${input.modifiedHtml}`, template: input.needsTemplate ? 'assembled template' : undefined }) };
  const diff: GitDiff = { path: 'a.md', filePath: '/p/a.md', staged: false, originalText: 'base',
    modifiedText: 'revision1', originalLabel: 'INDEX', modifiedLabel: 'WORKTREE', hunks: [], patch: '' };
  return { renderer, calls, urls, seam, diff, views,
    run: (id = 'git-diff:r:a', next = diff) => renderer.prepareDiff({} as WindowState, id, next, 'paper', 7),
    hold: (promise: Promise<void>) => { acknowledge = () => promise; },
    acknowledge: (handler: () => Promise<void>) => { acknowledge = handler; },
    loadGate: (handler: (id: string) => Promise<void>) => { loadGate = handler; },
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

const rowPatch = (input: ReviewAssembly): ReviewAssemblyResult => ({ supported: true, patch: {
  version: 1, baseRevision: input.baseRevision!, revision: input.revision,
  unified: { baseLength: 0, length: 0, splices: [], shifts: [] },
  split: { baseLength: 0, length: 0, splices: [], shifts: [] },
} });

test('warm pages receive row patches from their own bases without full HTML/template payloads', async () => {
  const f = fixture(); const a = await f.run('git-diff:r:a'); const b = await f.run('git-diff:r:b');
  const requests: ReviewAssembly[] = [];
  f.seam.reviews = { assemble: async (input) => { requests.push(input); return rowPatch(input); } };
  const aNext = await f.run('git-diff:r:a'); await f.run('git-diff:r:b'); await f.run('git-diff:r:a');
  assert.deepEqual(requests.map((input) => input.baseRevision), [a.revision, b.revision, aNext.revision]);
  assert.ok(requests.every((input) => input.template === undefined && !input.needsTemplate));
  assert.ok(f.calls.filter((call) => call.kind === 'send')
    .every((call) => call.message?.command === 'marktex:patch-review-rows' && !('html' in call.message)));
  assert.equal(f.calls.filter((call) => call.kind === 'load').length, 2);
});

test('rejected patch resets the hidden page with a NEW acknowledgment revision', async () => {
  const f = fixture(); await f.run(); f.calls.length = 0;
  const requests: ReviewAssembly[] = [];
  f.seam.reviews = { assemble: async (input) => {
    requests.push(input);
    return input.baseRevision === null ? { supported: true, html: '<p>full reset</p>' } : rowPatch(input);
  } };
  let attempts = 0;
  f.acknowledge(async () => { if (++attempts === 1) throw new Error('Review patch rejected: wrong base'); });
  const result = await f.run();
  assert.equal(requests.length, 2); assert.equal(requests[1].baseRevision, null);
  assert.ok(requests[1].revision > requests[0].revision);
  assert.equal(result.revision, requests[1].revision);
  assert.deepEqual(f.calls.filter((call) => call.kind === 'wait').map((call) => call.revision),
    requests.map((input) => input.revision));
  assert.deepEqual(f.calls.filter((call) => call.kind === 'send').map((call) => call.message?.command),
    ['marktex:patch-review-rows', 'marktex:update-html']);
  assert.equal(f.calls.filter((call) => call.kind === 'load').length, 0);
  assert.equal(f.calls.filter((call) => call.kind === 'prepare').length, 1);
});

test('failed reset cannot be promoted and a close during retry cannot install', async () => {
  const f = fixture(); await f.run(); f.calls.length = 0;
  f.seam.reviews = { assemble: async (input) => input.baseRevision === null
    ? { supported: true, html: '<p>reset</p>' } : rowPatch(input) };
  f.acknowledge(async () => { throw new Error('installation failed'); });
  await assert.rejects(f.run(), /installation failed/);
  assert.equal(f.calls.filter((call) => call.kind === 'prepare').length, 0);
  f.acknowledge(async () => { f.close(); throw new Error('closed'); });
  await assert.rejects(f.run(), /closed/);
});

test('standby is seeded before the first edit without a second Markdown render', async () => {
  const f = fixture(); f.views.delete('git-diff:r:b');
  const seeds: number[] = []; f.seam.reviews.seed = (_from, _to, revision) => seeds.push(revision);
  const first = await f.run();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.deepEqual(seeds, [first.revision]);
  assert.equal(f.calls.filter((call) => call.kind === 'render').length, 2);
  assert.equal(f.urls.get('git-diff:r:a'), f.urls.get('git-diff:r:b'));
  const requests: ReviewAssembly[] = [];
  f.seam.reviews.assemble = async (input) => { requests.push(input); return rowPatch(input); };
  await f.run('git-diff:r:b', { ...f.diff, modifiedText: 'first edit' });
  assert.equal(requests[0].baseRevision, first.revision);
  assert.equal(f.calls.filter((call) => call.kind === 'load').length, 2);
  assert.equal(f.calls.filter((call) => call.kind === 'send').at(-1)?.message?.command, 'marktex:patch-review-rows');
});

test('standby never blocks A; the first edit joins rather than races its navigation', async () => {
  const f = fixture(); f.views.delete('git-diff:r:b');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  f.loadGate(async (id) => { if (id.endsWith(':b')) await pending; });
  const first = await f.run();
  assert.equal(first.supported, true);
  const requests: ReviewAssembly[] = [];
  f.seam.reviews.assemble = async (input) => { requests.push(input); return rowPatch(input); };
  let done = false;
  const edit = f.run('git-diff:r:b').then(() => { done = true; });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(done, false); assert.equal(requests.length, 0);
  assert.equal(f.calls.filter((call) => call.kind === 'load' && call.id?.endsWith(':b')).length, 1);
  release(); await edit;
  assert.equal(requests[0].baseRevision, first.revision);
  assert.equal(f.calls.filter((call) => call.kind === 'load').length, 2);
});
