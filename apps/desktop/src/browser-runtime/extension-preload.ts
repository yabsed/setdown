import { contextBridge, ipcRenderer, webFrame } from 'electron';

// Appended after the pinned extension compatibility preload at build time.
// Only the bundled extension sees these bindings; remote pages receive none.
if (location.protocol === 'chrome-extension:') {
  const css = (tabId: number, details: { code: string; frameId?: number; allFrames?: boolean }, remove: boolean) =>
    ipcRenderer.invoke('browser:extension-css', tabId, details, remove);
  function install() {
    const root = globalThis as unknown as { chrome: { tabs: Record<string, unknown> }; setdownExtensionCSS: typeof css };
    // Migrate the recursive cache written by the old managed→local alias.
    // This is an adapter-owned cache; uBO's filters and preferences stay intact.
    if (location.pathname === '/background.html') {
      const chrome = (globalThis as unknown as { chrome: {
        storage: { local: { remove(key: string, callback: () => void): void } };
        runtime: { lastError?: { message: string } };
      } }).chrome;
      chrome.storage.local.remove('cachedManagedStorage', () => {
        if (chrome.runtime.lastError) console.error('Could not remove the obsolete managed storage cache', chrome.runtime.lastError.message);
      });
    }
    root.chrome.tabs.insertCSS = (tabId: number, details: Parameters<typeof css>[1], callback?: () => void) =>
      root.setdownExtensionCSS(tabId, details, false).then(() => callback?.());
    root.chrome.tabs.removeCSS = (tabId: number, details: Parameters<typeof css>[1], callback?: () => void) =>
      root.setdownExtensionCSS(tabId, details, true).then(() => callback?.());
  }
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('setdownExtensionCSS', css);
    contextBridge.executeInMainWorld({ func: install });
  } else {
    (globalThis as unknown as { setdownExtensionCSS: typeof css }).setdownExtensionCSS = css;
    void webFrame.executeJavaScript(`(${install.toString()})()`);
  }
}
