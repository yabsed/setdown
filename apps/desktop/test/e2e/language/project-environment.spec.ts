import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
const require = createRequire(import.meta.url), execute = promisify(execFile);
async function fixture(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix)), project = path.join(root, 'project'), config = path.join(root, 'config');
  await mkdir(path.join(project, '.git'), { recursive: true });
  return { root, project, config };
}
async function launch(file: string, config: string) {
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  await focusApplication(application); return application;
}

test('current-file Python environment repairs real imports, preserves unsaved text and Undo, and remains project scoped after reopening', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const { root, project, config } = await fixture('setdown-project-python-');
  const venv = path.join(project, '.venv'), file = path.join(project, 'main.py');
  await execute(process.env.SETDOWN_PYTHON_PATH || 'python3', ['-m', 'venv', '--without-pip', venv]);
  const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const site = (await execute(python, ['-c', 'import sysconfig; print(sysconfig.get_paths()["purelib"])'])).stdout.trim();
  await writeFile(path.join(site, 'setdown_environment_fixture.py'), 'value: int = 42\n');
  await writeFile(path.join(project, 'pyproject.toml'), '[project]\nname = "environment-fixture"\nversion = "0.0.0"\n');
  const source = 'from setdown_environment_fixture import value\nresult = value\n'; await writeFile(file, source);
  let application = await launch(file, config);
  try {
    let page = await application.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await expect(page.locator('.squiggly-warning')).toHaveCount(1, { timeout: 20_000 });
    await editor.press('Control+End'); await page.keyboard.insertText('unsaved_value = 73');
    // Compare the real editor's Undo boundary across reconnection; language input
    // may split a paste into more than one operation. Redo must survive as well.
    await editor.press('Control+z'); const undoText = await page.locator('.view-lines').innerText();
    expect(undoText).not.toContain('73'); await editor.press('Control+Shift+z');
    await expect(page.locator('.view-lines')).toContainText('unsaved_value = 73');
    await page.getByRole('button', { name: /Language status:/ }).click();
    const panel = page.getByRole('dialog', { name: 'Current file language support' });
    const environment = panel.getByRole('combobox', { name: 'Python environment' });
    const choice = await environment.locator('option').filter({ hasText: '.venv · Project' }).getAttribute('value');
    expect(choice).toBeTruthy(); await environment.selectOption(choice!);
    await expect(page.locator('.squiggly-warning')).toHaveCount(0, { timeout: 20_000 });
    await expect(panel).toContainText('Results received for this open file');
    await expect(panel).toContainText(python);
    await page.screenshot({ path: testInfo.outputPath('python-project-environment.png') });
    await panel.getByRole('button', { name: 'Close language status' }).click();
    await expect(page.locator('.view-lines')).toContainText('unsaved_value = 73');
    expect(await readFile(file, 'utf8')).toBe(source);
    await editor.press('Control+z'); await expect(page.locator('.view-lines')).toHaveText(undoText, { useInnerText: true });
    await editor.press('Control+Shift+z'); await expect(page.locator('.view-lines')).toContainText('unsaved_value = 73');
    const saved = JSON.parse(await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8'));
    expect(saved.projects[project].python).toBe(python); expect(errors).toEqual([]);
    await disposeApplication(application); application = await launch(file, config); page = await application.firstWindow();
    await page.getByRole('button', { name: /Language status:/ }).click();
    const reopened = page.getByRole('dialog', { name: 'Current file language support' });
    await expect(reopened).toContainText(python); await expect(reopened).toContainText('Results received for this open file', { timeout: 20_000 });
    await expect(page.locator('.squiggly-warning')).toHaveCount(0);
    const otherFile = path.join(root, 'other.py'); await writeFile(otherFile, 'value = 1\n');
    // IPC cannot change environments for a document not owned by this window.
    expect(await page.evaluate(async file => { try { await window.marktex.language.environment(file, 'python'); return 'allowed'; } catch { return 'rejected'; } }, otherFile)).toBe('rejected');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('C++ build selection changes the real clangd flags and repairs unsaved source without replacing the editor', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const { root, project, config } = await fixture('setdown-project-cpp-');
  const file = path.join(project, 'main.cpp'), includes = path.join(root, 'headers'); await mkdir(includes);
  await writeFile(path.join(includes, 'project.hpp'), 'inline int project_value() { return PROJECT_VALUE; }\n');
  const source = '#include "project.hpp"\nint main() { return project_value(); }\n'; await writeFile(file, source);
  for (const name of ['build', 'builddir']) {
    const dir = path.join(project, name); await mkdir(dir);
    await writeFile(path.join(dir, 'compile_commands.json'), JSON.stringify([{ directory: project, file,
      arguments: ['clang++', '-std=c++20', ...(name === 'builddir' ? [`-I${includes}`, '-DPROJECT_VALUE=42'] : []), '-c', file] }]));
  }
  const application = await launch(file, config);
  try {
    const page = await application.firstWindow();
    await page.getByRole('button', { name: /Language status:/ }).click();
    const panel = page.getByRole('dialog', { name: 'Current file language support' });
    await expect(panel).toContainText('Several build configurations');
    const environment = panel.getByRole('combobox', { name: 'C / C++ build configuration' });
    const wrong = await environment.locator('option').filter({ hasText: /^build ·/ }).getAttribute('value');
    await environment.selectOption(wrong!);
    await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 20_000 });
    await panel.getByRole('button', { name: 'Close language status' }).click();
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await page.keyboard.insertText('// unsaved configuration test');
    await page.getByRole('button', { name: /Language status:/ }).click();
    const right = await environment.locator('option').filter({ hasText: /^builddir ·/ }).getAttribute('value');
    await environment.selectOption(right!);
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 });
    await expect(panel).toContainText('Results received for this open file');
    await expect(page.locator('.view-lines')).toContainText('unsaved configuration test');
    await page.screenshot({ path: testInfo.outputPath('cpp-build-environment.png') });
    await panel.getByRole('button', { name: 'Close language status' }).click();
    await editor.press('Control+z'); await expect(page.locator('.view-lines')).not.toContainText('unsaved configuration test');
    expect(await readFile(file, 'utf8')).toBe(source);
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('TypeScript SDK selection and basic editing apply to this project; service restart retains current source', async ({}, testInfo) => {
  const { root, project, config } = await fixture('setdown-project-ts-');
  const file = path.join(project, 'main.ts');
  await mkdir(path.join(project, 'node_modules'), { recursive: true });
  await symlink(path.dirname(require.resolve('typescript/package.json')), path.join(project, 'node_modules/typescript'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(project, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
  await writeFile(file, 'const value: number = "wrong";\n');
  const application = await launch(file, config);
  try {
    const page = await application.firstWindow();
    await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
    await page.getByRole('button', { name: /Language status:/ }).click();
    const panel = page.getByRole('dialog', { name: 'Current file language support' }), sdk = panel.getByRole('combobox', { name: 'TypeScript SDK' });
    const projectSdk = await sdk.locator('option').filter({ hasText: 'Project TypeScript' }).getAttribute('value');
    await sdk.selectOption(projectSdk!);
    await expect(panel).toContainText(path.join(project, 'node_modules/typescript/lib/tsserver.js'));
    await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
    await panel.getByRole('button', { name: 'Restart project services' }).click();
    await expect(panel).toContainText('Results received for this open file', { timeout: 20_000 });
    await panel.getByRole('combobox', { name: 'Analysis provider' }).selectOption('off');
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Language status:/ })).toHaveAccessibleName(/Local checks/);
    await panel.getByRole('combobox', { name: 'Analysis provider' }).selectOption('typescript-language-server');
    await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
    await page.screenshot({ path: testInfo.outputPath('typescript-sdk.png') });
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('Configure project generates and selects a real CMake database only on the explicit action', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const { root, project, config } = await fixture('setdown-project-cmake-');
  const file = path.join(project, 'main.cpp');
  await writeFile(file, 'int main() { return CONFIGURED_VALUE; }\n');
  await writeFile(path.join(project, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(setdown_fixture LANGUAGES CXX)\nadd_executable(setdown_fixture main.cpp)\ntarget_compile_definitions(setdown_fixture PRIVATE CONFIGURED_VALUE=42)\n');
  const application = await launch(file, config);
  try {
    const page = await application.firstWindow();
    await page.getByRole('button', { name: /Language status:/ }).click();
    const panel = page.getByRole('dialog', { name: 'Current file language support' });
    await expect(panel).toContainText('Choose a build folder or configure this project');
    const before = await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8').catch(() => ''); expect(before).toBe('');
    await panel.getByText('Configure CMake analysis', { exact: true }).click();
    await panel.getByRole('button', { name: 'Configure project', exact: true }).click();
    await expect(panel).toContainText('Configuration output', { timeout: 30_000 });
    await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 });
    await expect(panel).toContainText('Results received for this open file');
    const preferences = JSON.parse(await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8'));
    const database = JSON.parse(await readFile(preferences.projects[project].compilation, 'utf8'));
    expect(JSON.stringify(database)).toContain('CONFIGURED_VALUE=42');
    expect(preferences.projects[project].compilation.startsWith(config)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('cmake-configuration.png') });
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('a crashed analysis process reconnects the latest unsaved buffer without replaying an editor command', async ({}, testInfo) => {
  const { root, project, config } = await fixture('setdown-project-recovery-');
  const file = path.join(project, 'main.recovery'), script = path.join(root, 'server.cjs'), log = path.join(root, 'rpc.jsonl');
  const settings = path.join(config, 'Setdown'); await mkdir(settings, { recursive: true }); await writeFile(file, 'initial\n');
  await writeFile(script, `
    const fs=require('node:fs');
    const {createMessageConnection,StreamMessageReader,StreamMessageWriter}=require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
    const log=(method,params)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({pid:process.pid,method,params})+'\\n');
    const first=!fs.existsSync(${JSON.stringify(log)}); log('start',{});
    const c=createMessageConnection(new StreamMessageReader(process.stdin),new StreamMessageWriter(process.stdout));
    c.onRequest('initialize',()=>({capabilities:{textDocumentSync:{openClose:true,change:1},hoverProvider:true}}));
    c.onNotification('textDocument/didOpen',p=>{log('open',p);c.sendNotification('textDocument/publishDiagnostics',{uri:p.textDocument.uri,version:p.textDocument.version,diagnostics:[]})});
    c.onNotification('textDocument/didChange',p=>{log('change',p);if(first&&p.contentChanges[0].text.includes('reconnect_me'))process.exit(7)});
    c.onRequest('textDocument/hover',()=>({contents:'recovered'}));
    c.onRequest('workspace/executeCommand',p=>{log('command',p);return null});
    c.onRequest('shutdown',()=>null);c.onNotification('exit',()=>process.exit(0));c.listen();
  `);
  await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1, servers: { recovery: { enabled: true } }, preferred: { recovery: 'recovery' }, custom: [{ id: 'recovery', name: 'Recovery fixture', launch: { kind: 'native', command: process.execPath, args: [script] }, languages: [{ languageId: 'recovery', monacoId: 'plaintext', extensions: ['.recovery'] }], rootMarkers: ['.git'], settings: {} }] }));
  const messages = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const application = await launch(file, config);
  try {
    const page = await application.firstWindow(), editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await expect.poll(async () => (await messages()).filter(m => m.method === 'open').length).toBe(1);
    await editor.press('Control+End'); await page.keyboard.insertText('reconnect_me');
    await expect.poll(async () => (await messages()).filter(m => m.method === 'open').length, { timeout: 15_000 }).toBe(2);
    expect((await messages()).filter(m => m.method === 'open').at(-1).params.textDocument.text).toContain('reconnect_me');
    expect((await messages()).filter(m => m.method === 'command')).toEqual([]);
    await expect(page.locator('.view-lines')).toContainText('reconnect_me');
    await editor.press('Control+z'); await expect(page.locator('.view-lines')).not.toContainText('reconnect_me');
    expect(await readFile(file, 'utf8')).toBe('initial\n');
    await page.screenshot({ path: testInfo.outputPath('recovered-editor.png') });
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});

test('repeated initialization crashes stop automatic recovery and leave an actionable explanation', async () => {
  test.setTimeout(60_000);
  const { root, project, config } = await fixture('setdown-project-crash-limit-');
  const file = path.join(project, 'main.crash'), script = path.join(root, 'server.cjs'), log = path.join(root, 'starts');
  const settings = path.join(config, 'Setdown'); await mkdir(settings, { recursive: true }); await writeFile(file, 'editable after failure\n');
  await writeFile(script, `require('node:fs').appendFileSync(${JSON.stringify(log)},'start\\n'); process.exit(7);`);
  await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1, servers: { crashing: { enabled: true } }, preferred: { crash: 'crashing' }, custom: [{ id: 'crashing', name: 'Crashing fixture', launch: { kind: 'native', command: process.execPath, args: [script] }, languages: [{ languageId: 'crash', monacoId: 'plaintext', extensions: ['.crash'] }], rootMarkers: ['.git'], settings: {} }] }));
  const application = await launch(file, config);
  try {
    const page = await application.firstWindow(); await page.getByRole('button', { name: /Language status:/ }).click();
    const panel = page.getByRole('dialog', { name: 'Current file language support' });
    await expect(panel).toContainText('Automatic recovery paused after repeated failures', { timeout: 25_000 });
    expect((await readFile(log, 'utf8')).trim().split('\n')).toHaveLength(4);
    await panel.getByRole('button', { name: 'Restart Crashing fixture', exact: true }).click();
    await expect.poll(async () => (await readFile(log, 'utf8')).trim().split('\n').length).toBe(5);
    await panel.getByRole('button', { name: 'Close language status' }).click();
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await page.keyboard.insertText('still_editable');
    await expect(page.locator('.view-lines')).toContainText('still_editable');
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});
