// Runs only in a native page's isolated world. Page scripts never receive a vault
// bridge. A random document token and live element references bind a fill to the
// inspected main-frame form, even across same-URL navigation or SPA replacement.
export const inspectCredentialForm = `(() => {
  delete globalThis.__setdownLogin;
  const visible = e => !e.disabled && !e.readOnly && e.getClientRects().length && getComputedStyle(e).visibility === 'visible';
  const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
  if (passwords.length !== 1) throw Error('Choose a page with one visible login password field.');
  const password = passwords[0], form = password.form;
  if (!form || password.autocomplete === 'new-password' || new URL(form.action || location.href).origin !== location.origin) throw Error('Only same-origin login forms are supported.');
  const fields = [...form.elements].filter(e => e instanceof HTMLInputElement && visible(e) && e !== password && ['text','email'].includes(e.type));
  const username = fields.find(e => e.autocomplete === 'username') || fields.at(-1);
  if (!username) throw Error('No visible username field was found.');
  const token = crypto.randomUUID();
  globalThis.__setdownLogin = { token, password, username, form, origin: location.origin };
  return { token, origin: location.origin, username: username.value.slice(0,1001), password: password.value.slice(0,10001) };
})()`;
export function fillCredentialForm(token: string, origin: string, account: { username: string; password: string }): string {
  return `(() => {
    const saved = globalThis.__setdownLogin; delete globalThis.__setdownLogin;
    const [token, origin, username, password] = ${JSON.stringify([token, origin, account.username, account.password])};
    if (!saved || saved.token !== token || location.origin !== origin || saved.origin !== origin || !saved.password.isConnected || !saved.username.isConnected || saved.password.form !== saved.form || saved.username.form !== saved.form || new URL(saved.form.action || location.href).origin !== origin || saved.password.type !== 'password' || saved.password.autocomplete === 'new-password' || saved.password.disabled || saved.password.readOnly || !saved.password.getClientRects().length || !saved.username.getClientRects().length) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [element, value] of [[saved.username, username], [saved.password, password]]) {
      if (location.origin !== origin || !element.isConnected || element.form !== saved.form || new URL(saved.form.action || location.href).origin !== origin || element.disabled || element.readOnly || !element.getClientRects().length) return false;
      set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    saved.password.focus(); return true;
  })()`;
}
