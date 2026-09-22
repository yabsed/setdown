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
vi.mock('../windows/workspace-zoom', async (importOriginal) => ({
  ...await importOriginal<typeof import('../windows/workspace-zoom')>(),
  WorkspaceZoom: class { track() {} },
}));

const bounds = { x: 20, y: 40, width: 600, height: 450 };
function fixture() {
  const children: WebContentsView[] = [];
  let focusCount = 0;
  let contentSize: [number, number] = [900, 700];
  const owner = {
    contentView: {
      children,
      addChildView(view: WebContentsView) { if (!children.includes(view)) children.push(view); },
      removeChildView(view: WebContentsView) { const i = children.indexOf(view); if (i >= 0) children.splice(i, 1); },
    },
    webContents: { isDestroyed: () => false, getZoomFactor: () => 1, focus() { focusCount += 1; } },
    isDestroyed: () => false, isFocused: () => true, isVisible: () => true,
    getContentSize: () => contentSize,
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
  return { manager, front, back, owner, children, focusCount: () => focusCount,
    setContentSize: (width: number, height: number) => { contentSize = [width, height]; } };
}

test('ordinary document preparation sizes a hidden view without exposing or focusing it', () => {
  const f = fixture(); f.manager.create(1, 'document');
  const preview = f.manager.views.get('document')!;
  const commands: unknown[] = [];
  preview.view.webContents.send = (_channel, message) => { commands.push(message); };
  f.manager.command(1, 'document', {command:'marktex:prime-document',bounds});
  assert.deepEqual(preview.appliedBounds, bounds);
  assert.equal(preview.view.getVisible(), false);
  assert.equal(f.focusCount(), 0);
  assert.deepEqual(commands, [{command:'marktex:prepare-document'}]);
});

for (const kind of ['document', 'review'] as const) test(`${kind} prepare/show share fractional CSS conversion and clipped DIP bounds`, () => {
  const f = fixture();
  const id = kind === 'document' ? 'document' : 'git-diff:doc:b';
  if (kind === 'document') f.manager.create(1, id);
  f.owner.webContents.getZoomFactor = () => 1.25;
  const preview = f.manager.views.get(id)!;
  const sizes: unknown[] = [];
  const events: string[] = [];
  preview.view.webContents.enableDeviceEmulation = value => { events.push('viewport'); sizes.push(value.viewSize); };
  preview.view.webContents.send = () => { events.push('prepare'); };
  // Rounding CSS before zoom would produce x=25 and clipped height=650.
  const css = { x: 20.49, y: 40.49, width: 650.49, height: 600.49 };
  f.manager.command(1, id, { command: kind === 'document' ? 'marktex:prime-document' : 'marktex:prime-review',
    bounds: css, position: { sourceLine: 1 } });
  assert.deepEqual(preview.appliedBounds, { x: 26, y: 51, width: 813, height: 649 });
  assert.deepEqual(events, ['viewport', 'prepare']);
  f.manager.show(1, id, css);
  assert.deepEqual(sizes, [{ width: 813, height: 649 }]);
  assert.equal(preview.view.getVisible(), true);
  assert.equal(f.focusCount(), 0);
});

test('hidden document preparation is replayed after navigation, and cannot cross ownership', async () => {
  const f = fixture(); f.manager.create(1, 'document');
  const preview = f.manager.views.get('document')!;
  const commands: unknown[] = [];
  preview.view.webContents.send = (_channel, message) => { commands.push(message); };
  f.manager.command(2, 'document', {command:'marktex:prime-document',bounds});
  assert.equal(preview.appliedBounds, null);
  f.manager.command(1, 'document', {command:'marktex:prime-document',bounds:{...bounds,width:NaN}});
  assert.equal(preview.appliedBounds, null);
  let complete!: () => void;
  preview.view.webContents.loadURL = () => new Promise<void>(resolve => { complete=resolve; });
  const loading=f.manager.loadURL(preview.view,'marktex-preview://document/new',1);
  f.manager.command(1, 'document', {command:'marktex:prime-document',bounds});
  assert.equal(commands.length,0);
  complete(); await loading;
  assert.deepEqual(commands,[{command:'marktex:prepare-document'}]);
  assert.equal(preview.view.getVisible(),false);
});

test('warm show adds no background preparation; navigation replays it without another prime', async () => {
  const f = fixture(); f.manager.create(1, 'document');
  const preview = f.manager.views.get('document')!;
  const commands: string[] = [];
  preview.view.webContents.send = (_channel, message) => { commands.push(message.command); };
  f.manager.command(1, 'document', { command: 'marktex:prime-document', bounds });
  f.manager.show(1, 'document', bounds);
  assert.deepEqual(commands, ['marktex:prepare-document', 'marktex:resume-hydration']);
  f.manager.show(1, null, null);
  commands.length = 0;
  await f.manager.loadURL(preview.view, 'marktex-preview://document/replaced', 1);
  assert.deepEqual(commands, ['marktex:prepare-document']);
});

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

test('editor groups show independent native views; foreground changes retain only owned background views', () => {
  const f = fixture();
  f.manager.create(1, 'left'); f.manager.create(1, 'right'); f.manager.create(2, 'foreign');
  const left = f.manager.views.get('left')!, right = f.manager.views.get('right')!;
  f.manager.setBackgrounds(1, [{ tabId: 'left', bounds }, { tabId: 'foreign', bounds }]);
  f.manager.show(1, 'right', { ...bounds, x: 620, width: 200 });
  assert.equal(left.view.getVisible(), true);
  assert.equal(right.view.getVisible(), true);
  assert.equal(f.manager.views.get('foreign')!.view.getVisible(), false);
  f.manager.show(1, null, null);
  assert.equal(left.view.getVisible(), true);
  assert.equal(right.view.getVisible(), false);
  f.manager.setBackgrounds(1, []);
  assert.equal(left.view.getVisible(), false);
  assert.equal(f.focusCount(), 0);
});

test('a group layout updates foreground and backgrounds in one presentation', () => {
  const f = fixture();
  f.manager.create(1, 'left'); f.manager.create(1, 'right');
  const show = vi.spyOn(f.manager, 'show');
  const foreground = { ...bounds, x: 420, width: 300 };
  const background = { ...bounds, width: 380 };
  f.manager.layout(1, 'right', foreground, [{ tabId: 'left', bounds: background }]);
  assert.equal(show.mock.calls.length, 1);
  assert.deepEqual(f.manager.views.get('right')!.view.getBounds(), foreground);
  assert.deepEqual(f.manager.views.get('left')!.view.getBounds(), background);
  assert.equal(f.manager.views.get('right')!.view.getVisible(), true);
  assert.equal(f.manager.views.get('left')!.view.getVisible(), true);
});

test('owner resize preserves group ratios, fixed chrome and terminal inset', () => {
  const f = fixture();
  f.manager.create(1, 'left'); f.manager.create(1, 'right');
  const left = { x: 100, y: 40, width: 400, height: 460 };
  const right = { x: 500, y: 40, width: 400, height: 460 };
  f.manager.layout(1, 'right', right, [{ tabId: 'left', bounds: left }], {
    viewport: { width: 900, height: 700 },
    area: { x: 100, y: 0, width: 800, height: 500 },
    previews: [
      { tabId: 'left', bounds: left, group: { x: 100, y: 0, width: 400, height: 500 } },
      { tabId: 'right', bounds: right, group: { x: 500, y: 0, width: 400, height: 500 } },
    ],
  });
  f.setContentSize(1100, 800);
  f.manager.resizeOwner(1, 1100, 800);
  assert.deepEqual(f.manager.views.get('left')!.view.getBounds(), { x: 100, y: 40, width: 500, height: 560 });
  assert.deepEqual(f.manager.views.get('right')!.view.getBounds(), { x: 600, y: 40, width: 500, height: 560 });
});
