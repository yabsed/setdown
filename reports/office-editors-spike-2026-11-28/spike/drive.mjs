// Drives the bare Electron window with Playwright. Run only through Setdown's isolated-display wrapper.
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = process.env.SETDOWN_REPO;
if (!repo) throw Error('SETDOWN_REPO must name the repository whose Electron and Playwright are used.');
if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1') throw Error('Run this through apps/desktop/scripts/with-isolated-display.sh.');
const require = createRequire(path.join(repo, 'apps/desktop/package.json'));
const { _electron } = require('@playwright/test');

export async function launch(kind, extraEnv = {}) {
  const config = await mkdtemp(path.join(os.tmpdir(), 'editor-spike-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(here, 'main.cjs'), path.join(here, 'dist', `${kind}.html`)], env: { ...env, XDG_CONFIG_HOME: config, ...extraEnv } });
  const page = await app.firstWindow();
  const messages = [];
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') messages.push(`${message.type()}: ${message.text().slice(0, 300)}`); });
  page.on('requestfailed', request => messages.push(`request failed: ${request.url().slice(-80)} ${request.failure()?.errorText ?? ''}`));
  await page.waitForFunction(() => !!window.spike, null, { timeout: 30000 });
  return { app, page, messages, async open(file, options) { const bytes = await readFile(file); return page.evaluate(([data, extra]) => window.spike.open(data, extra), [bytes.toString('base64'), options ?? {}]); },
    async close() { await app.close().catch(() => {}); await rm(config, { recursive: true, force: true }); } };
}
