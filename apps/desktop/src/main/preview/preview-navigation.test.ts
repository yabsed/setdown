import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { WebContentsView } from 'electron';
import type { WindowState } from '../windows/window-state';
import { PreviewManager } from './preview-manager';

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  let id = 0;
  class View {
    visible = false;
    dead = false;
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    webContents = Object.assign(new EventEmitter(), {
      id: ++id, isDestroyed: () => this.dead, isFocused: () => false,
      close: () => { this.dead = true; }, send() {},
      loadURL: async (_url: string) => {},
    });
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

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const children: WebContentsView[] = [];
  let destroyed = false;
  let focusLosses = 0;
  const owner = {
    contentView: {
      children,
      addChildView(view: WebContentsView) { if (!children.includes(view)) children.push(view); },
      removeChildView(view: WebContentsView) { const i = children.indexOf(view); if (i >= 0) children.splice(i, 1); },
    },
    webContents: { isDestroyed: () => destroyed, isFocused: () => true, focus() {}, send() {} },
    isDestroyed: () => destroyed,
    isFocused: () => true,
    isVisible: () => true,
    getContentSize: () => [900, 700],
  };
  const manager = new PreviewManager({
    preload: '', stateFor: () => ({ window: owner } as unknown as WindowState),
    theme: () => 'paper', themeAssets: () => { throw new Error('unused'); }, forgetTab() {},
  });
  manager.create(1, 'review');
  const state = manager.views.get('review')!;
  const completion = deferred();
  state.view.webContents.loadURL = async () => {
    // Model Electron 38's ReadyToCommitNavigation auto-focus at completion.
    // This verifies our ordering, not native focus behavior on a real desktop.
    await completion.promise;
    if (children.includes(state.view)) focusLosses += 1;
  };
  return { manager, state, children, completion, losses: () => focusLosses,
    destroyOwner: () => { destroyed = true; } };
}

test('new hidden previews are not attached before navigation', () => {
  const f = fixture();
  assert.equal(f.children.length, 0);
});

test('navigation already in flight cannot steal focus when composition starts', async () => {
  const f = fixture();
  f.children.push(f.state.view); // reused A/B back buffer
  const loading = f.manager.loadURL(f.state.view, 'about:blank', 1);
  assert.equal(f.children.length, 0);
  // This interval is where a user may start Korean composition.
  f.manager.show(1, 'review', { x: 0, y: 0, width: 800, height: 600 });
  assert.equal(f.children.length, 0, 'show may not reattach a still-navigating view');
  f.completion.resolve(); await loading;
  assert.equal(f.losses(), 0);
  assert.equal(f.state.view.getVisible(), false);
  assert.equal(f.children[0], f.state.view, 'same native view is retained after navigation');
});

test('loaded preview can be explicitly shown and keeps its identity and bounds', async () => {
  const f = fixture();
  f.completion.resolve();
  await f.manager.loadURL(f.state.view, 'about:blank', 1);
  const bounds = { x: 40, y: 80, width: 600, height: 450 };
  f.manager.show(1, 'review', bounds);
  assert.equal(f.state.view.getVisible(), true);
  assert.deepEqual(f.state.view.getBounds(), bounds);
  assert.equal(f.children.length, 1);
});

test('closing a tab while loading does not reattach a destroyed view', async () => {
  const f = fixture();
  const loading = f.manager.loadURL(f.state.view, 'about:blank', 1);
  f.manager.destroy(1, 'review');
  f.completion.resolve(); await loading;
  assert.equal(f.children.length, 0);
});

test('closing the owner while loading does not reattach a view', async () => {
  const f = fixture();
  const loading = f.manager.loadURL(f.state.view, 'about:blank', 1);
  f.destroyOwner(); f.completion.resolve(); await loading;
  assert.equal(f.children.length, 0);
});

test('a failed navigation is not reattached and can be retried', async () => {
  const f = fixture();
  const loading = f.manager.loadURL(f.state.view, 'about:blank', 1);
  f.completion.reject(new Error('load failed'));
  await assert.rejects(loading, /load failed/);
  assert.equal(f.children.length, 0);
  f.state.view.webContents.loadURL = async () => {};
  await f.manager.loadURL(f.state.view, 'about:blank', 1);
  assert.equal(f.children.length, 1);
});

test('overlapping navigation cannot reattach on an obsolete completion', async () => {
  const f = fixture();
  const first = f.manager.loadURL(f.state.view, 'about:blank', 1);
  const secondDone = deferred();
  f.state.view.webContents.loadURL = () => secondDone.promise;
  const second = f.manager.loadURL(f.state.view, 'about:blank', 1);
  f.completion.resolve(); await first;
  assert.equal(f.children.length, 0);
  f.manager.show(1, 'review', { x: 0, y: 0, width: 800, height: 600 });
  assert.equal(f.children.length, 0);
  secondDone.resolve(); await second;
  assert.equal(f.children.length, 1);
});

test('preview Escape belonging to the IME is not forwarded to the shell', () => {
  const f = fixture();
  let prevented = false;
  f.state.view.webContents.emit('before-input-event', { preventDefault() { prevented = true; } },
    { type: 'keyDown', key: 'Escape', isComposing: true });
  assert.equal(prevented, false);
});
