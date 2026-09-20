import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { installReviewPreparation } from './review-preparation';
import { ReviewPresentation } from '../renderer/project/source-control/review-presentation';
import type { SourceAtlas } from './source-atlas';

afterEach(() => vi.unstubAllGlobals());

type Message = Record<string, unknown>;
function fixture() {
  const listeners = new Map<string, Array<(event: any) => void>>();
  const listen = (type: string, listener: (event: any) => void) => {
    const group = listeners.get(type) ?? []; group.push(listener); listeners.set(type, group);
  };
  const emit = (type: string, event: any = {}) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  const win = { innerWidth: 0, innerHeight: 0, addEventListener: listen, parent: null as unknown };
  win.parent = win;
  const fonts = { status: 'loaded', ready: Promise.resolve(), addEventListener: listen };
  const doc = { visibilityState: 'hidden', querySelector: () => null, addEventListener: listen, fonts };
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
  let revision = 7;
  let scroll = 0;
  const positions: unknown[][] = [];
  const messages: Message[] = [];
  // Model the native cold-view contract: hidden bounds have not reached Blink.
  // This is a state/ordering test, not an Electron rendering benchmark.
  const atlas = {
    invalidate() {},
    lineCount: (side: string) => side === 'before' && win.innerWidth === 0 ? 1 : 1000,
    readBand: (value: unknown) => Array.isArray(value) ? value : [],
    position: (...args: unknown[]) => {
      positions.push(args);
      scroll = win.innerWidth > 0 && win.innerHeight > 0 ? Number(args[0]) * 20 : 0;
    },
  } as unknown as SourceAtlas;
  installReviewPreparation({ sourceAtlas: atlas, revision: () => revision, hydrate() {}, send: m => messages.push(m) });
  const send = (command: Message) => emit('message', { source: win, data: command });
  const prepare = (extra: Message = {}) => send({ command: 'marktex:prepare-review',
    requestId: 'present:1', revision, sourceLine: 240, sourceSide: 'after', topRatio: .7, ...extra });
  const verify = (extra: Message = {}) => send({ command: 'marktex:verify-review-position',
    requestId: 'present:1', revision, ...extra });
  const show = (sized = true) => { doc.visibilityState = 'visible'; if (sized) { win.innerWidth = 900; win.innerHeight = 700; } };
  return { send, prepare, verify, show, emit, positions, messages, win, doc, fonts,
    scroll: () => scroll, setRevision: (value: number) => { revision = value; } };
}

test('first edited preview rechecks the captured source line after native show', () => {
  const f = fixture(); f.prepare();
  assert.equal(f.scroll(), 0, 'cold hidden view cannot scroll yet');
  assert.equal(f.messages[0]?.type, 'marktex:review-prepared');
  f.show(); f.verify();
  assert.equal(f.scroll(), 4800);
  assert.equal(f.positions.at(-1)?.[0], 240);
});

test('a delayed first native resize recovers the original before-side line, not clamped line 1', () => {
  const f = fixture(); f.prepare({ sourceSide: 'before', blockOffset: .4,
    band: [{ sourceLine: 238, yRatio: .2 }, { sourceLine: 245, yRatio: .8 }] });
  assert.equal(f.positions[0]?.[0], 1);
  f.show(false); f.verify(); assert.equal(f.scroll(), 0);
  f.win.innerWidth = 900; f.win.innerHeight = 700; f.emit('resize');
  assert.equal(f.scroll(), 4800);
  assert.deepEqual(f.positions.at(-1), [240, .7,
    [{ sourceLine: 238, yRatio: .2 }, { sourceLine: 245, yRatio: .8 }], 'before', .4, 7]);
});

test('visibility delivery after verification also restores the final target', () => {
  const f = fixture(); f.prepare(); f.verify();
  f.show(); f.emit('visibilitychange');
  assert.equal(f.scroll(), 4800);
});

test('post-show resize revalidates even if the renderer initially kept its old nonzero size', () => {
  const f = fixture(); f.win.innerWidth = 300; f.win.innerHeight = 200;
  f.prepare(); f.show(false); f.verify();
  const count = f.positions.length;
  f.win.innerWidth = 900; f.win.innerHeight = 700; f.emit('resize');
  assert.equal(f.positions.length, count + 1);
  assert.equal(f.positions.at(-1)?.[0], 240);
});

test('numeric background preparation never becomes a reveal navigation', () => {
  const f = fixture(); f.prepare({ requestId: 1 });
  f.show(); f.verify(); f.emit('resize');
  assert.equal(f.positions.length, 1);
});

test('a reveal command must match both the final request and its revision', () => {
  const f = fixture(); f.prepare(); f.show();
  f.verify({ requestId: 'present:0' }); f.verify({ revision: 6 }); f.emit('resize');
  assert.equal(f.positions.length, 1);
  f.verify(); assert.equal(f.scroll(), 4800);
});

for (const command of ['marktex:position-preview', 'marktex:patch-review-rows', 'marktex:update-html',
  'marktex:apply-theme', 'marktex:find', 'marktex:scroll-to-heading', 'marktex:restore-scroll-ratio']) {
  test(`a newer ${command} cancels the old reveal target`, () => {
    const f = fixture(); f.prepare(); f.send({ command });
    f.show(); f.verify(); f.emit('resize');
    assert.equal(f.positions.length, 1);
  });
}

for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) {
  test(`user ${type} prevents later resize from pulling the reader back`, () => {
    const f = fixture(); f.prepare(); f.show(); f.verify();
    const count = f.positions.length;
    f.emit(type); f.emit('resize'); f.emit('loadingdone');
    assert.equal(f.positions.length, count);
  });
}

test('hiding an already revealed page retires its old target', () => {
  const f = fixture(); f.prepare(); f.show(); f.verify();
  const count = f.positions.length;
  f.doc.visibilityState = 'hidden'; f.emit('visibilitychange');
  f.show(); f.emit('visibilitychange'); f.emit('resize');
  assert.equal(f.positions.length, count);
});

test('a newer content revision cannot replay an old final target', () => {
  const f = fixture(); f.prepare(); f.setRevision(8);
  f.show(); f.verify({ revision: 7 }); f.emit('resize');
  assert.equal(f.positions.length, 1);
});

test('font completion after a newer navigation cannot resurrect the old reveal target', async () => {
  const f = fixture(); let finish!: () => void;
  f.fonts.status = 'loading'; f.fonts.ready = new Promise(resolve => { finish = resolve; });
  f.prepare(); f.send({ command: 'marktex:position-preview', sourceLine: 600 });
  f.fonts.status = 'loaded'; finish(); await Promise.resolve();
  f.show(); f.verify(); f.emit('resize');
  assert.equal(f.positions.length, 1);
});

test('presentation commits native show before sending exact-request reveal verification', () => {
  const calls: Message[] = [];
  const gate = new ReviewPresentation({ sendPreviewCommand: (id, message) => calls.push({ id, ...message }) });
  gate.present({ id: 'git-diff:r:b', revision: 7, bounds: { x: 0, y: 0, width: 900, height: 700 },
    position: { sourceLine: 240, sourceSide: 'after', topRatio: .7 } }, () => true,
    () => calls.push({ command: 'show' }), error => assert.fail(error));
  const requestId = calls.at(-1)!.requestId;
  gate.receive('git-diff:r:b', { type: 'marktex:review-prepared', revision: 7, requestId });
  assert.deepEqual(calls.slice(-2), [{ command: 'show' }, { id: 'git-diff:r:b',
    command: 'marktex:verify-review-position', revision: 7, requestId }]);
  assert.equal(gate.waiting, false);
});

test('canceled presentation never sends a reveal command', () => {
  const calls: Message[] = [];
  const gate = new ReviewPresentation({ sendPreviewCommand: (_id, message) => calls.push(message) });
  gate.present({ id: 'git-diff:r:b', revision: 7, bounds: { x: 0, y: 0, width: 900, height: 700 },
    position: { sourceLine: 240 } }, () => true, () => assert.fail('must not show'), assert.fail);
  const requestId = calls.at(-1)!.requestId; gate.cancel();
  gate.receive('git-diff:r:b', { type: 'marktex:review-prepared', revision: 7, requestId });
  assert.equal(calls.length, 2);
});
