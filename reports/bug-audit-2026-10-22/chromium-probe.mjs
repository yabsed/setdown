import { _electron } from '@playwright/test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1') throw Error('Run with apps/desktop/scripts/with-isolated-display.sh');
const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const source = buildSync({ entryPoints: [fileURLToPath(new URL('../../apps/desktop/src/core/reading/rendered-search.ts', import.meta.url))],
  bundle: true, write: false, format: 'iife', globalName: 'AuditSearch', platform: 'browser' }).outputFiles[0].text;
const profile = await mkdtemp(path.join(os.tmpdir(), 'setdown-audit-profile-'));
const { ELECTRON_RUN_AS_NODE: _helper, ...environment } = process.env;
let application;
try {
  application = await _electron.launch({ executablePath: require('electron'), chromiumSandbox: true,
    args: [fileURLToPath(new URL('chromium-main.cjs', import.meta.url))], env: { ...environment, SETDOWN_AUDIT_PROFILE: profile }, timeout: 30_000 });
  const page = await application.firstWindow();
  await page.waitForSelector('#unicode');
  await page.addScriptTag({ content: source });
  const observed = await page.evaluate(() => ({
    unicodeMatches: AuditSearch.renderedSearchRanges(document.querySelector('#unicode'), 'x').map(range => range.toString()),
    hiddenMatches: AuditSearch.renderedSearchRanges(document.querySelector('#hidden'), 'secret').map(range => range.toString()),
    hiddenDisplay: getComputedStyle(document.querySelector('#hidden p')).display,
  }));
  const result = { environment: await application.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome })),
    cases: [
      { finding: 'F13', expected: ['x'], observed: observed.unicodeMatches, passed: JSON.stringify(observed.unicodeMatches) === '["x"]' },
      { finding: 'F25', expected: [], observed: observed.hiddenMatches, computedDisplay: observed.hiddenDisplay, passed: observed.hiddenMatches.length === 0 },
    ] };
  await writeFile(new URL('chromium-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (result.cases.some(item => !item.passed)) process.exitCode = 1;
} finally { await application?.close(); await rm(profile, { recursive: true, force: true }); }
