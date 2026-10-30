import { ipcRenderer, webFrame } from 'electron';
import './page-theme';
import { installWheelZoom } from '../preload/wheel-zoom';

// Websites can share CSS with their Electron apps (e.g. ChatGPT's desktop
// navigation). In Setdown's frameless window, app-region: drag swallows native
// pointer input. Only the shell owns window dragging, never a web tab's frame.
// USER !important also overrides authored inline/important draggable regions.
const excludeWindowDrag = (frame = webFrame) => {
  frame.insertCSS('*, *::before, *::after { -webkit-app-region: no-drag !important; }', { cssOrigin: 'user' });
};
excludeWindowDrag();
// The live ancestor can address a committed same-process child even when that
// child's provisional document discarded its early preload stylesheet/listener.
// This remains a USER-origin sheet; no privileged API enters website JS.
ipcRenderer.on('browser:child-frame-policy', (_event, token: string) => {
  const frame = webFrame.findFrameByToken(token);
  if (frame) excludeWindowDrag(frame);
});
// Commit the policy through the owning native frame after document creation.
// A provisional child-frame document may discard an early inserted stylesheet.
let removeWheel: (() => void) | undefined;
ipcRenderer.on('browser:frame-policy', (_event, committed: boolean) => {
  excludeWindowDrag();
  // Register against the committed frame's Window, after native ownership is
  // established. An early provisional Window can lose its event listeners.
  if (!removeWheel || committed) {
    removeWheel?.();
    removeWheel = installWheelZoom(steps => ipcRenderer.send('browser:wheel-zoom', steps), true);
  }
});
const frameReady = () => {
  // Install against the committed child document as well as acknowledging it.
  // Its provisional document can discard the first sheet before a native reply.
  excludeWindowDrag();
  ipcRenderer.send('browser:frame-ready');
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', frameReady, { once: true });
else frameReady();
window.addEventListener('load', frameReady, { once: true });
window.addEventListener('pageshow', frameReady);

// Let composition, editable controls and page-owned UI consume Escape first.
// A microtask after dispatch would run before all native listeners on some
// Chromium versions; a timer observes the completed DOM event instead.
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing || !event.isTrusted) return;
  const target = event.composedPath()[0];
  if (document.fullscreenElement || document.pointerLockElement || document.querySelector('dialog[open], :popover-open')
    || (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="combobox"], [role="dialog"]')))) return;
  setTimeout(() => { if (!event.defaultPrevented) ipcRenderer.send('browser:escape'); }, 0);
}, true);

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
