import { app, dialog, powerMonitor, safeStorage, type BrowserWindow, type WebContents } from 'electron';
import path from 'node:path';
import { CredentialVault, credentialOrigin } from './credential-vault';
import { fillCredentialForm, inspectCredentialForm } from './credential-form';
import type { WindowIpc } from '../ipc/window-ipc';
import type { CredentialStatus } from '../../core/browser/credentials';

type Target = { contents: WebContents; document: number; owner: number; view: { getVisible(): boolean } };
export class BrowserPasswords {
  // Electron 44's synchronous provider exposes a verifiable Linux backend. Its
  // asynchronous fallback has no equivalent provider-security signal. Do not
  // switch to that provider based on isAsyncEncryptionAvailable alone.
  private vault = new CredentialVault(path.join(app.getPath('userData'), 'passwords.v1.enc'), {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend())),
    encrypt: text => safeStorage.encryptString(text), decrypt: bytes => safeStorage.decryptString(bytes),
  });
  private busy = false;
  private lockEpoch = 0;
  private readonly lock = () => { this.lockEpoch++; this.vault.lock(); };
  constructor(private owned: (owner: number, id: string) => Target) {}
  register(channels: WindowIpc) {
    powerMonitor.on('lock-screen', this.lock); powerMonitor.on('suspend', this.lock);
    channels.handle('browser:password-status', (): Promise<CredentialStatus> => this.vault.status());
    channels.handle('browser:password-lock', this.lock);
    channels.handle('browser:password-unlock', async state => {
      const epoch = this.lockEpoch;
      const answer = await dialog.showMessageBox(state.window, { type: 'question', message: 'Allow saved password use for 10 minutes?',
        detail: 'Passwords are protected by your OS account. This app lock does not replace OS sign-in. Filling and saving always require your choice. Screen lock or sleep disables password use.', buttons: ['Allow', 'Cancel'], cancelId: 1, defaultId: 1 });
      if (answer.response === 0 && !state.window.isDestroyed() && epoch === this.lockEpoch) await this.vault.unlock();
      return this.vault.status();
    });
    channels.handle('browser:password-delete', async (state, id: string) => {
      const account = (await this.vault.status()).accounts.find(item => item.id === id);
      if (!account) return;
      const answer = await dialog.showMessageBox(state.window, { type: 'question', message: 'Delete saved password?', detail: `${account.origin}\n${account.username}`, buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1 });
      if (answer.response === 0 && !state.window.isDestroyed()) await this.vault.remove(id);
    });
    channels.handle('browser:password-page', async (state, id: string) => {
      if (this.busy) throw Error('Another password action is in progress.');
      this.busy = true;
      try { await this.page(state.window, state.webContentsId, id); }
      finally { this.busy = false; }
    });
  }
  private async page(window: BrowserWindow, owner: number, id: string) {
    const status = await this.vault.status();
    if (!status.available) throw Error('A protected OS password store is unavailable. Passwords will not be saved.');
    if (!status.unlocked) throw Error('Unlock password use in Browser → Passwords first.');
    const epoch = this.lockEpoch;
    const target = this.owned(owner, id), wc = target.contents, revision = target.document, frame = wc.mainFrame;
    const origin = credentialOrigin(wc.getURL());
    const valid = () => {
      try { return epoch === this.lockEpoch && !window.isDestroyed() && this.owned(owner, id) === target && !wc.isDestroyed() && target.document === revision && target.owner === owner && target.view.getVisible() && wc.mainFrame === frame && credentialOrigin(wc.getURL()) === origin && this.vault.unlocked; }
      catch { return false; }
    };
    if (!valid()) throw Error('Select a visible HTTPS login page first.');
    let form: { token: string; origin: string; username: string; password: string };
    try { form = await wc.executeJavaScriptInIsolatedWorld(992, [{ code: inspectCredentialForm }]); }
    catch { throw Error('This page needs one visible password and username in a same-origin login form. Embedded and change-password forms are not supported yet.'); }
    try {
    if (!valid() || form.origin !== origin) return;
    const accounts = status.accounts.filter(item => item.origin === origin).slice(0, 20);
    const existing = status.accounts.some(item => item.origin === origin && item.username === form.username);
    const answer = await dialog.showMessageBox(window, { type: 'question', message: `Passwords for ${origin}`, detail: 'Choose an account to fill, or save the login currently entered on this page. Nothing is submitted automatically.',
      buttons: [existing ? 'Update entered password' : 'Save entered password', ...accounts.map(item => `Fill: ${item.username || '(no username)'}`), 'Cancel'], defaultId: accounts.length + 1, cancelId: accounts.length + 1 });
    if (!valid()) return;
    if (answer.response === 0) {
      if (!form.password) throw Error('Enter the password on the page before saving.');
      const confirmation = await dialog.showMessageBox(window, { type: 'question', message: existing ? 'Replace the saved password?' : 'Save this password?', detail: `${origin}\nAccount: ${form.username || '(no username)'}`, buttons: ['Save', 'Cancel'], cancelId: 1, defaultId: 1 });
      if (confirmation.response === 0 && valid()) await this.vault.save(origin, form.username, form.password);
    } else {
      const account = accounts[answer.response - 1]; if (!account) return;
      const secret = await this.vault.secret(account.id, origin);
      if (!valid()) return;
      let filled = false;
      try { filled = await wc.executeJavaScriptInIsolatedWorld(992, [{ code: fillCredentialForm(form.token, origin, secret) }]); }
      catch { /* Never forward an evaluated source/secret in an error. */ }
      if (!filled) throw Error('The login form changed. Choose the account again on the current page.');
    }
    } finally {
      if (!wc.isDestroyed() && target.document === revision) await wc.executeJavaScriptInIsolatedWorld(992, [{ code: `if (globalThis.__setdownLogin?.token === ${JSON.stringify(form.token)}) delete globalThis.__setdownLogin;` }]).catch(() => {});
    }
  }
  dispose() { this.lock(); powerMonitor.removeListener('lock-screen', this.lock); powerMonitor.removeListener('suspend', this.lock); }
}
