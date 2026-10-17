# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: language/clangd-support.spec.ts >> clangd honors compile commands and .clangd, with completion, rename, Undo and header navigation
- Location: test/e2e/language/clangd-support.spec.ts:72:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.suggest-widget.visible')
Expected substring: "greeting"
Received string:    "No suggestions.Select (DownArrow)"
Timeout: 15000ms

Call log:
  - Expect "toContainText" locator('.suggest-widget.visible') with timeout 15000ms
  - waiting for locator('.suggest-widget.visible')
    31 × locator resolved to <div monaco-visible-content-widget="true" widgetid="editor.widget.suggestWidget" class="editor-widget suggest-widget message visible">…</div>
       - unexpected value "No suggestions.Select (DownArrow)"

```

```yaml
- text: No suggestions.
```

# Test source

```ts
  4   | import path from 'node:path';
  5   | import { execFile } from 'node:child_process';
  6   | import { promisify } from 'node:util';
  7   | import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
  8   | const exec = promisify(execFile);
  9   | 
  10  | // These are real clangd tests: install clangd on PATH or set SETDOWN_CLANGD_PATH.
  11  | // A missing executable is a failure, not an untested pass.
  12  | async function expectFullyPainted(widget: Locator): Promise<void> {
  13  |   // DOM visibility alone succeeds even when an ancestor clips most of a hover.
  14  |   await expect.poll(() => widget.evaluate(node => {
  15  |     const box = node.getBoundingClientRect();
  16  |     return [box.left + 3, box.right - 3].every(x => [box.top + 3, box.bottom - 3].every(y => {
  17  |       const hit = document.elementFromPoint(x, y);
  18  |       return hit !== null && node.contains(hit);
  19  |     }));
  20  |   })).toBe(true);
  21  | }
  22  | 
  23  | test('first-line LSP hovers remain fully visible above ordinary and split editors', async ({}, testInfo) => {
  24  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-hover-'));
  25  |   const file = path.join(root, 'main.cpp'), other = path.join(root, 'other.txt');
  26  |   await writeFile(path.join(root, 'empty.hpp'), '#pragma once\n');
  27  |   await writeFile(file, '#include "empty.hpp"\nint value = 0;\n');
  28  |   await exec('git', ['init'], { cwd: root });
  29  |   await exec('git', ['add', 'main.cpp', 'empty.hpp'], { cwd: root });
  30  |   await exec('git', ['-c', 'user.name=Setdown Test', '-c', 'user.email=setdown@example.test', 'commit', '-m', 'base'], { cwd: root });
  31  |   await writeFile(file, '#include "empty.hpp"\nint value = 1;\n');
  32  |   await writeFile(other, 'A separate editor group.\n');
  33  |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  34  |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  35  |   try {
  36  |     const page = await application.firstWindow();
  37  |     await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root); await page.reload();
  38  |     await focusApplication(application);
  39  |     await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
  40  |     const include = () => page.locator('.view-line span').filter({ hasText: 'empty.hpp' }).last();
  41  |     const hover = page.locator('.monaco-resizable-hover:visible');
  42  |     await include().hover(); await expect(hover).toContainText('empty.hpp');
  43  |     await expectFullyPainted(hover);
  44  |     await page.screenshot({ path: testInfo.outputPath('ordinary-first-line-hover.png') });
  45  |     await page.mouse.move(1, 1);
  46  |     await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), other);
  47  |     await expect(page.getByRole('tab', { name: /other\.txt/ })).toHaveAttribute('aria-selected', 'true');
  48  |     const data = await page.evaluateHandle(() => new DataTransfer());
  49  |     await page.getByRole('tab', { name: /main\.cpp/ }).dispatchEvent('dragstart', { dataTransfer: data });
  50  |     const body = (await page.locator('.group-body').boundingBox())!;
  51  |     const drop = { dataTransfer: data, clientX: body.x + body.width / 2, clientY: body.y + body.height - 5 };
  52  |     await page.locator('.group-body').dispatchEvent('dragover', drop);
  53  |     await page.locator('.group-body').dispatchEvent('drop', drop);
  54  |     await data.dispose();
  55  |     await expect(page.locator('.editor-group')).toHaveCount(2);
  56  |     await include().hover(); await expect(hover).toContainText('empty.hpp');
  57  |     await expectFullyPainted(hover);
  58  |     await page.screenshot({ path: testInfo.outputPath('split-first-line-hover.png') });
  59  |     await page.mouse.move(1, 1);
  60  |     await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
  61  |     await page.getByRole('button', { name: 'Source Control', exact: true }).click();
  62  |     await page.locator('.git-change-open').filter({ hasText: 'main.cpp' }).click();
  63  |     const modified = page.locator('.modified-in-monaco-diff-editor');
  64  |     await expect(modified.locator('.view-lines')).toContainText('value = 1');
  65  |     await modified.locator('.view-line span').filter({ hasText: 'empty.hpp' }).last().hover();
  66  |     await expect(hover).toContainText('empty.hpp');
  67  |     await expectFullyPainted(hover);
  68  |     await page.screenshot({ path: testInfo.outputPath('git-first-line-hover.png') });
  69  |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
  70  | });
  71  | 
  72  | test('clangd honors compile commands and .clangd, with completion, rename, Undo and header navigation', async () => {
  73  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-clangd-'));
  74  |   const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-clangd-config-'));
  75  |   await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'include'));
  76  |   const file = path.join(root, 'src', 'main.cpp');
  77  |   const helper = path.join(root, 'include', 'helper.hpp');
  78  |   await writeFile(helper, '#pragma once\ninline int helper(int value) { return value + BUILD_VALUE + CONFIG_VALUE; }\n');
  79  |   await writeFile(path.join(root, '.clangd'), 'CompileFlags:\n  Add: [-DCONFIG_VALUE=9]\n');
  80  |   await writeFile(path.join(root, '.clang-format'), 'BasedOnStyle: LLVM\nIndentWidth: 4\n');
  81  |   await writeFile(path.join(root, 'compile_commands.json'), JSON.stringify([{
  82  |     directory: root, file, arguments: ['clang++', '-std=c++20', '-Iinclude', '-DBUILD_VALUE=7', '-c', file],
  83  |   }]));
  84  |   const original = '#include "helper.hpp"\nint greeting(int value) { return helper(value); }\nint main() {\n  int count = "wrong";\n  return greeting(3);\n}\n';
  85  |   await writeFile(file, original);
  86  |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  87  |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  88  |   try {
  89  |     const page = await application.firstWindow();
  90  |     await focusApplication(application);
  91  |     await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
  92  |     await expect(page.locator('.squiggly-error')).toHaveCount(1, { timeout: 20_000 });
  93  |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  94  |     // Repair the error in the unsaved model; clangd clears versioned diagnostics.
  95  |     // Use ordinary editing, without reaching into Monaco or replacing its model.
  96  |     await editor.press('Control+Home');
  97  |     await editor.press('ArrowDown'); await editor.press('ArrowDown'); await editor.press('ArrowDown');
  98  |     await editor.press('Home'); await editor.press('Shift+End');
  99  |     await editor.pressSequentially('  int count = 4;');
  100 |     await expect(page.locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 });
  101 |     // Manual completion is supplied by clangd, including its function snippet.
  102 |     await editor.press('Control+End');
  103 |     await editor.pressSequentially('greet'); await editor.press('Control+Space');
> 104 |     await expect(page.locator('.suggest-widget.visible')).toContainText('greeting', { timeout: 15_000 });
      |                                                           ^ Error: expect(locator).toContainText(expected) failed
  105 |     await editor.press('Escape');
  106 |     await editor.press('Home'); await editor.press('Shift+End'); await editor.press('Backspace');
  107 |     // Rename the definition and call, then undo both edits in the same document.
  108 |     await editor.press('Control+Home'); await editor.press('ArrowDown'); await editor.press('Home');
  109 |     for (let index = 0; index < 5; index++) await editor.press('ArrowRight');
  110 |     await editor.press('F2');
  111 |     const rename = page.locator('.rename-input');
  112 |     await expect(rename).toBeVisible(); await rename.fill('welcome'); await rename.press('Enter');
  113 |     await expect(rename).not.toBeVisible();
  114 |     await editor.press('Control+s');
  115 |     await expect.poll(() => readFile(file, 'utf8')).toContain('int welcome(');
  116 |     expect(await readFile(file, 'utf8')).toContain('return welcome(3)');
  117 |     await editor.press('Control+z'); await editor.press('Control+s');
  118 |     await expect.poll(() => readFile(file, 'utf8')).toContain('int greeting(');
  119 |     expect(await readFile(file, 'utf8')).not.toContain('welcome');
  120 |     // Real clangd formatting uses project style and remains one ordinary Undo step.
  121 |     const beforeFormat = await readFile(file, 'utf8');
  122 |     await editor.press('F1'); await page.locator('.quick-input-box input').fill('>Format Document');
  123 |     await page.locator('.quick-input-box input').press('Enter');
  124 |     await expect(page.locator('.monaco-editor .view-lines')).toContainText('    int count = 4;');
  125 |     // String matchers normalize indentation, and count already has four spaces.
  126 |     // Wait for a line whose indentation actually changes before saving.
  127 |     await expect(page.locator('.monaco-editor .view-line').filter({ hasText: 'return greeting(3);' }))
  128 |       .toHaveText(/^\s{4}return\s+greeting\(3\);$/);
  129 |     await editor.press('Control+s');
  130 |     await expect.poll(() => readFile(file, 'utf8')).not.toBe(beforeFormat);
  131 |     await expect.poll(() => readFile(file, 'utf8')).toContain('    int count = 4;');
  132 |     await editor.press('Control+z'); await editor.press('Control+s');
  133 |     await expect.poll(() => readFile(file, 'utf8')).toBe(beforeFormat);
  134 |     // F12 crosses into the ordinary header tab and keeps the compile context.
  135 |     await editor.press('Control+Home'); await editor.press('ArrowDown'); await editor.press('Home');
  136 |     for (let index = 0; index < 35; index++) await editor.press('ArrowRight');
  137 |     await editor.press('F12');
  138 |     await expect(page.getByRole('tab', { name: /helper\.hpp/ })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  139 |     await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready');
  140 |     await expect(page.locator('.squiggly-error')).toHaveCount(0);
  141 |     expect(await readFile(helper, 'utf8')).toContain('BUILD_VALUE + CONFIG_VALUE');
  142 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  143 | });
  144 | 
  145 | test('missing clangd keeps C editable and a native executable selection repairs language support', async () => {
  146 |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-clangd-select-'));
  147 |   const config = await mkdtemp(path.join(os.tmpdir(), 'setdown-clangd-select-config-'));
  148 |   const file = path.join(root, 'main.c');
  149 |   await writeFile(file, 'int main(void) { return unknown_value; }\n');
  150 |   const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  151 |   const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config,
  152 |     SETDOWN_CLANGD_PATH: path.join(root, 'missing-clangd') } });
  153 |   try {
  154 |     const page = await application.firstWindow(); await focusApplication(application);
  155 |     await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'failed', { timeout: 20_000 });
  156 |     await expect(page.locator('.editor-host [role="status"]')).toHaveCount(0);
  157 |     const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  158 |     await editor.press('Control+End'); await editor.pressSequentially('// still editable');
  159 |     await editor.press('Control+s');
  160 |     await expect.poll(() => readFile(file, 'utf8')).toContain('// still editable');
  161 |     // Stub only the OS chooser's answer. Production IPC persists the path,
  162 |     // restarts the server and synchronizes the actual open buffer.
  163 |     const { execFileSync } = await import('node:child_process');
  164 |     const executable = process.env.SETDOWN_CLANGD_PATH || execFileSync(process.platform === 'win32' ? 'where' : 'which', ['clangd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
  165 |     await application.evaluate(({ dialog }, executable) => {
  166 |       dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [executable] })) as typeof dialog.showOpenDialog;
  167 |     }, executable);
  168 |     await editor.press('F1'); await page.locator('.quick-input-box input').fill('>Language Support');
  169 |     await expect(page.locator('.quick-input-widget')).toContainText('Language Support');
  170 |     await page.locator('.quick-input-box input').press('Enter');
  171 |     await expect(page.locator('.quick-input-widget')).toBeHidden();
  172 |     const management = page.getByRole('region', { name: 'Language Support', exact: true });
  173 |     await expect(management).toBeVisible();
  174 |     await management.getByRole('searchbox').fill('clangd');
  175 |     await management.locator('.server-list button').click();
  176 |     await management.getByRole('button', { name: 'Choose executable…', exact: true }).click();
  177 |     await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
  178 |     await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 15_000 });
  179 |     await page.getByRole('button', { name: 'Close language support' }).click();
  180 |     const settingsPath = path.join(await application.evaluate(({ app }) => app.getPath('userData')), 'language-servers.json');
  181 |     expect(JSON.parse(await readFile(settingsPath, 'utf8')).servers.clangd.executable).toBe(executable);
  182 |     await editor.press('F1'); await page.locator('.quick-input-box input').fill('>Restart Language Servers');
  183 |     await expect(page.locator('.quick-input-widget')).toContainText('Restart Language Servers');
  184 |     await page.locator('.quick-input-box input').press('Enter');
  185 |     await expect(page.locator('.quick-input-widget')).toBeHidden();
  186 |     await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 25_000 });
  187 |     await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 15_000 });
  188 |   } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
  189 | });
  190 | 
```