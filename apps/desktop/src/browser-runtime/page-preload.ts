import { ipcRenderer, webFrame } from 'electron';

// Runs in each page's isolated, sandboxed frame. No API is exposed to page JS.
// uBO's user-origin styles must target the sender's frame and be removable.
// Electron 38's RemoveInsertedCSS omits Blink's user-origin argument, so it
// cannot remove a user stylesheet. Scope each sheet to a removable root token.
// @scope preserves selector specificity and USER !important precedence. Reuse
// inactive sheets instead of accumulating copies when uBO toggles cosmetics.
// Remove this adapter when Electron supports removing user-origin sheets.
const styles = new Map<string, string>();
let sequence = 0;
let queue = Promise.resolve();
ipcRenderer.on('browser:css', (_event, request: { id: string; code: string; remove: boolean }) => {
  queue = queue.catch(() => {}).then(async () => {
    try {
      if (!document.documentElement) await new Promise<void>(resolve => {
        const observer = new MutationObserver(() => {
          if (document.documentElement) { observer.disconnect(); resolve(); }
        });
        observer.observe(document, { childList: true });
      });
      let attribute = styles.get(request.code);
      if (request.remove) {
        if (attribute) document.documentElement.removeAttribute(attribute);
      } else {
        if (!attribute) {
          attribute = `data-setdown-ubo-${++sequence}`;
          webFrame.insertCSS(`@scope (:root[${attribute}]) {\n${request.code}\n}`, { cssOrigin: 'user' });
          styles.set(request.code, attribute);
        }
        document.documentElement.setAttribute(attribute, '');
      }
      ipcRenderer.send('browser:css-result', request.id, null);
    } catch (error) { ipcRenderer.send('browser:css-result', request.id, String(error)); }
  });
});
