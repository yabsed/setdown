import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type { WebContentsView } from 'electron';
import type { WindowState } from '../windows/window-state';
import { PreviewManager } from './preview-manager';

vi.mock('electron', () => {
  let id = 0;
  class View {
    visible = false;
    dead = false;
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    webContents = {
      id: ++id, isDestroyed: () => this.dead, isFocused: () => false,
      on() {}, once() {}, send() {}, close: () => { this.dead = true; },
      getURL: () => 'marktex-preview://document/review', enableDeviceEmulation() {},
      loadURL: async (_url: string) => {},
    };
    setVisible(value: boolean) { this.visible = value; }
    getVisible() { return this.visible; }
    setBackgroundColor() {}
    setBounds(value: typeof this.bounds) { this.bounds = value; }
    getBounds() { return this.bounds; }
  }
  return { WebContentsView: View, ipcMain: { on() {}, handle() {} } };
});
vi.mock('../../core/preview/preview-preferences', () => ({ previewThemeBackground: () => '#fff' }));
vi.mock('../../core/preview/preview-install', () => ({
  DEFERRED_HTML_SCRIPT_ID: 'deferred', INITIAL_HTML_TEMPLATE_ID: 'initial',
}));
vi.mock('../windows/workspace-zoom', () => ({
  WorkspaceZoom: class { track() {} }, nativeZoomBounds: (bounds: unknown) => bounds,
}));
vi.mock('./review-preparation', () => ({ ReviewPreparation: class {} }));

const bounds = { x: 20, y: 40, width: 600, height: 450 };
function fixture() {
  const children: WebContentsView[] = [];
  let focusCount = 0;
  const owner = {
    contentView: {
      children,
      addChildView(view: WebContentsView) { if (!children.includes(view)) children.push(view); },
      removeChildView(view: WebContentsView) { const i = children.indexOf(view); if (i >= 0) children.splice(i, 1); },
    },
    webContents: { isDestroyed: () => false, focus() { focusCount += 1; } },
    isDestroyed: () => false, isFocused: () => true, isVisible: () => true,
    getContentSize: () => [900, 700],
  };
  const manager = new PreviewManager({
    preload: '', stateFor: () => ({ window: owner } as unknown as WindowState),
    theme: () => 'paper', themeAssets: () => { throw new Error('unused'); }, forgetTab() {},
  });
  manager.create(1, 'git-diff:doc:a');
  manager.create(1, 'git-diff:doc:b');
  const front = manager.views.get('git-diff:doc:a')!;
  const back = manager.views.get('git-diff:doc:b')!;
  manager.show(1, 'git-diff:doc:a', bounds);
  return { manager, front, back, owner, children, focusCount: () => focusCount };
}

test('replacement bounds and visibility precede hiding the old native front', () => {
  const f = fixture();
  const events: string[] = [];
  const setBounds = f.back.view.setBounds.bind(f.back.view);
  f.back.view.setBounds = (value) => { events.push('bounds'); setBounds(value); };
  for (const [name, preview] of [['front', f.front], ['back', f.back]] as const) {
    const setVisible = preview.view.setVisible.bind(preview.view);
    preview.view.setVisible = (value) => { events.push(`${name}:${value}`); setVisible(value); };
  }
  f.manager.show(1, 'git-diff:doc:b', bounds);
  assert.deepEqual(events, ['bounds', 'back:true', 'front:false']);
  assert.equal(f.front.view.getVisible(), false);
  assert.equal(f.back.view.getVisible(), true);
});

test('warm repeated show preserves native identity, bounds and hierarchy', () => {
  const f = fixture();
  f.front.view.setBounds = () => { throw new Error('redundant bounds'); };
  f.front.view.setVisible = () => { throw new Error('redundant visibility'); };
  f.owner.contentView.addChildView = () => { throw new Error('redundant attach'); };
  f.manager.show(1, 'git-diff:doc:a', bounds);
  assert.equal(f.children[0], f.front.view);
});

test('navigating A/B replacement keeps its own front without reattaching the back', async () => {
  const f = fixture();
  let complete!: () => void;
  f.back.view.webContents.loadURL = () => new Promise<void>((resolve) => { complete = resolve; });
  const loading = f.manager.loadURL(f.back.view, 'about:blank', 1);
  f.manager.show(1, 'git-diff:doc:b', bounds);
  assert.equal(f.front.view.getVisible(), true);
  assert.equal(f.back.view.getVisible(), false);
  assert.equal(f.children.includes(f.back.view), false);
  complete(); await loading;
  assert.equal(f.back.view.getVisible(), false, 'navigation completion must not auto-show an obsolete request');
  f.manager.show(1, 'git-diff:doc:b', bounds);
  assert.equal(f.front.view.getVisible(), false);
  assert.equal(f.back.view.getVisible(), true);
});

test('pending navigation in another document never retains the wrong front', async () => {
  const f = fixture();
  f.manager.create(1, 'git-diff:other:b');
  const other = f.manager.views.get('git-diff:other:b')!;
  let complete!: () => void;
  other.view.webContents.loadURL = () => new Promise<void>((resolve) => { complete = resolve; });
  const loading = f.manager.loadURL(other.view, 'about:blank', 1);
  f.manager.show(1, 'git-diff:other:b', bounds);
  assert.equal(f.front.view.getVisible(), false);
  assert.equal(other.view.getVisible(), false);
  complete(); await loading;
});

test('Source mode cancels a retained front and late navigation cannot reveal it', async () => {
  const f = fixture();
  let complete!: () => void;
  f.back.view.webContents.loadURL = () => new Promise<void>((resolve) => { complete = resolve; });
  const loading = f.manager.loadURL(f.back.view, 'about:blank', 1);
  f.manager.show(1, 'git-diff:doc:b', bounds);
  f.manager.show(1, null, null);
  complete(); await loading;
  assert.equal(f.front.view.getVisible(), false);
  assert.equal(f.back.view.getVisible(), false);
});

test('invalid bounds and closed targets are not sent to native views', () => {
  const f = fixture();
  f.back.view.setBounds = () => { throw new Error('invalid native bounds'); };
  f.manager.show(1, 'git-diff:doc:b', { ...bounds, width: NaN });
  assert.equal(f.front.view.getVisible(), false);
  assert.equal(f.back.view.getVisible(), false);
  f.back.view.webContents.close();
  assert.doesNotThrow(() => f.manager.show(1, 'git-diff:doc:b', bounds));
});

test('handoff cannot show or hide a different owner\'s preview', () => {
  const f = fixture();
  f.manager.create(2, 'foreign');
  const foreign = f.manager.views.get('foreign')!;
  foreign.view.setVisible(true);
  f.manager.show(1, 'foreign', bounds);
  assert.equal(f.front.view.getVisible(), false);
  assert.equal(foreign.view.getVisible(), true);
});

test('failed bounds application keeps the old front and does not poison the retry cache', () => {
  const f = fixture();
  const setBounds = f.back.view.setBounds.bind(f.back.view);
  f.back.view.setBounds = () => { throw new Error('native bounds failed'); };
  assert.throws(() => f.manager.show(1, 'git-diff:doc:b', bounds), /native bounds failed/);
  assert.equal(f.front.view.getVisible(), true);
  assert.equal(f.back.view.getVisible(), false);
  assert.equal(f.back.appliedBounds, null);
  f.back.view.setBounds = setBounds;
  f.manager.show(1, 'git-diff:doc:b', bounds);
  assert.deepEqual(f.back.view.getBounds(), bounds);
});

test('hiding a focused front returns keyboard focus to the owner', () => {
  const f = fixture();
  f.front.view.webContents.isFocused = () => true;
  f.manager.show(1, 'git-diff:doc:b', bounds);
  assert.equal(f.focusCount(), 1);
});

test('hidden review viewport uses the same clipped box as its first presentation', () => {
  const f = fixture();
  const sizes: unknown[] = [];
  f.back.view.webContents.enableDeviceEmulation = (value) => { sizes.push(value.viewSize); };
  const oversized = { x: 300, y: 76, width: 600, height: 625 };
  f.manager.applyBounds(f.back, oversized);
  assert.equal(f.back.view.getVisible(), false);
  assert.equal(f.focusCount(), 0);
  assert.deepEqual(sizes, [{ width: 600, height: 624 }]);
  f.manager.show(1, 'git-diff:doc:b', oversized);
  assert.deepEqual(f.back.view.getBounds(), { ...oversized, height: 624 });
  assert.equal(sizes.length, 1, 'show must not invalidate the precomputed viewport');
});

test('navigation reapplies the hidden viewport before the loaded page is prepared', async () => {
  const f = fixture();
  let size: unknown;
  f.back.view.webContents.enableDeviceEmulation = (value) => { size = value.viewSize; };
  f.back.view.webContents.getURL = () => '';
  f.manager.applyBounds(f.back, bounds);
  assert.equal(size, undefined);
  f.back.view.webContents.loadURL = async () => {
    f.back.view.webContents.getURL = () => 'marktex-preview://document/new';
  };
  await f.manager.loadURL(f.back.view, 'marktex-preview://document/new', 1);
  assert.deepEqual(size, { width: bounds.width, height: bounds.height });
  assert.equal(f.back.view.getVisible(), false);
});

test('a failed renderer viewport update can retry without changing native visibility', () => {
  const f = fixture();
  f.back.view.webContents.enableDeviceEmulation = () => { throw new Error('renderer unavailable'); };
  assert.throws(() => f.manager.applyBounds(f.back, bounds), /renderer unavailable/);
  let retried = false;
  f.back.view.webContents.enableDeviceEmulation = () => { retried = true; };
  f.manager.applyBounds(f.back, bounds);
  assert.equal(retried, true);
  assert.equal(f.back.view.getVisible(), false);
});
