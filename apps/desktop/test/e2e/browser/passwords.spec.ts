import { expect, test } from '@playwright/test';
import { fixture } from '../../support/browser/browser-fixture';

test('password saving fails closed without a protected Linux OS store', async () => {
  const f = await fixture(false);
  try {
    await f.app.evaluate(({ safeStorage, dialog }) => {
      safeStorage.isEncryptionAvailable = () => false;
      safeStorage.encryptString = () => { throw Error('Encryption must not run'); };
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    expect(await f.page.evaluate(() => window.marktex.browser.passwordStatus())).toEqual({ available: false, unlocked: false, accounts: [] });
    expect(await f.page.evaluate(() => window.marktex.browser.unlockPasswords().then(() => 'unexpected', error => String(error)))).toContain('unavailable');
    expect(await f.app.evaluate(({ app }) => process.getBuiltinModule('fs').existsSync(process.getBuiltinModule('path').join(app.getPath('userData'), 'passwords.v1.enc')))).toBe(false);
  } finally { await f.dispose(); }
});

test('native password actions save and fill only the chosen current HTTPS main-frame form', async () => {
  const f = await fixture(false);
  try {
    // Inject only the OS encryption boundary: real AES-GCM, Chromium documents,
    // isolated worlds, IPC, form events and production vault persistence below.
    // This does not claim the host has an unlocked OS keyring.
    await f.app.evaluate(async ({ safeStorage, dialog }) => {
      const crypto = process.getBuiltinModule('crypto'), key = crypto.randomBytes(32);
      safeStorage.isEncryptionAvailable = () => true; safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret';
      safeStorage.encryptString = text => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); };
      safeStorage.decryptString = bytes => { const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'); };
      (globalThis as any).passwordAnswers = [0];
      dialog.showMessageBox = (async (_owner, options) => {
        if (options?.detail?.includes('not-for-logs')) throw Error('Password leaked into chrome');
        return { response: (globalThis as any).passwordAnswers.shift() ?? options.cancelId, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;

    });
    await f.app.context().route('https://*.example/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Login fixture</title><form action="/login"><input name="user" autocomplete="username"><input name="password" type="password" autocomplete="current-password"><button>Sign in</button></form>' }));
    expect((await f.page.evaluate(() => window.marktex.browser.unlockPasswords())).unlocked).toBe(true);
    await f.page.evaluate(() => window.marktex.openLink('https://login.example/'));
    await expect(f.page.getByRole('tab', { name: /Login fixture/ })).toBeVisible();
    const id = (await f.page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id'))!;
    const web = f.app.windows().find(p => p.url() === 'https://login.example/')!;
    await web.locator('[name=user]').fill('reader'); await web.locator('[name=password]').fill('not-for-logs');
    await f.app.evaluate(() => { (globalThis as any).passwordAnswers = [0, 0]; });
    await f.page.evaluate(id => window.marktex.browser.pagePasswords(id), id);
    const status = await f.page.evaluate(() => window.marktex.browser.passwordStatus());
    expect(status.accounts).toHaveLength(1); expect(JSON.stringify(status)).not.toContain('not-for-logs');
    const encrypted = await f.app.evaluate(({ app }) => process.getBuiltinModule('fs').readFileSync(process.getBuiltinModule('path').join(app.getPath('userData'), 'passwords.v1.enc')).includes(Buffer.from('not-for-logs')));
    expect(encrypted).toBe(false);
    await web.locator('[name=user]').fill(''); await web.locator('[name=password]').fill('');
    await f.app.evaluate(() => { (globalThis as any).passwordAnswers = [1]; });
    await f.page.evaluate(id => window.marktex.browser.pagePasswords(id), id);
    expect(await web.locator('[name=user]').inputValue()).toBe('reader'); expect(await web.locator('[name=password]').inputValue()).toBe('not-for-logs'); expect(web.url()).toBe('https://login.example/');
    await web.locator('[name=password]').fill('declined-update'); await f.app.evaluate(() => { (globalThis as any).passwordAnswers = [0, 1]; });
    await f.page.evaluate(id => window.marktex.browser.pagePasswords(id), id);
    await web.locator('[name=password]').fill(''); await f.app.evaluate(() => { (globalThis as any).passwordAnswers = [1]; });
    await f.page.evaluate(id => window.marktex.browser.pagePasswords(id), id); expect(await web.locator('[name=password]').inputValue()).toBe('not-for-logs');
    // A chooser cannot fill a replacement document, even at the identical URL.
    for (const destination of ['https://login.example/', 'https://elsewhere.example/']) {
    await f.app.evaluate(({ dialog, webContents }, destination) => {
      dialog.showMessageBox = (async (_owner, options) => {
        if (options.message?.startsWith('Passwords for')) { await webContents.getAllWebContents().find(wc => wc.getURL() === 'https://login.example/')!.loadURL(destination); return { response: 1, checkboxChecked: false }; }
        return { response: options.cancelId, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    }, destination);
    await f.page.evaluate(id => window.marktex.browser.pagePasswords(id), id);
    await expect(web).toHaveURL(destination); expect(await web.locator('[name=password]').inputValue()).toBe('');
    }
    // Embedded login fields cannot receive a main-frame account.
    await web.evaluate(() => { document.body.innerHTML = '<iframe src="https://login.example/"></iframe>'; });
    await expect(web.frameLocator('iframe').locator('[name=password]')).toBeVisible();
    expect(await f.page.evaluate(id => window.marktex.browser.pagePasswords(id).then(() => 'unexpected', error => String(error)), id)).toContain('same-origin login form');
    expect(await web.frameLocator('iframe').locator('[name=password]').inputValue()).toBe('');
    await web.goto(`${f.origin}/first`);
    expect(await f.page.evaluate(id => window.marktex.browser.pagePasswords(id).then(() => 'unexpected', error => String(error)), id)).toContain('HTTPS');
    await f.page.evaluate(() => window.marktex.browser.lockPasswords()); expect((await f.page.evaluate(() => window.marktex.browser.passwordStatus())).accounts).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
