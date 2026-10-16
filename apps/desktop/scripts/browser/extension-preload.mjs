/** Guard each upstream patch so an incompatible dependency upgrade fails closed. */
export function patchExtensionPreload(compat, additions = '') {
  // Preserve Electron's native blocking header event. The pinned compatibility
  // library replaces it with an event that has no native response-header source.
  const broken = 'onHeadersReceived: new ExtensionEvent("webRequest.onHeadersReceived")';
  if (compat.split(broken).length !== 2) throw Error('Review the extension header adapter for the installed library version.');
  compat = compat.replace(broken, 'onHeadersReceived: base?.onHeadersReceived');
  // There is no enterprise policy backend in Setdown. Aliasing managed storage
  // to local storage makes uBO cache the whole local store inside itself on each
  // startup, including its previous cachedManagedStorage value. Repeated starts
  // grow that recursive cache until the background page cannot initialize.
  const managedAlias = 'managed: local,';
  if (compat.split(managedAlias).length !== 2) throw Error('Review the managed storage adapter for the installed library version.');
  compat = compat.replace(managedAlias, 'managed: undefined,');
  // Chromium now exposes `browser` as a separate native namespace. uBO prefers
  // it and assigns it to `chrome`, discarding this adapter unless both names use
  // the same augmented API. Install the alias synchronously, before page scripts.
  const freezeChrome = 'Object.freeze(chrome);';
  if (compat.split(freezeChrome).length !== 2) throw Error('Review the extension namespace adapter for the installed library version.');
  compat = compat.replace(freezeChrome, () => `${additions}
if (globalThis.browser) {
          Object.defineProperty(globalThis, "browser", { value: chrome, writable: true, configurable: true, enumerable: true });
        }
        ${freezeChrome}`);
  return compat;
}

export function secureExtensionInvocations(compat) {
  const invoke = 'await import_electron2.ipcRenderer.invoke("crx-msg", extensionId, fnName, ...args)';
  if (compat.split(invoke).length !== 2) throw Error('Review the private extension invocation adapter for the installed library version.');
  compat = compat.replace(invoke, 'await import_electron2.ipcRenderer.invoke(fnName === "proxy.authResponse" ? "setdown:extension-private" : "crx-msg", extensionId, fnName, ...args)');
    // Upstream's development logging prints every argument. Proxy auth replies
    // contain credentials; neither arguments nor results belong in the console.
    for (const statement of ['console.log(fnName, args);', 'console.log(fnName, "(result)", result);']) {
      if (compat.split(statement).length !== 2) throw Error('Review the extension invocation logging adapter for the installed library version.');
      compat = compat.replace(statement, '/* Extension API payload logging disabled. */');
    }
  return compat;
}
