// Observation only: the setup of "an imported npm profile starts automatically…" in
// test/e2e/language/language-registry.spec.ts, watched for a minute instead of five seconds,
// to tell "late" from "never" and to see what the tool was sent.
import { test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../test/support/electron/electron-app';
const require = createRequire(import.meta.url);

test('watch npm profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-profile-npm-'));
  const file = path.join(root, 'main.json'), log = path.join(root, 'messages.jsonl');
  const prefix = path.join(root, 'npm-global'), folder = path.join(prefix, 'lib/node_modules/vscode-langservers-extracted');
  await mkdir(folder, { recursive: true }); await mkdir(path.join(root, 'bin'));
  await symlink(process.execPath, path.join(root, 'bin/node'));
  await writeFile(file, '{ "answer": 1 }\n');
  await writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: 'vscode-langservers-extracted', bin: { 'vscode-json-language-server': './cli.cjs' } }));
  await writeFile(path.join(folder, 'cli.cjs'), `
    const fs = require('node:fs');
    const {createMessageConnection, StreamMessageReader, StreamMessageWriter} = require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const c = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
    const log = (method, params) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({method,at:Date.now(),pid:process.pid,args:process.argv.slice(2),keys:params&&Object.keys(params)})+'\\n');
    log('spawned');
    c.onRequest('initialize', p => {log('initialize',p); return {capabilities:{textDocumentSync:{openClose:true,change:1},completionProvider:{triggerCharacters:['.']}}}});
    c.onNotification('initialized', p => log('initialized',p));
    c.onNotification('textDocument/didOpen', p => log('open',p));
    c.onNotification('textDocument/didChange', p => log('change',p));
    c.onRequest((method, p) => { log('request ' + method, p); return null; });
    c.onNotification((method, p) => log('notification ' + method, p));
    c.onRequest('textDocument/completion', () => [{label:'profileCompletion',kind:6,insertText:'profileCompletion'}]);
    c.onRequest('shutdown', () => null); c.onNotification('exit', () => process.exit(0)); c.listen();
  `);
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const started = Date.now();
  const application = await electron.launch({ args: ['.', file], env: { ...env, HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'),
    PATH: path.join(root, 'bin'), npm_config_prefix: prefix, NPM_CONFIG_PREFIX: prefix,
    CONDA_PREFIX: '', VIRTUAL_ENV: '', CARGO_HOME: path.join(root, '.cargo'), GOPATH: path.join(root, 'go'),
    GOBIN: '', PIPX_BIN_DIR: '', UV_TOOL_BIN_DIR: '', XDG_BIN_HOME: '', SETDOWN_LSP_INHERIT_ENV: '1' } });
  const note = (text: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${text}`);
  application.process().stderr?.on('data', chunk => { const text = String(chunk); if (/language|lsp|json|Error/i.test(text) && !/portal|dbus|PipeWire/i.test(text)) note('stderr: ' + text.trim().slice(0, 400)); });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') note(`console ${message.type()}: ${message.text().slice(0, 300)}`); });
    let last = '';
    for (let step = 0; step < 240; step++) {
      const value = await page.locator('.editor-host').getAttribute('data-language-server').catch(() => 'no editor');
      const status = (await page.locator('.statusbar, footer').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      const now = `${value} | ${status}`;
      if (now !== last) { note(now); last = now; }
      if (value === 'ready' && step > 8) break;
      await page.waitForTimeout(250);
    }
    note('messages: ' + (await readFile(log, 'utf8').catch(() => '(none)')).trim().split('\n').map(line => { try { const m = JSON.parse(line); return `${((m.at - started) / 1000).toFixed(1)}s ${m.method} pid=${m.pid}`; } catch { return line; } }).join(' ; '));
    // What the panel says about the document.
    await page.locator('[data-language-server]').first().click({ trial: true }).catch(() => {});
    const button = page.getByRole('button', { name: /analysis|JSON/i }).first();
    if (await button.count()) { await button.click().catch(() => {}); await page.waitForTimeout(600);
      note('panel: ' + (await page.locator('.analysis-panel, [role=dialog], .detail-block').first().innerText().catch(() => '(no panel)')).replace(/\s+/g, ' | ').slice(0, 900)); }
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});
