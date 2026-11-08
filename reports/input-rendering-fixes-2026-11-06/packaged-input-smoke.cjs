// Run only through apps/desktop/scripts/with-isolated-display.sh.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
async function main() {
  if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1') throw Error('Isolated display required');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-packaged-input-'));
  const code = path.join(root, 'code.txt'), markdown = path.join(root, 'reader.md');
  const source = '# 패키지 테스트\n\n**90%**가 표시됩니다.\n';
  await fs.writeFile(code, 'Code input\n'.repeat(30)); await fs.writeFile(markdown, source);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ executablePath: path.resolve(process.argv[2]), chromiumSandbox: true,
    args: [code], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  let helperPid;
  try {
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
    const page = await app.firstWindow();
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => { const owner = BrowserWindow.getAllWindows()[0]; owner.show(); owner.focus(); owner.webContents.focus(); });
    for (const native of [false, true]) {
      if (native) {
        await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), markdown);
        await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
          const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.getVisible()
            && view.webContents?.getURL().startsWith('marktex-preview://'));
          return view?.webContents.executeJavaScript('document.querySelector(".markdown-preview strong")?.textContent');
        })).toBe('90%');
      }
      const id = await page.getByRole('tab', { selected: true }).getAttribute('data-tab-id');
      for (const factor of [1.2, 1 / 1.2]) {
        helperPid = await app.evaluate(({ BrowserWindow, screen }, factor) => {
          const helper = process._getActiveHandles().find(handle => handle.spawnargs?.some(arg => arg.endsWith('x11-pinch.py')));
          if (!helper?.stdout || helper.exitCode !== null || !helper.spawnargs.some(arg => arg.includes('app.asar.unpacked')))
            throw Error('Packaged XI2 helper is missing or exited');
          const bounds = BrowserWindow.getAllWindows()[0].getContentBounds();
          const point = screen.dipToScreenPoint({ x: bounds.x + 200, y: bounds.y + 210 });
          for (const [type, scale] of [['begin', 1], ['update', factor], ['end', factor]])
            helper.stdout.emit('data', Buffer.from(JSON.stringify({ type, scale, device: 2, ...point, cancelled: false }) + '\n'));
          return helper.pid;
        }, factor);
        await expect.poll(() => page.evaluate(async id => (await window.marktex.getZoom()).tabs[id], id)).toBeCloseTo(factor > 1 ? 120 : 100, 4);
      }
      expect(await page.evaluate(async () => (await window.marktex.getZoom()).app)).toBe(100);
    }
    await app.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.getVisible()
        && view.webContents?.getURL().startsWith('marktex-preview://'));
      view.webContents.sendInputEvent({ type: 'mouseDown', x: 200, y: 150, button: 'right', clickCount: 1 });
      view.webContents.sendInputEvent({ type: 'mouseUp', x: 200, y: 150, button: 'right', clickCount: 1 });
    });
    await expect.poll(() => app.windows().some(page => page.url().includes('menu-overlay=1'))).toBe(true);
    const menu = app.windows().find(page => page.url().includes('menu-overlay=1'));
    await expect(menu.locator('.context-menu')).toBeVisible();
    expect(await menu.locator('.context-menu button').first().evaluate(button => getComputedStyle(button).fontSize)).toBe('13px');
    expect(await fs.readFile(markdown, 'utf8')).toBe(source);

  } finally {
    await app.evaluate(({ app, BrowserWindow }) => {
      app.removeAllListeners('window-all-closed');
      BrowserWindow.getAllWindows().forEach(window => window.destroy());
    }).catch(() => {});
    await app.close(); await fs.rm(root, { recursive: true, force: true });
  }
  if (helperPid) await expect.poll(() => { try { process.kill(helperPid, 0); return true; } catch { return false; } }).toBe(false);
    await fs.writeFile(path.join(__dirname, 'packaged-input-result.json'), JSON.stringify({ passed: true,
      executable: process.argv[2], checks: ['packaged XI2 helper', 'shell/native forward/reverse decoded pinch',
        'unchanged app zoom', 'Korean emphasis', 'themed native reader menu', 'source preservation'],
      limitation: 'Decoded XI2 messages exercise the adapter, not a physical touchpad.' }, null, 2));
  console.log('Packaged input, Korean rendering, themed context menu and helper cleanup passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
