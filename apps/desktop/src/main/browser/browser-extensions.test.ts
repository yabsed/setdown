import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const electron = vi.hoisted(() => {
  const loaded = new Map<string, { id: string; path: string }>();
  return {
    loaded,
    app: { getPath: vi.fn(), isPackaged: false },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    webContents: { getAllWebContents: vi.fn(() => []) },
    session: {
      extensions: {
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
vi.mock('electron-chrome-extensions', () => ({ ElectronChromeExtensions: class {} }));
import { BrowserExtensions } from './browser-extensions';
import { localExtensionDir } from '../../core/browser/extension-package';

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

  test('prepare registers the session preload once without starting uBlock', () => {
    extensions.prepare();
    extensions.prepare();
    expect(electron.session.registerPreloadScript).toHaveBeenCalledOnce();
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
});
