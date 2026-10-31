const { _electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '../..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-arxiv-'));
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  const app = await _electron.launch({ executablePath: require(path.join(root, 'apps/desktop/node_modules/electron')),
    chromiumSandbox: true, args: [path.join(root, 'apps/desktop')], env: { ...env, XDG_CONFIG_HOME: profile } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Open Web Page', exact: true })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(1440, 1000); win.show(); win.focus(); });
    await page.evaluate(() => window.marktex.browser.extensions());
    await page.getByRole('button', { name: 'Open Web Page', exact: true }).click();
    const address = page.getByRole('textbox', { name: 'Address or file path', exact: true });
    await address.fill('https://arxiv.org/pdf/2607.17067'); await address.press('Enter');
    const pdf = page.getByRole('region', { name: 'PDF reader', exact: true });
    await expect(pdf).toHaveAttribute('data-pdf-pages', '16', { timeout: 120000 });
    await expect(pdf.locator('.page[data-page-number="1"] .textLayer')).toContainText('Who Will Become the Next Senior');
    await pdf.getByRole('button', { name: 'Fit width', exact: true }).click();
    await expect(pdf.locator('.page[data-page-number="1"] canvas')).toBeVisible();
    await page.screenshot({ path: path.join(__dirname, 'arxiv-setdown.png') });
    const mime = await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === 'https://arxiv.org/pdf/2607.17067');
      return wc.executeJavaScriptInIsolatedWorld(991, [{ code: 'JSON.stringify({mime:document.contentType, embed:document.querySelector("embed")?.type})' }]);
    });
    const result = { mime, url: await address.inputValue(), pages: await pdf.getAttribute('data-pdf-pages'),
      zoom: await page.getByRole('button', { name: 'Reset website zoom', exact: true }).innerText(),
      title: await page.title(), text: (await pdf.locator('.page[data-page-number="1"] .textLayer').innerText()).slice(0, 200) };
    await fs.writeFile(path.join(__dirname, 'arxiv-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(__dirname, 'arxiv-failure.png') });
    console.error(await page.locator('body').innerText());
    throw error;
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
    await app.close().catch(() => {}); await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
