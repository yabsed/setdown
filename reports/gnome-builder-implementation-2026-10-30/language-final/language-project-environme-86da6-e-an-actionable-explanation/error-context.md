# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: language/project-environment.spec.ts >> repeated initialization crashes stop automatic recovery and leave an actionable explanation
- Location: test/e2e/language/project-environment.spec.ts:194:1

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('dialog', { name: 'Current file language support' }).getByRole('button', { name: 'Restart Crashing fixture', exact: true })

```

# Test source

```ts
  107 |   const { root, project, config } = await fixture('setdown-project-ts-');
  108 |   const file = path.join(project, 'main.ts');
  109 |   await mkdir(path.join(project, 'node_modules'), { recursive: true });
  110 |   await symlink(path.dirname(require.resolve('typescript/package.json')), path.join(project, 'node_modules/typescript'), process.platform === 'win32' ? 'junction' : 'dir');
  111 |   await writeFile(path.join(project, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
  112 |   await writeFile(file, 'const value: number = "wrong";\n');
  113 |   const application = await launch(file, config);
  114 |   try {
  115 |     const page = await application.firstWindow();
  116 |     await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
  117 |     await page.getByRole('button', { name: /Language status:/ }).click();
  118 |     const panel = page.getByRole('dialog', { name: 'Current file language support' }), sdk = panel.getByRole('combobox', { name: 'TypeScript SDK' });
  119 |     const projectSdk = await sdk.locator('option').filter({ hasText: 'Project TypeScript' }).getAttribute('value');
  120 |     await sdk.selectOption(projectSdk!);
  121 |     await expect(panel).toContainText(path.join(project, 'node_modules/typescript/lib/tsserver.js'));
  122 |     await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
  123 |     await panel.getByRole('button', { name: 'Restart project services' }).click();
  124 |     await expect(panel).toContainText('Results received for this open file', { timeout: 20_000 });
  125 |     await panel.getByRole('combobox', { name: 'Analysis provider' }).selectOption('off');
  126 |     await expect(page.locator('.squiggly-error')).toHaveCount(0);
  127 |     await expect(page.getByRole('button', { name: /Language status:/ })).toHaveAccessibleName(/Local checks/);
  128 |     await panel.getByRole('combobox', { name: 'Analysis provider' }).selectOption('typescript-language-server');
  129 |     await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
  130 |     await page.screenshot({ path: testInfo.outputPath('typescript-sdk.png') });
  131 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  132 | });
  133 | 
  134 | test('Configure project generates and selects a real CMake database only on the explicit action', async ({}, testInfo) => {
  135 |   test.setTimeout(90_000);
  136 |   const { root, project, config } = await fixture('setdown-project-cmake-');
  137 |   const file = path.join(project, 'main.cpp');
  138 |   await writeFile(file, 'int main() { return CONFIGURED_VALUE; }\n');
  139 |   await writeFile(path.join(project, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(setdown_fixture LANGUAGES CXX)\nadd_executable(setdown_fixture main.cpp)\ntarget_compile_definitions(setdown_fixture PRIVATE CONFIGURED_VALUE=42)\n');
  140 |   const application = await launch(file, config);
  141 |   try {
  142 |     const page = await application.firstWindow();
  143 |     await page.getByRole('button', { name: /Language status:/ }).click();
  144 |     const panel = page.getByRole('dialog', { name: 'Current file language support' });
  145 |     await expect(panel).toContainText('Choose a build folder or configure this project');
  146 |     const before = await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8').catch(() => ''); expect(before).toBe('');
  147 |     await panel.getByText('Configure CMake analysis', { exact: true }).click();
  148 |     await panel.getByRole('button', { name: 'Configure project', exact: true }).click();
  149 |     await expect(panel).toContainText('Configuration output', { timeout: 30_000 });
  150 |     await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 });
  151 |     await expect(panel).toContainText('Results received for this open file');
  152 |     const preferences = JSON.parse(await readFile(path.join(config, 'Setdown/project-analysis.json'), 'utf8'));
  153 |     const database = JSON.parse(await readFile(preferences.projects[project].compilation, 'utf8'));
  154 |     expect(JSON.stringify(database)).toContain('CONFIGURED_VALUE=42');
  155 |     expect(preferences.projects[project].compilation.startsWith(config)).toBe(true);
  156 |     await page.screenshot({ path: testInfo.outputPath('cmake-configuration.png') });
  157 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  158 | });
  159 | 
  160 | test('a crashed analysis process reconnects the latest unsaved buffer without replaying an editor command', async ({}, testInfo) => {
  161 |   const { root, project, config } = await fixture('setdown-project-recovery-');
  162 |   const file = path.join(project, 'main.recovery'), script = path.join(root, 'server.cjs'), log = path.join(root, 'rpc.jsonl');
  163 |   const settings = path.join(config, 'Setdown'); await mkdir(settings, { recursive: true }); await writeFile(file, 'initial\n');
  164 |   await writeFile(script, `
  165 |     const fs=require('node:fs');
  166 |     const {createMessageConnection,StreamMessageReader,StreamMessageWriter}=require(${JSON.stringify(require.resolve('vscode-jsonrpc/node'))});
  167 |     const log=(method,params)=>fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({pid:process.pid,method,params})+'\\n');
  168 |     const first=!fs.existsSync(${JSON.stringify(log)}); log('start',{});
  169 |     const c=createMessageConnection(new StreamMessageReader(process.stdin),new StreamMessageWriter(process.stdout));
  170 |     c.onRequest('initialize',()=>({capabilities:{textDocumentSync:{openClose:true,change:1},hoverProvider:true}}));
  171 |     c.onNotification('textDocument/didOpen',p=>{log('open',p);c.sendNotification('textDocument/publishDiagnostics',{uri:p.textDocument.uri,version:p.textDocument.version,diagnostics:[]})});
  172 |     c.onNotification('textDocument/didChange',p=>{log('change',p);if(first&&p.contentChanges[0].text.includes('reconnect_me'))process.exit(7)});
  173 |     c.onRequest('textDocument/hover',()=>({contents:'recovered'}));
  174 |     c.onRequest('workspace/executeCommand',p=>{log('command',p);return null});
  175 |     c.onRequest('shutdown',()=>null);c.onNotification('exit',()=>process.exit(0));c.listen();
  176 |   `);
  177 |   await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1, servers: { recovery: { enabled: true } }, preferred: { recovery: 'recovery' }, custom: [{ id: 'recovery', name: 'Recovery fixture', launch: { kind: 'native', command: process.execPath, args: [script] }, languages: [{ languageId: 'recovery', monacoId: 'plaintext', extensions: ['.recovery'] }], rootMarkers: ['.git'], settings: {} }] }));
  178 |   const messages = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  179 |   const application = await launch(file, config);
  180 |   try {
  181 |     const page = await application.firstWindow(), editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  182 |     await expect.poll(async () => (await messages()).filter(m => m.method === 'open').length).toBe(1);
  183 |     await editor.press('Control+End'); await page.keyboard.insertText('reconnect_me');
  184 |     await expect.poll(async () => (await messages()).filter(m => m.method === 'open').length, { timeout: 15_000 }).toBe(2);
  185 |     expect((await messages()).filter(m => m.method === 'open').at(-1).params.textDocument.text).toContain('reconnect_me');
  186 |     expect((await messages()).filter(m => m.method === 'command')).toEqual([]);
  187 |     await expect(page.locator('.view-lines')).toContainText('reconnect_me');
  188 |     await editor.press('Control+z'); await expect(page.locator('.view-lines')).not.toContainText('reconnect_me');
  189 |     expect(await readFile(file, 'utf8')).toBe('initial\n');
  190 |     await page.screenshot({ path: testInfo.outputPath('recovered-editor.png') });
  191 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  192 | });
  193 | 
  194 | test('repeated initialization crashes stop automatic recovery and leave an actionable explanation', async () => {
  195 |   test.setTimeout(60_000);
  196 |   const { root, project, config } = await fixture('setdown-project-crash-limit-');
  197 |   const file = path.join(project, 'main.crash'), script = path.join(root, 'server.cjs'), log = path.join(root, 'starts');
  198 |   const settings = path.join(config, 'Setdown'); await mkdir(settings, { recursive: true }); await writeFile(file, 'editable after failure\n');
  199 |   await writeFile(script, `require('node:fs').appendFileSync(${JSON.stringify(log)},'start\\n'); process.exit(7);`);
  200 |   await writeFile(path.join(settings, 'language-servers.json'), JSON.stringify({ version: 1, servers: { crashing: { enabled: true } }, preferred: { crash: 'crashing' }, custom: [{ id: 'crashing', name: 'Crashing fixture', launch: { kind: 'native', command: process.execPath, args: [script] }, languages: [{ languageId: 'crash', monacoId: 'plaintext', extensions: ['.crash'] }], rootMarkers: ['.git'], settings: {} }] }));
  201 |   const application = await launch(file, config);
  202 |   try {
  203 |     const page = await application.firstWindow(); await page.getByRole('button', { name: /Language status:/ }).click();
  204 |     const panel = page.getByRole('dialog', { name: 'Current file language support' });
  205 |     await expect(panel).toContainText('Automatic recovery paused after repeated failures', { timeout: 25_000 });
  206 |     expect((await readFile(log, 'utf8')).trim().split('\n')).toHaveLength(4);
> 207 |     await panel.getByRole('button', { name: 'Restart Crashing fixture', exact: true }).click();
      |                                                                                        ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  208 |     await expect.poll(async () => (await readFile(log, 'utf8')).trim().split('\n').length).toBe(5);
  209 |     await panel.getByRole('button', { name: 'Close language status' }).click();
  210 |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  211 |     await editor.press('Control+End'); await page.keyboard.insertText('still_editable');
  212 |     await expect(page.locator('.view-lines')).toContainText('still_editable');
  213 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  214 | });
  215 | 
```