import { expect, test, type Locator, type Page } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication, type TestApplication } from '../support/electron/electron-app';

// The commands of a tool's own extension, used by hand in the real app on a copy of a real
// project. SETDOWN_GOPLS_PATH and SETDOWN_CLANGD_PATH name installed tools (`go` is on PATH);
// SETDOWN_GO_PROJECT_PATH is a checkout of spf13/cobra, SETDOWN_C_PROJECT_PATH one of
// DaveGamble/cJSON and SETDOWN_SVELTE_PROJECT_PATH one of sveltejs/realworld with its packages
// installed. The profile is new, so nothing a person set earlier takes part; for Svelte and for
// staticcheck that means Setdown downloads the tool, as it does the first time a person uses it.

const shots = process.env.SETDOWN_TOOL_COMMAND_SHOTS;
function required(name: string): string {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) throw Error(`Set ${name} to an absolute path.`);
  return value;
}
type Opened = { application: TestApplication; page: Page; editor: Locator; root: string; project: string };
async function open(source: string, file: string, tools: Record<string, string>): Promise<Opened> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-tool-commands-'));
  const project = path.join(root, 'project'), bin = path.join(root, 'bin');
  await cp(source, project, { recursive: true });
  await mkdir(bin);
  for (const [name, program] of Object.entries(tools)) await symlink(program, path.join(bin, name));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', path.join(project, file)], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config'),
    SETDOWN_LSP_INHERIT_ENV: '1', PATH: `${bin}${path.delimiter}${env.PATH ?? ''}` } });
  const page = await application.firstWindow(); await focusApplication(application);
  const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
  await expect(editor).toBeVisible();
  return { application, page, editor, root, project };
}
async function close({ application, root }: Opened) { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
async function ready(page: Page) { await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 150_000 }); }
async function command(page: Page, editor: Locator, title: string) {
  await editor.press('F1');
  const input = page.locator('.quick-input-box input');
  await input.fill(`>${title}`);
  await expect(page.locator('.quick-input-list .monaco-list-row').first()).toContainText(title);
  await input.press('Enter');
}
/** Puts the cursor on the first line that is exactly `line`, at the start of `word`. */
async function cursor(editor: Locator, text: string, line: string, word: string) {
  const index = text.split('\n').indexOf(line);
  expect(index, `the line ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(0);
  await editor.press('Control+Home');
  for (let i = 0; i < index; i++) await editor.press('ArrowDown');
  await editor.press('Home'); await editor.press('Home');
  for (let i = 0; i < line.indexOf(word); i++) await editor.press('ArrowRight');
}
async function shot(page: Page, name: string) { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); }

test('the Go extension’s commands work on spf13/cobra: tags, an import, the Go in use and a test lens', async () => {
  test.setTimeout(420_000);
  const opened = await open(required('SETDOWN_GO_PROJECT_PATH'), 'command.go', { gopls: required('SETDOWN_GOPLS_PATH') });
  const { page, editor, project } = opened, file = path.join(project, 'command.go');
  try {
    const text = await readFile(file, 'utf8');
    await ready(page);

    // Go: Add Tags To Struct Fields. The settings of a new profile name no tags, so they are asked for.
    await cursor(editor, text, '\tUse string', 'Use');
    await command(page, editor, 'Go: Add Tags To Struct Fields');
    const tags = page.getByRole('dialog', { name: 'Add Tags To Struct Fields', exact: true });
    await expect(tags).toBeVisible({ timeout: 30_000 });
    await shot(page, 'go-tags');
    await tags.locator('input').fill('json x'); await tags.locator('input').fill('json!');
    await expect(tags.getByRole('alert')).toContainText('Tag names separated by commas');
    await tags.locator('input').fill('json'); await tags.locator('input').press('Enter');
    await expect(tags).toBeHidden();
    await expect.poll(async () => { await editor.press('Control+s'); return readFile(file, 'utf8'); }, { timeout: 30_000 }).toContain('Use string `json:"use"`');

    // Go: Add Import. The list is long, so typing narrows it.
    await command(page, editor, 'Go: Add Import');
    const packages = page.getByRole('dialog', { name: 'Go: Add Import', exact: true });
    await expect(packages.locator('.result').first()).toBeVisible({ timeout: 30_000 });
    await packages.locator('input').fill('net/http/httptest');
    await expect(packages.locator('.result')).toHaveCount(1);
    await shot(page, 'go-import');
    await packages.locator('.result .location').click();
    await expect(packages).toBeHidden();
    await expect.poll(async () => { await editor.press('Control+s'); return readFile(file, 'utf8'); }, { timeout: 30_000 }).toContain('"net/http/httptest"');

    // Go: Choose Go Environment names the Go in use and lists the ones to choose from.
    await command(page, editor, 'Go: Choose Go Environment');
    const versions = page.getByRole('dialog', { name: /^Go: Choose Go Environment \(in use: \d+\.\d+/ });
    await expect(versions.locator('.result').first()).toContainText('Locally discovered: ', { timeout: 60_000 });
    await shot(page, 'go-environment');
    await versions.getByRole('button', { name: 'Close language results' }).click();
    await expect(versions).toBeHidden();
  } finally { await close(opened); }
});

test('gopls’ run test lens starts go test in the terminal for a test of spf13/cobra', async () => {
  test.setTimeout(420_000);
  const opened = await open(required('SETDOWN_GO_PROJECT_PATH'), 'args_test.go', { gopls: required('SETDOWN_GOPLS_PATH') });
  const { page, editor, project } = opened;
  try {
    await ready(page);
    await cursor(editor, await readFile(path.join(project, 'args_test.go'), 'utf8'), 'func TestNoArgs(t *testing.T) {', 'TestNoArgs');
    // Setdown hides code lenses until a person asks for them.
    await expect(page.locator('.codelens-decoration a')).toHaveCount(0);
    await command(page, editor, 'Toggle Code Lens');
    const lens = page.locator('.codelens-decoration a:visible', { hasText: /^run test$/ }).first();
    await expect(lens).toBeVisible({ timeout: 60_000 });
    await shot(page, 'go-lens');
    await lens.click();
    const terminal = page.getByRole('region', { name: 'Terminal', exact: true });
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    const rows = page.locator('.terminal-content:not(.inactive) .xterm-rows');
    await expect(rows).toContainText('go test', { timeout: 30_000 });
    // `ok  <package>  <time>` is what go test prints for a passing run.
    await expect(rows).toContainText(/ok\s+github\.com\/spf13\/cobra/, { timeout: 240_000 });
    // The terminal is an ordinary one: its shell is still running and nothing went wrong starting it.
    await expect(terminal.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Terminal 1/ })).not.toContainText('exited');
    await shot(page, 'go-test');
  } finally { await close(opened); }
});

test('the lint tool the Go settings name is installed and run when a file of spf13/cobra is saved', async () => {
  test.setTimeout(600_000);
  const opened = await open(required('SETDOWN_GO_PROJECT_PATH'), 'command.go', { gopls: required('SETDOWN_GOPLS_PATH') });
  const { page, editor } = opened;
  try {
    await ready(page);
    // `go.lintTool` is a setting of the Go tool, written where a person writes it.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
    const management = page.getByRole('region', { name: 'Language Support', exact: true });
    await management.getByRole('button', { name: /^Advanced/ }).click();
    await management.getByRole('searchbox').fill('gopls');
    await management.locator('.server-list button').first().click();
    await management.getByText('Connection settings', { exact: true }).click();
    await management.getByText('Advanced server options (JSON)', { exact: true }).click();
    const options = management.getByLabel('Arguments, settings and initialization options');
    const current = JSON.parse(await options.inputValue() || '{}') as { settings?: Record<string, unknown> };
    await options.fill(JSON.stringify({ ...current, settings: { ...current.settings, 'go.lintTool': 'staticcheck' } }));
    await management.getByRole('button', { name: 'Apply settings', exact: true }).click();
    await shot(page, 'go-lint-settings');
    await management.getByRole('button', { name: 'Close language support' }).click();
    await ready(page);

    // A line gopls accepts and staticcheck does not (ST1005), then a save.
    await editor.press('Control+End');
    await page.keyboard.insertText('\nvar errSetdownLint = errors.New("Capitalized message.")\n');
    await editor.press('Control+s');
    await expect(page.locator('.squiggly-warning').first()).toBeVisible({ timeout: 300_000 });
    await shot(page, 'go-lint-marks');
    // staticcheck names the place where the call begins: `errors.New(`.
    await editor.press('ArrowUp'); await editor.press('Home');
    for (let i = 0; i < 'var errSetdownLint = er'.length; i++) await editor.press('ArrowRight');
    await editor.press('F1'); await page.locator('.quick-input-box input').fill('>Show or Focus Hover');
    await page.locator('.quick-input-box input').press('Enter');
    await expect(page.locator('.monaco-hover:visible')).toContainText('error strings should not be capitalized', { timeout: 30_000 });
    await shot(page, 'go-lint');
  } finally { await close(opened); }
});

test('clangd’s own requests work on DaveGamble/cJSON: the AST of a selection and the memory it uses', async () => {
  test.setTimeout(300_000);
  const opened = await open(required('SETDOWN_C_PROJECT_PATH'), 'cJSON.c', { clangd: required('SETDOWN_CLANGD_PATH') });
  const { page, editor, project } = opened;
  try {
    const text = await readFile(path.join(project, 'cJSON.c'), 'utf8');
    await ready(page);
    await cursor(editor, text, 'CJSON_PUBLIC(const char *) cJSON_GetErrorPtr(void)', 'cJSON_GetErrorPtr');
    await command(page, editor, 'clangd: Show AST');
    const tree = page.getByRole('dialog', { name: 'AST', exact: true });
    await expect(tree).toBeVisible({ timeout: 60_000 });
    await expect(tree.locator('.body')).toContainText('cJSON_GetErrorPtr');
    await shot(page, 'clangd-ast');
    await tree.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(tree).toBeHidden();
    await command(page, editor, 'clangd: Show memory usage');
    const memory = page.getByRole('dialog', { name: 'clangd memory usage', exact: true });
    await expect(memory).toBeVisible({ timeout: 60_000 });
    await expect(memory.locator('.body')).toContainText('clangd_server');
    await shot(page, 'clangd-memory');
  } finally { await close(opened); }
});

test('the Svelte extension’s commands work on sveltejs/realworld: the compiled code and the uses of a component', async () => {
  test.setTimeout(300_000);
  const opened = await open(required('SETDOWN_SVELTE_PROJECT_PATH'), 'src/lib/ArticleList/ArticlePreview.svelte', {});
  const { page, editor } = opened;
  try {
    await ready(page);
    await command(page, editor, 'Svelte: Show Compiled Code');
    const compiled = page.getByRole('dialog', { name: 'Compiled code', exact: true });
    await expect(compiled).toBeVisible({ timeout: 60_000 });
    await expect(compiled.locator('.body')).toContainText('ArticlePreview');
    await shot(page, 'svelte-compiled');
    await compiled.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(compiled).toBeHidden();
    await command(page, editor, 'Svelte: Find Component References');
    const references = page.getByRole('dialog', { name: 'Component References', exact: true });
    await expect(references.locator('.result').first()).toContainText('index.svelte', { timeout: 60_000 });
    await shot(page, 'svelte-references');
  } finally { await close(opened); }
});
