import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const electron = vi.hoisted(() => {
  const loaded = new Map<string, { id: string; path: string }>();
  return {
    loaded,
    app: { getPath: vi.fn(), on: vi.fn(), isPackaged: false },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    webContents: { getAllWebContents: vi.fn(() => []) },
    session: {
      serviceWorkers: { on: vi.fn() },
      extensions: {
        on: vi.fn(),
        loadExtension: vi.fn(async (extensionPath: string) => {
          const id = 'a'.repeat(32);
          loaded.set(id, { id, path: extensionPath });
          return { id, path: extensionPath, name: 'Fixture', version: '1.0', manifest: {} };
        }),
        removeExtension: vi.fn((id: string) => { loaded.delete(id); }),
        getAllExtensions: vi.fn(() => [...loaded.values()]),
      },
      getPreloadScripts: vi.fn(() => []),
      registerPreloadScript: vi.fn(),
      unregisterPreloadScript: vi.fn(),
    },
  };
});
vi.mock('electron', () => electron);
vi.mock('electron-chrome-extensions', () => ({ ElectronChromeExtensions: class {
  ctx = { router: { handle: vi.fn(), onExtensionMessage: vi.fn() }, store: { on: vi.fn() } };
  api = { browserAction: { actionMap: new Map(), onUpdate: vi.fn() } };
  on = vi.fn();
} }));
const store = vi.hoisted(() => ({ downloadExtension: vi.fn() }));
vi.mock('electron-chrome-web-store', () => store);
import { BrowserExtensions } from './browser-extensions';
import { extensionIdFromKey, localExtensionDir } from './extension-package';

let root: string, source: string, extensions: BrowserExtensions;
const manifest = { manifest_version: 2, name: 'Fixture Extension', version: '1.0',
  permissions: ['storage'], browser_action: { default_popup: 'popup.html' } };

beforeEach(async () => {
  vi.clearAllMocks(); electron.loaded.clear();
  root = await mkdtemp(path.join(os.tmpdir(), 'setdown-extensions-unit-'));
  electron.app.getPath.mockReturnValue(root);
  source = path.join(root, 'downloaded');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(source, 'popup.html'), '<!doctype html>Popup');
  extensions = new BrowserExtensions(electron.session as never, () => undefined, {} as never);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('BrowserExtensions registry', () => {
  test('installs a folder package, persists it, and toggles/removes it', async () => {
    const inspected = await extensions.inspect(source);
    expect(inspected.info).toMatchObject({ name: 'Fixture Extension', version: '1.0', popupPath: 'popup.html' });
    const installed = await extensions.commit(inspected.token);
    expect(installed).toMatchObject({ name: 'Fixture Extension', enabled: true, builtin: false, hasPopup: true, error: null });

    const dir = localExtensionDir({ name: 'Fixture Extension' });
    await expect(stat(path.join(root, 'extensions', dir, 'manifest.json'))).resolves.toBeTruthy();
    const registry = JSON.parse(await readFile(path.join(root, 'browser-extensions.json'), 'utf8'));
    expect(registry).toEqual([{ dir, enabled: true }]);
    expect(electron.session.extensions.loadExtension).toHaveBeenCalledOnce();

    const disabled = await extensions.setEnabled(installed.id, false);
    expect(disabled[0].enabled).toBe(false);
    expect(electron.session.extensions.removeExtension).toHaveBeenCalledWith(installed.id);
    // The public ID stays stable while the extension is disabled.
    const enabled = await extensions.setEnabled(installed.id, true);
    expect(enabled[0]).toMatchObject({ id: installed.id, enabled: true });

    await extensions.remove(installed.id);
    expect(extensions.list()).toEqual([]);
    await expect(stat(path.join(root, 'extensions', dir))).rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(root, 'browser-extensions.json'), 'utf8'))).toEqual([]);
  });

  test('clears staging folders abandoned by a previous run', async () => {
    const stale = path.join(root, 'extensions', '.staging-abandoned');
    await mkdir(stale, { recursive: true });
    await writeFile(path.join(stale, 'manifest.json'), JSON.stringify(manifest));
    const inspected = await extensions.inspect(source);
    await expect(stat(stale)).rejects.toThrow();
    await expect(extensions.commit(inspected.token)).resolves.toMatchObject({ name: 'Fixture Extension' });
  });

  test('prepare registers frame and worker preloads once without starting uBlock', () => {
    extensions.prepare();
    extensions.prepare();
    expect(electron.session.registerPreloadScript).toHaveBeenCalledTimes(2);
    expect(electron.session.registerPreloadScript).toHaveBeenCalledWith(expect.objectContaining({ type: 'frame', filePath: expect.stringContaining('chrome-extension-api.preload.cjs') }));
    expect(electron.session.registerPreloadScript).toHaveBeenCalledWith(expect.objectContaining({ type: 'service-worker', filePath: expect.stringContaining('chrome-extension-worker.preload.cjs') }));
    expect(electron.session.extensions.loadExtension).not.toHaveBeenCalled();
  });

  test('cosmetic CSS for a frame that never acknowledges resolves instead of rejecting', async () => {
    vi.useFakeTimers();
    try {
      const applyCSS = (extensions as unknown as {
        applyCSS(frame: unknown, code: string, remove: boolean): Promise<void>;
      }).applyCSS.bind(extensions);
      const frame = { url: 'https://example.test/ad', send: vi.fn() };
      const applied = applyCSS(frame, '.ad { display: none !important; }', false);
      let settled = false;
      void applied.then(() => { settled = true; }, () => { settled = true; });
      await vi.advanceTimersByTimeAsync(4999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(applied).resolves.toBeUndefined();
      expect(frame.send).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  test('rejects packages without a manifest and expired installs', async () => {
    const empty = path.join(root, 'empty');
    await mkdir(empty);
    await expect(extensions.inspect(empty)).rejects.toThrow(/manifest\.json/);
    await expect(extensions.commit('missing-token')).rejects.toThrow(/expired/);
    await expect(extensions.setEnabled('unknown', true)).rejects.toThrow(/Unknown extension/);
  });

  test('downloads into staging, preserves the store identity and never loads before confirmation', async () => {
    const key = Buffer.alloc(64, 7).toString('base64'), id = extensionIdFromKey(key)!;
    await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ ...manifest, key }));
    store.downloadExtension.mockResolvedValue(source);
    const staged = await extensions.inspectWebStore(`https://chromewebstore.google.com/detail/fixture/${id}`);
    expect(store.downloadExtension).toHaveBeenCalledWith(id, expect.stringContaining('.download-'));
    expect(electron.session.extensions.loadExtension).not.toHaveBeenCalled();
    await extensions.discard(staged.token);
    expect(await readdir(path.join(root, 'extensions'))).toEqual([]);
    const next = await extensions.inspectWebStore(id);
    expect(await extensions.commit(next.token)).toMatchObject({ webStoreId: id, enabled: true });
    expect(JSON.parse(await readFile(path.join(root, 'browser-extensions.json'), 'utf8')))
      .toEqual([{ dir: id, enabled: true, webStoreId: id }]);
  });

  test('rejects a different downloaded ID and cleans up failed downloads', async () => {
    store.downloadExtension.mockResolvedValue(source);
    await expect(extensions.inspectWebStore('b'.repeat(32))).rejects.toThrow(/does not match/);
    expect(await readdir(path.join(root, 'extensions'))).toEqual([]);
    store.downloadExtension.mockRejectedValueOnce(Error('Network failed'));
    await expect(extensions.inspectWebStore('b'.repeat(32))).rejects.toThrow(/Network failed/);
    expect(await readdir(path.join(root, 'extensions'))).toEqual([]);
    expect(electron.session.extensions.loadExtension).not.toHaveBeenCalled();
  });

  test('a failed replacement restores the previous files, enabled state and registry', async () => {
    await extensions.commit((await extensions.inspect(source)).token);
    await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ ...manifest, version: '2.0' }));
    const update = await extensions.inspect(source);
    electron.session.extensions.loadExtension.mockRejectedValueOnce(Error('Unsupported extension'));
    await expect(extensions.commit(update.token)).rejects.toThrow(/Unsupported/);
    expect(extensions.list()[0]).toMatchObject({ version: '1.0', enabled: true, error: null });
    const dir = localExtensionDir(manifest);
    expect(JSON.parse(await readFile(path.join(root, 'extensions', dir, 'manifest.json'), 'utf8')).version).toBe('1.0');
    expect(await readdir(path.join(root, 'extensions'))).toEqual([dir]);
    expect(JSON.parse(await readFile(path.join(root, 'browser-extensions.json'), 'utf8'))).toEqual([{ dir, enabled: true }]);
  });

  test('a disable requested during replacement applies to the completed new version', async () => {
    const installed = await extensions.commit((await extensions.inspect(source)).token);
    await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ ...manifest, version: '2.0' }));
    const update = await extensions.inspect(source);
    let release!: () => void, entered!: () => void;
    const loading = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const originalLoad = electron.session.extensions.loadExtension.getMockImplementation()!;
    electron.session.extensions.loadExtension.mockImplementationOnce(async extensionPath => {
      entered(); await wait; return originalLoad(extensionPath);
    });
    const replacing = extensions.commit(update.token); await loading;
    const disabling = extensions.setEnabled(installed.id, false);
    release(); await replacing; await disabling;
    expect(extensions.list()[0]).toMatchObject({ version: '2.0', enabled: false });
    expect(JSON.parse(await readFile(path.join(root, 'browser-extensions.json'), 'utf8'))[0].enabled).toBe(false);
  });

  test('updating a disabled extension keeps it disabled without executing its new code', async () => {
    const installed = await extensions.commit((await extensions.inspect(source)).token);
    await extensions.setEnabled(installed.id, false);
    await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ ...manifest, version: '2.0' }));
    electron.session.extensions.loadExtension.mockClear();
    const updated = await extensions.commit((await extensions.inspect(source)).token);
    expect(updated).toMatchObject({ id: installed.id, version: '2.0', enabled: false });
    expect(electron.session.extensions.loadExtension).not.toHaveBeenCalled();
  });
});
