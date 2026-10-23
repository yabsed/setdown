import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { TransferableTab } from '../../protocol/desktop-api';
import type { PreviewManager } from '../preview/preview-manager';
import type { WindowState } from '../windows/window-state';
import { TabTransferManager } from './tab-transfer-manager';

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
  let bounds = { x: 1000, y: 100, width: 900, height: 700 };
  const messages: Array<{ channel: string; payload: unknown }> = [];
  const webContents = {
    id,
    on: vi.fn(),
    send: vi.fn((channel: string, payload: unknown) => messages.push({ channel, payload })),
    isLoadingMainFrame: () => false,
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
    setPosition: vi.fn(),
    isVisible: () => visible,
    showInactive: vi.fn(() => { visible = true; }),
    show: vi.fn(() => { visible = true; }),
    focus: vi.fn(),
    once: vi.fn(),
  } as unknown as BrowserWindow;
  return { window, webContents, messages, setVisible(value: boolean) { visible = value; },
    setMinimized(value: boolean) { minimized = value; },
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
  const manager = new TabTransferManager({
    previews: { views: new Map(), restoreScroll: vi.fn() } as unknown as PreviewManager,
    stateFor: id => states.get(id) ?? null,
    windows: () => states.values(),
    theme: () => 'paper',
    createWindow: () => prepared.window,
  });
  manager.registerIpc();
  const event = (id: number) => ({ sender: { id } });
  const register = () => electron.listeners.get('tabs:register-transfer')!(event(1), { transferId: 'move', tab });
  const detach = () => electron.listeners.get('tabs:detach-to-window')!(event(1), { transferId: 'move', x: 700, y: 400 });
  const claim = () => electron.handlers.get('tabs:claim-transfer')!(event(2), 'move') as Promise<unknown>;
  return { source, existing, prepared, register, detach, claim };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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
  f.register();
  electron.listeners.get('tabs:detach-to-window')!({ sender: { id: 1 } }, { transferId: 'move', x: 700, y: 400, withinSource });
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
  f.register(); f.detach();
  await vi.advanceTimersByTimeAsync(61_000);
  expect(f.prepared.window.showInactive).not.toHaveBeenCalled();
  expect(f.prepared.window.destroy).toHaveBeenCalledOnce();
  expect(f.source.webContents.send).not.toHaveBeenCalledWith('tabs:transfer-completed', expect.anything());
  expect(f.source.messages).toEqual([
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
  const f = fixture(); f.existing.setBounds({ x: 600, y: 300, width: 900, height: 700 }); f.register(); f.detach();
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
    transferId: 'move', active: false, ...(['move', 'copy'].includes(effect ?? '') ? { commitGuide: true } : {}),
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
  if (reason === 'leave') electron.listeners.get('tabs:drag-target')!({ sender: { id: 2 } }, { transferId: 'move', accepted: false });
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
