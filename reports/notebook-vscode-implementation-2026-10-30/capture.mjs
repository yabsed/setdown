import { _electron, chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const out = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(out, '../..');
if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1') throw Error('An isolated display is required');
const fixture = path.join(root, 'reports/notebook-vscode-study-2026-10-30/overview.ipynb');
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
async function measure(page, selector) {
  const node = page.locator(selector).first(); await node.waitFor();
  const metrics = await node.evaluate(node => { const s = getComputedStyle(node), cell = node.closest('.cell-editor, .cell-editor-container'); return { family: s.fontFamily, size: s.fontSize, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, width: node.getBoundingClientRect().width, inset: cell ? node.getBoundingClientRect().left - cell.getBoundingClientRect().left : null }; });
  const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument'); const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  metrics.fonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
  return metrics;
}
const metrics = {};
const profile = await mkdtemp('/tmp/setdown-design-capture-');
const app = await _electron.launch({ executablePath: require('electron'), chromiumSandbox: true, cwd: path.join(root, 'apps/desktop'), args: ['.', fixture], env: { ...env, XDG_CONFIG_HOME: profile } });
try {
 const page = await app.firstWindow();
 await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 1000));
 await page.locator('.notebook-scroll:not(.preparing) .cell-markdown h1').waitFor();
 for (const theme of ['github-light', 'solarized-light', 'one-dark']) {
   await app.evaluate(({ Menu }, theme) => Menu.getApplicationMenu().getMenuItemById(`preview-theme-${theme}`).click(), theme);
   await page.mouse.move(1, 1); await page.screenshot({ path: path.join(out, `implemented-${theme}.png`) });
 }
 metrics.setdown = await measure(page, '.view-lines');
} finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close(); }
await writeFile(path.join(out, 'code-typography.json'), JSON.stringify(metrics, null, 2));
const profileVS = await mkdtemp('/tmp/setdown-vscode-design-capture-');
await mkdir(path.join(profileVS, 'User'));
await writeFile(path.join(profileVS, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'window.zoomLevel': 0, 'workbench.colorTheme': 'Solarized Light', 'editor.fontSize': 14, 'security.workspace.trust.enabled': false, 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'workbench.editorAssociations': { '*.ipynb': 'jupyter-notebook' } }));
const copied = path.join(profileVS, 'overview.ipynb'); await writeFile(copied, await readFile(fixture));
const child = spawn('/usr/share/code/code', ['--remote-debugging-port=0', '--password-store=basic', '--user-data-dir', profileVS, '--extensions-dir', path.join(profileVS, 'extensions'), '--skip-welcome', '--skip-release-notes', '--new-window', copied], { env });
const endpoint = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('VS Code launch timed out')), 30000); child.stderr.on('data', data => { const m = String(data).match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } }); child.once('exit', code => { clearTimeout(timer); reject(Error(`VS Code exited ${code}`)); }); });
const vs = await chromium.connectOverCDP(endpoint);
try { const context = vs.contexts()[0]; const page = context.pages()[0] ?? await context.waitForEvent('page'); await page.waitForSelector('.monaco-workbench'); await page.screenshot({ path: path.join(out, 'vscode-startup.png') }); await writeFile(path.join(out, 'vscode-startup.txt'), await page.locator('body').innerText()); await page.locator('.notebookOverlay .view-lines').first().waitFor(); metrics.vscode = await measure(page, '.notebookOverlay .view-lines'); await page.screenshot({ path: path.join(out, 'reference-vscode.png') }); }
finally { await vs.close(); child.kill(); }
await writeFile(path.join(out, 'code-typography.json'), JSON.stringify(metrics, null, 2));
console.log(metrics);
