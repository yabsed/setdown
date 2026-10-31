import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { TransferableTab } from '../../protocol/desktop-api';
import type { PreviewManager } from '../preview/preview-manager';
import type { WindowState } from '../windows/window-state';
import { TabTransferManager } from './tab-transfer-manager';
import { displayBackend, hasGlobalWindowPositions } from '../windows/display-backend';

test('Linux selects XWayland only when available and respects explicit display choices', () => {
  const env = { DISPLAY: ':9', WAYLAND_DISPLAY: 'private', XDG_SESSION_TYPE: 'wayland' };
  expect(displayBackend('linux', env, '')).toBe('x11');
  expect(displayBackend('linux', env, 'auto')).toBe('x11');
  expect(displayBackend('linux', env, 'wayland')).toBe('wayland');
  expect(displayBackend('linux', env, 'headless')).toBe('headless');
  expect(displayBackend('linux', { WAYLAND_DISPLAY: 'private' }, '')).toBe('');
  expect(displayBackend('darwin', env, '')).toBe('');
  expect(hasGlobalWindowPositions('linux', env, 'x11')).toBe(true);
  expect(hasGlobalWindowPositions('linux', env, 'wayland')).toBe(false);
  expect(hasGlobalWindowPositions('linux', { WAYLAND_SOCKET: '3' }, '')).toBe(false);
});

const electron = vi.hoisted(() => ({
  listeners: new Map<string, (...args: any[]) => unknown>(),
  handlers: new Map<string, (...args: any[]) => unknown>(),
}));

vi.mock('electron', () => ({ ipcMain: {
  on(channel: string, listener: (...args: any[]) => unknown) { electron.listeners.set(channel, listener); },
  handle(channel: string, handler: (...args: any[]) => unknown) { electron.handlers.set(channel, handler); },
} }));

function fakeWindow(id: number) {
  let destroyed = false;
  let visible = true;
  let minimized = false;
  let mode: 'normal' | 'maximized' | 'fullscreen' = 'normal';
  let bounds = { x: 1000, y: 100, width: 900, height: 700 };
  const messages: Array<{ channel: string; payload: unknown }> = [];
  const webContents = {
    id,
    on: vi.fn(),
    send: vi.fn((channel: string, payload: unknown) => messages.push({ channel, payload })),
    isLoadingMainFrame: () => false,
    getZoomFactor: () => 1,
    once: vi.fn(),
  };
  const window = {
    webContents,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => { destroyed = true; }),
    getContentSize: () => [900, 700] as [number, number],
    getContentBounds: () => bounds,
    isMinimized: () => minimized,
    isMaximized: () => mode === 'maximized',
    isFullScreen: () => mode === 'fullscreen',
    setPosition: vi.fn(),
    isVisible: () => visible,
    showInactive: vi.fn(() => { visible = true; }),
    show: vi.fn(() => { visible = true; }),
    focus: vi.fn(),
    once: vi.fn(),
  } as unknown as BrowserWindow;
  return { window, webContents, messages, setVisible(value: boolean) { visible = value; },
    setMinimized(value: boolean) { minimized = value; },
    setMode(value: typeof mode) { mode = value; },
    setBounds(value: typeof bounds) { bounds = value; } };
}

const tab: TransferableTab = {
  id: 'document',
  document: {
    path: '/project/document.txt', name: 'document.txt', text: 'content', savedText: 'content',
    revision: 0, savedRevision: 0, diskVersion: { mtimeMs: 1, size: 7 }, isUntitled: false,
  },
  text: 'content', revision: 0, surface: 'editor',
  anchor: { sourceLine: 1, yRatio: .372, reason: 'test', confidence: 'exact' },
  editorViewState: null, viewerScrollRatio: null, previewUrl: null,
  previewRevision: null, previewTheme: null, tocOpen: false,
};

function fixture() {
  electron.listeners.clear(); electron.handlers.clear();
  const source = fakeWindow(1), existing = fakeWindow(2), prepared = fakeWindow(3);
  prepared.setVisible(false);
  const states = new Map([
    [1, { window: source.window } as WindowState],
    [2, { window: existing.window } as WindowState],
    [3, { window: prepared.window } as WindowState],
  ]);
  const createWindow = vi.fn(() => prepared.window);
  const manager = new TabTransferManager({
    previews: { views: new Map(), restoreScroll: vi.fn() } as unknown as PreviewManager,
    stateFor: id => states.get(id) ?? null,
    windows: () => states.values(),
    theme: () => 'paper',
    createWindow,
  });
  manager.registerIpc();
  const event = (id: number) => ({ sender: { id } });
  const register = () => electron.listeners.get('tabs:register-transfer')!(event(1), { transferId: 'move', tab });
  const hover = (id: number, accepted = true, inside = true) => electron.listeners.get('tabs:drag-target')!(event(id), { transferId: 'move', accepted, inside });
  const end = (withinSource = false, dropEffect?: string) => electron.listeners.get('tabs:detach-to-window')!(event(1), { transferId: 'move', x: 700, y: 400, withinSource, dropEffect });
  const detach = () => { hover(1, false, false); end(); };
  const claim = () => electron.handlers.get('tabs:claim-transfer')!(event(2), 'move') as Promise<unknown>;
  return { source, existing, prepared, createWindow, register, hover, end, detach, claim };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

test('an existing-window claim wins when source dragend requests detach first', async () => {
  const f = fixture();
  f.register();
  f.detach();

  const claimed = await f.claim();
  expect(claimed).toMatchObject({ transferId: 'move', tab: { id: 'document' } });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
  expect(f.prepared.webContents.send).not.toHaveBeenCalledWith('tabs:transfer-incoming', expect.anything());
  expect(f.prepared.window.destroy).toHaveBeenCalledOnce();
});

test('an unclaimed outside drop still detaches after claim arbitration', async () => {
  const f = fixture();
  f.register();
  f.detach();

  expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.prepared.window.showInactive).toHaveBeenCalledOnce();
  expect(f.prepared.webContents.send).toHaveBeenCalledWith('tabs:transfer-incoming',
    expect.objectContaining({ transferId: 'move' }));
});

for (const mode of ['maximized', 'fullscreen'] as const) {
  for (const area of ['center', 'outside', 'terminal-leave'] as const) test(`${mode} ${area} drops never create a window`, async () => {
    const f = fixture(); f.source.setMode(mode); f.register();
    expect(f.createWindow).not.toHaveBeenCalled();
    f.hover(1, false, area === 'center');
    f.end(area !== 'outside', area === 'outside' ? 'none' : 'move');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.createWindow).not.toHaveBeenCalled();
    expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
    expect(f.source.messages.at(-1)).toEqual({ channel: 'tabs:drag-state', payload: { transferId: 'move', active: false } });
    expect(f.source.webContents.send).not.toHaveBeenCalledWith('tabs:transfer-completed', expect.anything());
    expect(await f.claim()).toBeNull();
  });
  test(`${mode} still commits an accepted local split`, () => {
    const f = fixture(); f.source.setMode(mode); f.register(); f.hover(1); f.end(false, 'move');
    expect(f.source.messages.at(-1)).toEqual({ channel: 'tabs:drag-state', payload: {
      transferId: 'move', active: false, commitGuide: true, copy: false,
    } });
    expect(f.createWindow).not.toHaveBeenCalled();
  });
  test(`${mode} keeps late existing-window claims eligible`, async () => {
    const f = fixture(); f.source.setMode(mode); f.register(); f.detach();
    await vi.advanceTimersByTimeAsync(50);
    expect(await f.claim()).toMatchObject({ transferId: 'move', tab: { id: 'document' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.createWindow).not.toHaveBeenCalled();
    expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
  });
  test(`entering ${mode} during detach arbitration cancels the prepared window`, async () => {
    const f = fixture(); f.register(); f.detach(); f.source.setMode(mode);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.prepared.window.destroy).toHaveBeenCalledOnce();
    expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
    expect(await f.claim()).toBeNull();
  });
  test(`restoring a window during a ${mode} drag cannot enable tear-off`, async () => {
    const f = fixture(); f.source.setMode(mode); f.register(); f.source.setMode('normal'); f.detach();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.createWindow).not.toHaveBeenCalled();
    expect(await f.claim()).toBeNull();
  });
}

test('a delayed local drop can replace stale center tear-off ownership before detachment', async () => {
  const f = fixture(); f.register(); f.hover(1, false); f.end(true, 'move');
  expect(f.source.messages.at(-1)).toEqual({ channel: 'tabs:drag-state', payload: { transferId: 'move', active: true } });
  await vi.advanceTimersByTimeAsync(50);
  f.hover(1, true);
  // The receiver's actual local drop cancels the transfer before moving its tab.
  electron.listeners.get('tabs:cancel-transfer')!({ sender: { id: 1 } }, 'move');
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
  expect(f.prepared.window.destroy).toHaveBeenCalledOnce();
});

for (const terminalLeave of [false, true]) test(`a canceled inside release cannot reuse a stale center tear-off: leave=${terminalLeave}`, async () => {
  const f = fixture(); f.register(); f.hover(1, false);
  if (terminalLeave) f.hover(1, false, false);
  electron.listeners.get('tabs:detach-to-window')!({ sender: { id: 1 } }, {
    transferId: 'move', x: 1200, y: 400, withinSource: true, dropEffect: 'none', release: { x: 899, y: 350 },
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
  expect(f.prepared.window.destroy).toHaveBeenCalledOnce();
});

for (const type of ['keyDown', 'keyUp']) test(`native Escape ${type} cancels an outside transfer without DOM keydown`, async () => {
  const f = fixture(); f.register(); f.detach();
  const input = f.source.webContents.on.mock.calls.find(([name]) => name === 'before-input-event')![1];
  input({}, { type, key: 'Escape', isComposing: false });
  f.detach(); // A late renderer dragend cannot recreate the canceled transfer.
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.prepared.window.destroy).toHaveBeenCalledOnce();
  expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
  expect(await f.claim()).toBeNull();
});

test('a source-center tear-off ignores a window behind the source', async () => {
  const f = fixture(); f.register();
  electron.listeners.get('tabs:detach-to-window')!({ sender: { id: 1 } },
    { transferId: 'move', x: 1200, y: 400, withinSource: true });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.prepared.window.showInactive).toHaveBeenCalledOnce();
  expect(f.prepared.webContents.send).toHaveBeenCalledWith('tabs:transfer-incoming', expect.objectContaining({ transferId: 'move' }));
});

for (const withinSource of [false, true]) test(`a drop outside the source allows the destination claim with withinSource=${withinSource}`, async () => {
  const f = fixture();
  f.existing.setBounds({ x: 600, y: 300, width: 900, height: 700 });
  f.register(); f.hover(2); f.end(withinSource);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
  expect(await f.claim()).toMatchObject({ transferId: 'move', tab: { id: 'document' } });
  expect(f.prepared.window.destroy).toHaveBeenCalledOnce();
});

for (const hidden of ['minimized', 'hidden', 'destroyed'] as const) test(`a ${hidden} window does not intercept an outside drop`, async () => {
  const f = fixture();
  f.existing.setBounds({ x: 600, y: 300, width: 900, height: 700 });
  if (hidden === 'minimized') f.existing.setMinimized(true);
  else if (hidden === 'hidden') f.existing.setVisible(false);
  else f.existing.window.destroy();
  f.register(); f.detach();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.prepared.window.showInactive).toHaveBeenCalledOnce();
});

test('a rejected drop over an existing window expires without creating a window or removing the source', async () => {
  const f = fixture();
  f.existing.setBounds({ x: 600, y: 300, width: 900, height: 700 });
  f.register(); f.hover(2, false); f.end();
  await vi.advanceTimersByTimeAsync(61_000);
  expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
  expect(f.prepared.window.destroy).toHaveBeenCalledOnce();
  expect(f.source.webContents.send).not.toHaveBeenCalledWith('tabs:transfer-completed', expect.anything());
  expect(f.source.messages.filter(message => message.channel === 'tabs:drag-state')).toEqual([
    { channel: 'tabs:drag-state', payload: { transferId: 'move', active: true } },
    { channel: 'tabs:drag-state', payload: { transferId: 'move', active: false } },
  ]);
  expect(await f.claim()).toBeNull();
});

test('drag lifetime covers all visible shells and ends on a claim, without showing the prepared window', async () => {
  const f = fixture(); f.register();
  for (const window of [f.source, f.existing]) expect(window.messages).toEqual([
    { channel: 'tabs:drag-state', payload: { transferId: 'move', active: true } },
  ]);
  expect(f.prepared.messages).toEqual([]);
  expect(await f.claim()).toMatchObject({ transferId: 'move' });
  for (const window of [f.source, f.existing]) expect(window.messages.at(-1)).toEqual(
    { channel: 'tabs:drag-state', payload: { transferId: 'move', active: false } });
  expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
});

test('a consumed outside drop clears receivers while keeping the late destination claim available', async () => {
  const f = fixture(); f.existing.setBounds({ x: 600, y: 300, width: 900, height: 700 }); f.register(); f.hover(2); f.end();
  expect(f.existing.messages.at(-1)).toEqual({ channel: 'tabs:drag-state', payload: { transferId: 'move', active: false } });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await f.claim()).toMatchObject({ transferId: 'move' });
  expect(f.existing.messages.filter(message => (message.payload as { active: boolean }).active === false)).toHaveLength(1);
});

test('native Escape clears remote guides and a claim after expiry releases every participant', async () => {
  const f = fixture(); f.register();
  const input = f.source.webContents.on.mock.calls.find(([name]) => name === 'before-input-event')![1];
  input({}, { type: 'keyUp', key: 'Escape', isComposing: false });
  expect(f.existing.messages.at(-1)).toEqual({ channel: 'tabs:drag-state', payload: { transferId: 'move', active: false } });
  expect(await f.claim()).toBeNull();
  const next = fixture(); next.register(); await vi.advanceTimersByTimeAsync(60_001);
  expect(await next.claim()).toBeNull();
  expect(next.existing.messages.at(-1)).toEqual({ channel: 'tabs:drag-state', payload: { transferId: 'move', active: false } });
  expect(next.prepared.window.destroy).toHaveBeenCalledOnce();
});

for (const effect of ['move', 'copy', 'none', undefined]) test(`remote guide fallback requires an accepted OS effect: ${effect}`, async () => {
  const f = fixture(); f.register();
  electron.listeners.get('tabs:drag-target')!({ sender: { id: 2 } }, { transferId: 'move', accepted: true });
  electron.listeners.get('tabs:detach-to-window')!({ sender: { id: 1 } }, { transferId: 'move', x: 1200, y: 400, dropEffect: effect });
  expect(f.existing.messages.at(-1)).toEqual({ channel: 'tabs:drag-state', payload: {
    transferId: 'move', active: false, ...(['move', 'copy'].includes(effect ?? '') ? { commitGuide: true, copy: effect === 'copy' } : {}),
  } });
  expect(f.source.messages.at(-1)).toEqual({ channel: 'tabs:drag-state', payload: { transferId: 'move', active: false } });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
  expect(await f.claim()).toMatchObject({ transferId: 'move' });
});

for (const reason of ['leave', 'outside', 'escape', 'hidden', 'minimized', 'destroyed', 'source-tear-off', 'unregistered-target', 'wrong-source'])
test(`remote guide fallback rejects ${reason}`, async () => {
  const f = fixture(); f.register();
  electron.listeners.get('tabs:drag-target')!({ sender: { id: reason === 'unregistered-target' ? 3 : 2 } }, { transferId: 'move', accepted: true });
  if (reason === 'leave' || reason === 'outside') f.hover(2, false, false);
  if (reason === 'source-tear-off') f.hover(1, false);
  if (reason === 'escape') f.source.webContents.on.mock.calls.find(([name]) => name === 'before-input-event')![1]({}, { key: 'Escape' });
  if (reason === 'hidden') f.existing.setVisible(false);
  if (reason === 'minimized') f.existing.setMinimized(true);
  if (reason === 'destroyed') f.existing.window.destroy();
  electron.listeners.get('tabs:detach-to-window')!({ sender: { id: reason === 'wrong-source' ? 2 : 1 } }, {
    transferId: 'move', x: reason === 'outside' ? 700 : 1200, y: 400,
    withinSource: reason === 'source-tear-off', dropEffect: 'move',
  });
  expect(f.existing.messages.some(message => (message.payload as { commitGuide?: boolean }).commitGuide)).toBe(false);
  if (reason === 'escape') expect(await f.claim()).toBeNull();
});

test('a completed DOM claim and duplicate dragend cannot install a fallback twice', async () => {
  const f = fixture(); f.register();
  electron.listeners.get('tabs:drag-target')!({ sender: { id: 2 } }, { transferId: 'move', accepted: true });
  await f.claim();
  electron.listeners.get('tabs:detach-to-window')!({ sender: { id: 1 } }, { transferId: 'move', x: 1200, y: 400, dropEffect: 'move' });
  expect(f.existing.messages.some(message => (message.payload as { commitGuide?: boolean }).commitGuide)).toBe(false);
  expect(await f.claim()).toBeNull();
});

for (const coordinates of ['overlapping', 'wayland-zero']) test(`OS receiver selects the destination with ${coordinates} bounds`, async () => {
  const f = fixture();
  const bounds = { x: coordinates === 'wayland-zero' ? 0 : 200, y: 0, width: 900, height: 700 };
  f.source.setBounds(bounds); f.existing.setBounds(bounds);
  f.register(); f.hover(2); f.end(false, 'move');
  expect(f.existing.messages.at(-1)).toEqual({ channel: 'tabs:drag-state', payload: {
    transferId: 'move', active: false, commitGuide: true, copy: false,
  } });
  expect(f.source.messages.some(message => message.channel === 'tabs:native-drag'
    && (message.payload as { type: string }).type === 'dragleave')).toBe(true);
  expect(await f.claim()).toMatchObject({ transferId: 'move' });
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
});

test('returning to a local guide clears a remote guide and commits only once', async () => {
  const f = fixture(); f.register(); f.hover(2); f.hover(1); f.end(false, 'copy'); f.end(false, 'copy');
  expect(f.source.messages.filter(message => (message.payload as { commitGuide?: boolean }).commitGuide)).toEqual([
    { channel: 'tabs:drag-state', payload: { transferId: 'move', active: false, commitGuide: true, copy: true } },
  ]);
  expect(f.existing.messages.some(message => (message.payload as { commitGuide?: boolean }).commitGuide)).toBe(false);
});

for (const effect of ['move', 'none']) test(`coordinate-less terminal leave retains a guide only for an accepted OS drop: ${effect}`, async () => {
  const f = fixture(); f.register(); f.hover(2);
  electron.listeners.get('tabs:drag-target')!({ sender: { id: 2 } }, {
    transferId: 'move', accepted: false, inside: false, retainGuide: true,
  });
  f.end(false, effect);
  expect(f.existing.messages.some(message => (message.payload as { commitGuide?: boolean }).commitGuide)).toBe(effect === 'move');
  if (effect === 'move') {
    expect(await f.claim()).toMatchObject({ transferId: 'move' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
  }
});

test('outside source-local release defeats a retained local guide even with stale move effect', async () => {
  const f = fixture(); f.source.setBounds({ x: 0, y: 0, width: 900, height: 700 }); f.register(); f.hover(1);
  electron.listeners.get('tabs:drag-target')!({ sender: { id: 1 } }, { transferId: 'move', accepted: false, inside: false, retainGuide: true });
  electron.listeners.get('tabs:detach-to-window')!({ sender: { id: 1 } }, {
    transferId: 'move', x: 0, y: 0, dropEffect: 'move', release: { x: -100, y: 100 },
  });
  expect(f.source.messages.some(message => (message.payload as { commitGuide?: boolean }).commitGuide)).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.prepared.window.showInactive).toHaveBeenCalledOnce();
});

for (const wayland of [false, true]) test(`a screen point supersedes stale source coordinates only when global positions exist: Wayland=${wayland}`, async () => {
  vi.stubEnv('WAYLAND_DISPLAY', wayland ? 'private-test-wayland' : '');
  const f = fixture(); f.register(); f.hover(1);
  electron.listeners.get('tabs:detach-to-window')!({ sender: { id: 1 } }, {
    transferId: 'move', x: 700, y: 400, dropEffect: 'move', release: { x: 200, y: 200 },
  });
  const commitsLocal = wayland && process.platform === 'linux';
  expect(f.source.messages.some(message => (message.payload as { commitGuide?: boolean }).commitGuide)).toBe(commitsLocal);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.prepared.window.showInactive).toHaveBeenCalledTimes(commitsLocal ? 0 : 1);
});
