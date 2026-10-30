import assert from 'node:assert/strict';
import { test } from 'vitest';
import { WorkspaceZoom, nativeZoomBounds } from './workspace-zoom';
import { WheelZoomAccumulator, isTextZoomTarget, wheelZoomScope } from '../../preload/wheel-zoom';
import { ContentZoomInput } from '../../core/wheel-zoom';
import { appZoomStep } from '../../core/zoom';
import { installZoomSettings } from './zoom-settings';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function target(id: number) {
  const listeners = new Map<string, () => void>();
  return { id, factors: [] as number[], closed: false,
    isDestroyed() { return this.closed; },
    setZoomFactor(factor: number) { this.factors.push(factor); },
    on(event: string, fn: () => void) { listeners.set(event, fn); },
    once(event: string, fn: () => void) { listeners.set(event, fn); },
    emit(event: string) { if (event === 'destroyed') this.closed = true; listeners.get(event)?.(); },
  };
}

test('tab zoom isolates native targets, survives reload and composes with app zoom', () => {
  const zoom = new WorkspaceZoom(), a = target(1), b = target(2), shell = target(3);
  zoom.track(a, undefined, () => zoom.tabFactor('a'));
  zoom.track(b, undefined, () => zoom.tabFactor('b')); zoom.track(shell);
  const untouched = b.factors.length + shell.factors.length;
  zoom.changeTab('a', 2);
  assert.equal(a.factors.at(-1), 1.2); assert.equal(b.factors.at(-1), 1);
  assert.equal(b.factors.length + shell.factors.length, untouched);
  a.emit('did-finish-load'); assert.equal(a.factors.at(-1), 1.2);
  zoom.change(1); assert.equal(a.factors.at(-1), 1.32); assert.equal(b.factors.at(-1), 1.1);
  zoom.changeTab('b', -1); assert.equal(a.factors.at(-1), 1.32);
  assert.equal(b.factors.at(-1), 1.1 * .9);
  const restored = new WorkspaceZoom(); restored.restore(zoom.snapshot);
  assert.equal(restored.tabFactor('a'), 1.2); assert.equal(restored.tabFactor('b'), .9);
  assert.equal(restored.tabFactor('new'), 1);
  zoom.context(10, ['a', 'git-diff:review'], 'a');
  assert.equal(zoom.ownsTab(10, 'b'), false);
  assert.equal(zoom.ownsTab(10, 'git-diff:review:a'), true);
  zoom.changeTab('git-diff:review:a', 1);
  assert.equal(zoom.tabFactor('git-diff:review:b'), 1.1);
});

test('shell/front/back/another window use one scale', () => {
  const zoom = new WorkspaceZoom(); const views = [1, 2, 3, 4].map(target);
  views.forEach(view => zoom.track(view)); zoom.change(1);
  assert.ok(views.every(view => view.factors.at(-1) === 1.1));
  zoom.change(-1); assert.ok(views.every(view => view.factors.at(-1) === 1));
});
test('new views and reloads inherit scale without navigation', () => {
  const zoom = new WorkspaceZoom(); zoom.change(3); const view = target(1); zoom.track(view);
  assert.equal(view.factors.at(-1), 1.3); view.emit('did-finish-load');
  assert.equal(view.factors.at(-1), 1.3);
});
test('reset restores every view to 100%', () => {
  const zoom = new WorkspaceZoom(); const view = target(1); zoom.track(view); zoom.change(2); zoom.change(0);
  assert.equal(zoom.factor, 1); assert.equal(view.factors.at(-1), 1);
});
test('zoom clamps at 50%-300%', () => {
  const zoom = new WorkspaceZoom(); for (let i = 0; i < 100; i++) zoom.change(-4);
  assert.equal(zoom.factor, .5); for (let i = 0; i < 100; i++) zoom.change(4); assert.equal(zoom.factor, 3);
});
test('malformed IPC requests cannot change zoom', () => {
  const zoom = new WorkspaceZoom();
  for (const value of [NaN, Infinity, 1.5, 5, '1', null, {}, undefined]) assert.equal(zoom.change(value), false);
  assert.equal(zoom.factor, 1);
});
test('destroyed targets are removed and duplicate track is harmless', () => {
  const zoom = new WorkspaceZoom(); const view = target(1); zoom.track(view); zoom.track(view);
  assert.equal(view.factors.length, 1); view.emit('destroyed'); zoom.change(1);
  assert.equal(view.factors.length, 1);
});
test('a closing target does not stop updates for other targets', () => {
  const zoom = new WorkspaceZoom(); const a = target(1), b = target(2);
  a.setZoomFactor = () => { throw new Error('closed'); }; zoom.track(a); zoom.track(b); zoom.change(1);
  assert.equal(b.factors.at(-1), 1.1);
});
test('title-bar callback follows the applied scale', () => {
  const zoom = new WorkspaceZoom(); const heights: number[] = [];
  zoom.track(target(1), () => heights.push(Math.round(36 * zoom.factor)));
  zoom.change(2); assert.deepEqual(heights, [36, 43]);
});
for (const factor of [.5, 1, 1.25, 2]) test(`CSS-to-DIP conversion at ${factor}`, () => {
  assert.deepEqual(nativeZoomBounds({ x: 100, y: 80, width: 600, height: 400 }, factor),
    { x: 100 * factor, y: 80 * factor, width: 600 * factor, height: 400 * factor });
});
test('native rounding keeps adjacent edges aligned', () => {
  const a = nativeZoomBounds({ x: 0, y: 0, width: 100.5, height: 400 }, 1.25);
  const b = nativeZoomBounds({ x: 100.5, y: 0, width: 100.5, height: 400 }, 1.25);
  assert.equal(a.x + a.width, b.x);
});
test('wheel units, directions and fine trackpad accumulation', () => {
  const wheel = new WheelZoomAccumulator();
  assert.equal(wheel.consume({ deltaY: -80, deltaMode: 0 }, 0), 1);
  assert.equal(wheel.consume({ deltaY: 2, deltaMode: 1 }, 500), -1);
  assert.equal(wheel.consume({ deltaY: -10, deltaMode: 0 }, 1000), 0);
  for (let i = 1; i < 7; i++) assert.equal(wheel.consume({ deltaY: -10, deltaMode: 0 }, 1000 + i * 10), 0);
  assert.equal(wheel.consume({ deltaY: -10, deltaMode: 0 }, 1070), 1);
});
test('wheel direction reversal and idle reset discard residual motion', () => {
  const wheel = new WheelZoomAccumulator();
  wheel.consume({ deltaY: 60, deltaMode: 0 }, 0);
  assert.equal(wheel.consume({ deltaY: -40, deltaMode: 0 }, 10), 0);
  assert.equal(wheel.consume({ deltaY: -40, deltaMode: 0 }, 20), 1);
  wheel.consume({ deltaY: -60, deltaMode: 0 }, 30);
  assert.equal(wheel.consume({ deltaY: -20, deltaMode: 0 }, 400), 0);
});
test('every short pinch responds immediately without relying on wheel tick metadata', () => {
  const input = new ContentZoomInput(), zoom = new WorkspaceZoom();
  for (let i = 0; i < 5; i++) {
    const previous = zoom.tabFactor('a');
    const change = input.consume({ deltaY: -100 * Math.log(1.02), deltaMode: 0 }, i * 500);
    assert.equal(zoom.changeTab('a', change), true);
    assert.ok(Math.abs(zoom.tabFactor('a') - previous * 1.02) < 1e-12);
  }
  assert.equal(zoom.tabFactor('b'), 1); assert.equal(zoom.factor, 1);
  const before = zoom.tabFactor('a');
  zoom.changeTab('a', input.consume({ deltaY: 1, deltaMode: 0 }, 2010));
  assert.ok(zoom.tabFactor('a') < before);
  const restored = new WorkspaceZoom(); restored.restore(zoom.snapshot);
  assert.equal(restored.tabFactor('a'), zoom.tabFactor('a'));
  // A mouse notch immediately following a pinch still uses stepped zoom.
  assert.equal(input.consume({ deltaY: -80, deltaMode: 0 }, 2020), 1);
});
test('continuous tab zoom validates factors and keeps its existing bounds', () => {
  const zoom = new WorkspaceZoom();
  for (const scale of [NaN, Infinity, 0, -.1, .49, 2.01, '1.1', null, undefined]) {
    assert.equal(zoom.changeTab('a', { scale }), false);
  }
  for (let i = 0; i < 20; i++) zoom.changeTab('a', { scale: 2 });
  assert.equal(zoom.tabFactor('a'), 3);
  for (let i = 0; i < 20; i++) zoom.changeTab('a', { scale: .5 });
  assert.equal(zoom.tabFactor('a'), .5);
  assert.equal(zoom.changeTab('a', 0), true); assert.equal(zoom.tabFactor('a'), 1);
});
test('native float rounding at a wheel notch boundary does not lose a zoom step', () => {
  const wheel = new WheelZoomAccumulator();
  assert.equal(wheel.consume({ deltaY: -(80 - 1e-5), deltaMode: 0 }, 0), 1);
  assert.equal(wheel.consume({ deltaY: 80 - 1e-5, deltaMode: 0 }, 10), -1);
  assert.equal(wheel.consume({ deltaY: -79.99, deltaMode: 0 }, 20), 0);
  assert.equal(wheel.consume({ deltaY: -.01, deltaMode: 0 }, 30), 1);
});
test('huge or invalid deltas never flood the IPC channel', () => {
  const wheel = new WheelZoomAccumulator();
  assert.equal(wheel.consume({ deltaY: Infinity, deltaMode: 0 }, 0), 0);
  assert.equal(wheel.consume({ deltaY: -1e12, deltaMode: 0 }, 0), 4);
});
test('workspace wheel zoom reaches editors and terminals but never media surfaces', () => {
  const element = (selector: string | null) => ({ closest: (query: string) => query.includes(selector ?? '') ? {} : null }) as unknown as EventTarget;
  assert.equal(isTextZoomTarget(element('.monaco-editor')), true);
  assert.equal(isTextZoomTarget(element('.terminal-surface')), true);
  assert.equal(isTextZoomTarget(element('.pdf-host')), false);
  assert.equal(isTextZoomTarget(element('.image-viewport')), false);
  assert.equal(isTextZoomTarget(element(null)), false);
  assert.equal(isTextZoomTarget(null), false);
  // Terminals own a separate factor from editors and Markdown previews.
  assert.equal(wheelZoomScope(element('.monaco-editor')), 'text');
  assert.equal(wheelZoomScope(element('[data-code-zoom="true"]')), 'code');
  assert.equal(wheelZoomScope(element('.web-reader')), 'text');
  assert.equal(wheelZoomScope(element('.notebook-surface')), 'text');
  assert.equal(wheelZoomScope(element('.video-surface')), 'text');
  assert.equal(wheelZoomScope(element('.terminal-surface')), 'terminal');
  assert.equal(wheelZoomScope(element('.pdf-host')), null);
  assert.equal(wheelZoomScope(null), null);
});

test('terminal zoom is independent of app/text zoom and never touches native targets', () => {
  const zoom = new WorkspaceZoom(), shell = target(1), front = target(2);
  zoom.track(shell); zoom.track(front, undefined, true);
  const applied = shell.factors.length + front.factors.length;
  zoom.change(2, 'terminal');
  assert.equal(zoom.terminalFactor, 1.2);
  assert.equal(zoom.textFactor, 1);
  assert.equal(zoom.factor, 1);
  assert.equal(shell.factors.length + front.factors.length, applied);
  zoom.change(1, 'text');
  assert.equal(zoom.terminalFactor, 1.2);
  assert.equal(front.factors.at(-1), 1.1);
  zoom.change(0, 'terminal');
  assert.equal(zoom.terminalFactor, 1);
  assert.equal(zoom.textFactor, 1.1);
  assert.deepEqual(zoom.snapshot, { app: 100, text: 110, terminal: 100, code: 100, revision: 3, tabs: {} });
});

test('code font preference persists fractional pinch zoom independently of tabs and native views', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'setdown-code-zoom-'));
  try {
    const file = path.join(root, 'zoom.json'), zoom = new WorkspaceZoom();
    const flush = installZoomSettings(file, zoom, () => {});
    const shell = target(1), reader = target(2);
    zoom.track(shell); zoom.track(reader, undefined, () => zoom.tabFactor('markdown'));
    zoom.changeTab('markdown', 2);
    const nativeUpdates = shell.factors.length + reader.factors.length;
    assert.equal(zoom.changeCode(1), true);
    assert.equal(zoom.changeCode({ scale: 1.025 }), true);
    assert.equal(zoom.snapshot.code, 110 * 1.025);
    assert.equal(zoom.snapshot.app, 100);
    assert.equal(zoom.tabFactor('markdown'), 1.2);
    assert.equal(zoom.tabFactor('terminal'), 1);
    assert.equal(shell.factors.length + reader.factors.length, nativeUpdates);
    flush();
    const restored = new WorkspaceZoom(); installZoomSettings(file, restored, () => {});
    assert.equal(restored.snapshot.code, zoom.snapshot.code);
    assert.equal(restored.changeCode(0), true);
    assert.equal(restored.snapshot.code, 100);
    assert.equal(restored.tabFactor('markdown'), 1.2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('code zoom rejects invalid IPC/settings and bounds both wheel and pinch changes', () => {
  const zoom = new WorkspaceZoom();
  for (const input of [NaN, Infinity, 1.5, 5, '1', null, {}, undefined,
    { scale: NaN }, { scale: Infinity }, { scale: .49 }, { scale: 2.01 }, { scale: '1.1' }]) {
    assert.equal(zoom.changeCode(input), false);
  }
  zoom.restore({ text: 130, tabs: { oldCodeTab: 160 }, code: 500 });
  assert.equal(zoom.snapshot.code, 100);
  for (let i = 0; i < 20; i++) zoom.changeCode({ scale: 2 });
  assert.equal(zoom.snapshot.code, 300);
  for (let i = 0; i < 100; i++) zoom.changeCode(-4);
  assert.equal(zoom.snapshot.code, 50);
});

test('text zoom composes with app zoom only in text previews, including spares and reloads', () => {
  const zoom = new WorkspaceZoom(), shell = target(1), front = target(2);
  zoom.track(shell); zoom.track(front, undefined, true);
  zoom.change(2, 'text'); zoom.change(1);
  assert.equal(shell.factors.at(-1), 1.1);
  assert.equal(front.factors.at(-1), 1.1 * 1.2);
  const spare = target(3); zoom.track(spare, undefined, true); spare.emit('did-finish-load');
  assert.equal(spare.factors.at(-1), 1.1 * 1.2);
  zoom.change(0);
  assert.equal(shell.factors.at(-1), 1);
  assert.equal(front.factors.at(-1), 1.2);
  assert.equal(spare.factors.at(-1), 1.2);
});
test('website zoom composes with app zoom, survives reloads, and stays independent of text zoom', () => {
  const zoom = new WorkspaceZoom(), shell = target(1), text = target(2), page = target(3);
  let pageFactor = 1.2;
  zoom.track(shell); zoom.track(text, undefined, true); zoom.track(page, undefined, () => pageFactor);
  zoom.change(1, 'text');
  assert.equal(page.factors.at(-1), 1.2);
  zoom.change(1);
  assert.equal(page.factors.at(-1), 1.1 * 1.2);
  assert.equal(text.factors.at(-1), 1.1 * 1.1);
  pageFactor = .8;
  page.emit('did-finish-load');
  assert.equal(page.factors.at(-1), 1.1 * .8);
  zoom.change(0);
  assert.equal(page.factors.at(-1), .8);
  assert.equal(shell.factors.at(-1), 1);
  assert.equal(text.factors.at(-1), 1.1);
});

test('both preferences persist and malformed values are rejected independently', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'setdown-zoom-settings-'));
  try {
    const file = path.join(root, 'zoom.json');
    const zoom = new WorkspaceZoom(); let updates = 0;
    const flush = installZoomSettings(file, zoom, () => updates++);
    zoom.change(2); zoom.change(-1, 'text'); zoom.change(3, 'terminal'); flush();
    assert.equal(updates, 3);
    const restored = new WorkspaceZoom(); installZoomSettings(file, restored, () => {});
    assert.equal(restored.factor, 1.2); assert.equal(restored.textFactor, .9);
    assert.equal(restored.terminalFactor, 1.3);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).app, 120);
    writeFileSync(file, JSON.stringify({ app: 500, text: 80 }));
    const invalid = new WorkspaceZoom(); installZoomSettings(file, invalid, () => {});
    assert.equal(invalid.factor, 1); assert.equal(invalid.textFactor, .8);
    // Pre-split settings have no terminal factor: inherit the text factor once.
    assert.equal(invalid.terminalFactor, .8);
    writeFileSync(file, JSON.stringify({ app: 100, text: 120, terminal: 500 }));
    const badTerminal = new WorkspaceZoom(); installZoomSettings(file, badTerminal, () => {});
    assert.equal(badTerminal.textFactor, 1.2); assert.equal(badTerminal.terminalFactor, 1.2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('app shortcuts accept plus/equal/minus and reset, but leave composition and other modifiers alone', () => {
  const input = { type: 'keyDown', control: true, key: '+' };
  assert.equal(appZoomStep(input), 1);
  assert.equal(appZoomStep({ ...input, key: '=' }), 1);
  assert.equal(appZoomStep({ ...input, key: '-', shift: false }), -1);
  assert.equal(appZoomStep({ ...input, key: '0' }), 0);
  for (const extra of [{ isComposing: true }, { alt: true }, { meta: true }, { control: false }, { type: 'keyUp' }])
    assert.equal(appZoomStep({ ...input, ...extra }), undefined);
  assert.equal(appZoomStep({ ...input, key: '0', shift: true }), undefined);
});
