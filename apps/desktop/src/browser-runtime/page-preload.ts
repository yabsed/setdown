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
// Sticky protection for this document, including inputs inside shadow roots.
// Website scripts cannot clear the main-process flag or access this IPC bridge.
let memoryEdited = false;
const protectMemory = (event: Event) => {
  if (!event.isTrusted || memoryEdited) return;
  memoryEdited = true; ipcRenderer.send('browser:memory-edited');
};
for (const type of ['beforeinput', 'input', 'change', 'submit']) window.addEventListener(type, protectMemory, true);
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

// Saved passwords. This isolated script only notices login forms and fills the
// one login the user picked in the shell. It never receives the list of saved
// logins, and main takes the site from this frame, not from anything sent here.
// Nothing is filled on load: a script injected into the page then finds no
// password waiting in a field the user has not asked to fill.
type LoginFields = { username: HTMLInputElement | null; password: HTMLInputElement };
const USER_HINTS = ['user', 'name', 'mail', 'login', 'auth', 'identifier', 'account', 'acct'];
const NOT_USER = ['confirm', 'filename', 'search', 'captcha', 'otp', 'code'];
const shown = (input: HTMLInputElement) => !input.disabled && input.getClientRects().length > 0;
const hinted = (input: HTMLInputElement, words: string[]) => ['name', 'id', 'autocomplete', 'placeholder', 'aria-label', 'formcontrolname'].some(name => {
  const value = input.getAttribute(name)?.toLowerCase();
  return !!value && words.some(word => value.includes(word));
});
const passwordInputs = (scope: ParentNode) => [...scope.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(shown);
function loginFields(near?: Element | null): LoginFields | null {
  const form = near?.closest('form');
  const scope: ParentNode = form && passwordInputs(form).length ? form : document;
  const passwords = passwordInputs(scope);
  if (!passwords.length) return null;
  const password = near instanceof HTMLInputElement && passwords.includes(near) ? near : passwords[0];
  const before = [...scope.querySelectorAll<HTMLInputElement>('input')].filter(input => ['text', 'email', 'tel'].includes(input.type)
    && shown(input) && !hinted(input, NOT_USER) && !!(input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING));
  const username = before.find(input => /username|email/.test(input.autocomplete)) ?? [...before].reverse().find(input => hinted(input, USER_HINTS)) ?? before.at(-1)
    // A two-step sign-in keeps the name from its first step in a hidden field.
    ?? scope.querySelector<HTMLInputElement>('input[autocomplete="username"], input[type="email"]');
  return { username, password };
}
let focusedLogin: LoginFields | null = null, formReported = 0, lastSubmit = '';
const reportForm = () => {
  if (Date.now() - formReported < 500) return;
  formReported = Date.now(); ipcRenderer.send('browser:password-form');
};
function reportSubmit(near: Element | null) {
  const fields = loginFields(near);
  if (!fields) return;
  const filled = passwordInputs(fields.password.form ?? document).filter(input => input.value);
  if (!filled.length) return;
  // Sign-up and change-password forms: the new password, not the current one.
  const chosen = filled.find(input => input.autocomplete === 'new-password')
    ?? (filled.length > 1 && filled[0].value !== filled[1].value ? filled[1] : filled[0]);
  const login = { username: fields.username?.value ?? '', password: chosen.value };
  const key = JSON.stringify(login);
  if (key === lastSubmit) return;
  lastSubmit = key; setTimeout(() => { if (lastSubmit === key) lastSubmit = ''; }, 2000);
  ipcRenderer.send('browser:password-submit', login);
}
window.addEventListener('focusin', event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const fields = loginFields(target);
  if (!fields || (target !== fields.password && target !== fields.username)) return;
  focusedLogin = fields; reportForm();
}, true);
const scanForLogin = () => { if (loginFields()) reportForm(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanForLogin, { once: true });
else scanForLogin();
window.addEventListener('load', scanForLogin, { once: true });
window.addEventListener('submit', event => { if (event.isTrusted && event.target instanceof Element) reportSubmit(event.target); }, true);
window.addEventListener('click', event => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement | HTMLInputElement>('button, input[type="submit"]');
  // "Show password" toggles are type=button; only a submitting control ends a login.
  if (button && button.type === 'submit' && !button.disabled) reportSubmit(button);
}, true);
window.addEventListener('keydown', event => {
  if (event.isTrusted && event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement
    && ['password', 'text', 'email', 'tel'].includes(event.target.type)) reportSubmit(event.target);
}, true);
ipcRenderer.on('browser:password-fill', (_event, login: { username: string; password: string }) => {
  const fields = focusedLogin?.password.isConnected && shown(focusedLogin.password) ? focusedLogin
    : loginFields(document.activeElement);
  if (!fields || typeof login?.password !== 'string') return;
  // Framework-controlled inputs take the value from these events, not from the property alone.
  const put = (input: HTMLInputElement, value: string) => {
    input.focus(); input.value = value;
    for (const type of ['input', 'change']) input.dispatchEvent(new Event(type, { bubbles: true }));
  };
  if (fields.username && shown(fields.username) && login.username) put(fields.username, login.username);
  put(fields.password, login.password);
});
