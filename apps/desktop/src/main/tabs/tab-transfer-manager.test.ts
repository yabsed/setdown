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

test('a drop over an existing window allows its claim after the detach grace period', async () => {
  const f = fixture();
  f.existing.setBounds({ x: 600, y: 300, width: 900, height: 700 });
  f.register(); f.detach();
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
  expect(f.source.webContents.send).not.toHaveBeenCalled();
  expect(await f.claim()).toBeNull();
});
