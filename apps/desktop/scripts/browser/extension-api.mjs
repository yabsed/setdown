// Runs inside the upstream main-world initializer, before it freezes chrome.
// These methods return an envelope across IPC; callbacks see lastError only
// during their invocation, while Promise callers get a rejection.
export const extensionAPI = `
const setdownInvoke = (name) => (...args) => {
  const callback = typeof args[args.length - 1] === 'function' ? args.pop() : undefined;
  const result = invokeExtension2(name)(...args).then(reply => {
    if (!reply || typeof reply !== 'object' || (!('value' in reply) && !('error' in reply))) throw Error(name + ': invalid host response');
    if (reply.error) throw Error(reply.error);
    return reply.value;
  });
  if (!callback) return result;
  result.then(value => callback(value), error => {
    const descriptor = Object.getOwnPropertyDescriptor(chrome.runtime, 'lastError');
    Object.defineProperty(chrome.runtime, 'lastError', { configurable: true, value: { message: error.message } });
    try { callback(); } finally {
      if (descriptor) Object.defineProperty(chrome.runtime, 'lastError', descriptor);
      else delete chrome.runtime.lastError;
    }
  });
};
const setdownSetting = name => ({ get: setdownInvoke(name + '.get'), set: setdownInvoke(name + '.set'), clear: setdownInvoke(name + '.clear'), onChange: new ExtensionEvent(name + '.onChange') });
Object.defineProperty(chrome, 'proxy', { configurable: true, enumerable: true, value: { settings: setdownSetting('proxy'), onProxyError: new ExtensionEvent('proxy.onProxyError') } });
chrome.privacy.network.webRTCIPHandlingPolicy = setdownSetting('privacy.network.webRTCIPHandlingPolicy');
const unsupportedSetting = name => ({ get: setdownInvoke('unsupported.' + name), set: setdownInvoke('unsupported.' + name), clear: setdownInvoke('unsupported.' + name), onChange: new ExtensionEvent(name + '.onChange') });
for (const group of Object.keys(chrome.privacy)) for (const name of Object.keys(chrome.privacy[group])) {
  if (name !== 'webRTCIPHandlingPolicy') chrome.privacy[group][name] = unsupportedSetting('privacy.' + group + '.' + name);
}
Object.defineProperty(chrome, 'browsingData', { configurable: true, enumerable: true, value: { remove: setdownInvoke('browsingData.remove') } });
for (const name of ['Cookies', 'Cache', 'LocalStorage', 'IndexedDB', 'ServiceWorkers', 'CacheStorage']) chrome.browsingData['remove' + name] = (options, callback) => chrome.browsingData.remove(options, { [name[0].toLowerCase() + name.slice(1)]: true }, callback);
for (const name of ['getAll', 'contains', 'request', 'remove']) chrome.permissions[name] = setdownInvoke('permissions.' + name);
for (const name of ['download', 'search', 'pause', 'resume', 'cancel', 'show', 'open']) chrome.downloads[name] = setdownInvoke('downloads.' + name);
for (const name of ['erase', 'removeFile', 'getFileIcon', 'acceptDanger', 'setUiOptions', 'showDefaultFolder']) chrome.downloads[name] = setdownInvoke('unsupported.downloads.' + name);
const proxyAuth = new ExtensionEvent('setdown.proxyAuthRequired');
const nativeAuth = chrome.webRequest?.onAuthRequired;
const authListeners = new Map();
if (chrome.webRequest) chrome.webRequest.onAuthRequired = {
  addListener(callback, filter, options = []) {
    if (authListeners.has(callback)) return;
    const wrapped = (details, token) => {
      const matches = filter?.urls?.some(pattern => pattern === '<all_urls>' || new RegExp('^' + pattern.split('*').map(part => part.replace(/[.+?^$()|[\\]{}\\\\]/g, '\\\\$&')).join('.*') + '$').test(details.url));
      if (!matches || filter.types && !filter.types.includes(details.type) || filter.tabId !== undefined && filter.tabId !== details.tabId) return;
      let answered = false;
      const reply = response => { if (!answered) { answered = true; void setdownInvoke('proxy.authResponse')(token, response || {}).catch(() => {}); } };
      try {
        if (options.includes('asyncBlocking')) callback(details, reply);
        else reply(callback(details));
      } catch { reply({ cancel: true }); }
    };
    authListeners.set(callback, wrapped); proxyAuth.addListener(wrapped);
    nativeAuth?.addListener(callback, filter, options);
  },
  removeListener(callback) { const wrapped = authListeners.get(callback); if (wrapped) proxyAuth.removeListener(wrapped); authListeners.delete(callback); nativeAuth?.removeListener(callback); },
  hasListener(callback) { return authListeners.has(callback); }, hasListeners() { return authListeners.size > 0; }
};
chrome.windows.remove = setdownInvoke('windows.remove');
for (const action of [chrome.action, chrome.browserAction]) if (action) for (const name of ['enable', 'disable', 'getUserSettings']) action[name] = setdownInvoke('browserAction.' + name);
`;
