import { ipcRenderer, webFrame } from 'electron';
import { installWheelZoom } from '../preload/wheel-zoom';

// Websites can share CSS with their Electron apps (e.g. ChatGPT's desktop
// navigation). In Setdown's frameless window, app-region: drag swallows native
// pointer input. Only the shell owns window dragging, never a web tab's frame.
// USER !important also overrides authored inline/important draggable regions.
webFrame.insertCSS('*, *::before, *::after { -webkit-app-region: no-drag !important; }', { cssOrigin: 'user' });

// Capture trusted wheel input in every isolated frame, including fine trackpad
// deltas that Chromium's native zoom request omits. No API reaches page scripts.
installWheelZoom(steps => ipcRenderer.send('browser:wheel-zoom', steps), true);

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
