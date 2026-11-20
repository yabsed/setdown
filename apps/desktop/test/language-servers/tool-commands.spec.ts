import { expect, test, type Locator, type Page } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication, type TestApplication } from '../support/electron/electron-app';
import { commandList, hereMenu, hereRows, runCommand } from '../support/editor/commands';

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
  // The code's own editor: an answer a tool gives opens as a document beside it, with an editor of its own.
  const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }).first();
  await expect(editor).toBeVisible();
  return { application, page, editor, root, project };
}
async function close({ application, root }: Opened) { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
async function ready(page: Page) { await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 150_000 }); }
const command = runCommand;
/** Puts the cursor on the first line that is exactly `line`, at the start of `word`. */
async function cursor(editor: Locator, text: string, line: string, word: string) {
  const index = text.split('\n').indexOf(line);
  expect(index, `the line ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(0);
  await editor.press('Control+Home');
  for (let i = 0; i < index; i++) await editor.press('ArrowDown');
  await editor.press('Home'); await editor.press('Home');
  for (let i = 0; i < line.indexOf(word); i++) await editor.press('ArrowRight');
}
/** The code's own editor again, once an answer that opened beside it has the keyboard: a person
 * clicks into the code. */
async function backToCode(page: Page): Promise<Locator> {
  const group = page.locator('.editor-group').first(), box = (await group.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(group).toHaveClass(/focused/);
  const code = page.locator('.group-monaco-instance [aria-label="Editor content"]:focus');
  await expect(code).toHaveCount(1);
  return code;
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

    // Go: Choose Go Environment opens the row behind the language name, in the one form every
    // choice of an environment has: the Go in use first and marked, then the ones to choose from.
    await command(page, editor, 'Go: Choose Go Environment');
    const panel = page.getByRole('dialog', { name: 'Current file language support' });
    const versions = panel.getByRole('radiogroup', { name: 'Go', exact: true });
    await expect(versions.getByRole('radio', { checked: true }).locator('strong')).toHaveText(/^\d+\.\d+/, { timeout: 60_000 });
    await expect(versions.getByRole('radio', { checked: true })).toHaveCount(1);
    await expect(versions.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true');
    await shot(page, 'go-environment');
    await panel.getByRole('button', { name: 'Back to code support' }).click();
    // The same row is in the summary, beside the other things this file's analysis is based on.
    await expect(panel.getByRole('button', { name: /^Go\b/ }).locator('strong')).toHaveText(/^\d+\.\d+/);
    await panel.getByRole('button', { name: 'Close language status' }).click();
  } finally { await close(opened); }
});

test('on spf13/cobra the status, the menu at the cursor and the command list say only what gopls said', async () => {
  test.setTimeout(420_000);
  const opened = await open(required('SETDOWN_GO_PROJECT_PATH'), 'command.go', { gopls: required('SETDOWN_GOPLS_PATH') });
  const { page, editor, project } = opened;
  const groups = ['Understand', 'Find', 'Change', 'Run', 'Edit'], tool = /gopls|rust-analyzer|clangd|^(Go|Svelte|Java|Kotlin|JSON|YAML|Intelephense): /i;
  const menu = hereMenu(page);
  /** Opens the menu with the keyboard and gives its rows, checked for what holds on every menu. */
  const openMenu = async () => {
    await editor.press('Shift+F10');
    await expect(menu).toBeVisible({ timeout: 30_000 });
    // A slow answer fills in once; after that the menu no longer changes.
    await expect(menu.getByRole('status')).toHaveCount(0, { timeout: 30_000 });
    const rows = await hereRows(page);
    // The groups are the same for every language and stand in one order; no entry names a tool
    // or says that it does not apply here.
    const named = rows.map(row => row.group).filter(Boolean);
    expect(named.every(group => groups.includes(group))).toBe(true);
    expect(named).toEqual([...named].sort((a, b) => groups.indexOf(a) - groups.indexOf(b)));
    expect(new Set(named).size).toBe(named.length);
    for (const row of rows) { expect(row.label).not.toMatch(tool); expect(row.label).not.toMatch(/not available|unavailable/i); }
    return rows;
  };
  try {
    const text = await readFile(path.join(project, 'command.go'), 'utf8');
    await ready(page);
    // At rest the location bar names the language and nothing else: gopls answers and reports nothing missing.
    const status = page.getByRole('button', { name: /^Language status:/ });
    await expect(status).toHaveAccessibleName('Language status: Go', { timeout: 60_000 });
    await expect(status.locator('.indicator')).toHaveCount(0);
    // Setdown shows no code lenses unless a person asks; what they offer is in the menu instead.
    await expect(page.locator('.codelens-decoration a')).toHaveCount(0);

    // On a use of a type: where it is defined, where it is used, and renaming it.
    await cursor(editor, text, 'func (c *Command) Context() context.Context {', 'Command');
    const onType = await openMenu();
    await shot(page, 'here-type');
    expect(onType.map(row => row.label)).toEqual(expect.arrayContaining(['Go to Definition', 'References', 'Rename']));
    expect(onType.find(row => row.label === 'Go to Definition')?.group).toBe('Understand');
    expect(onType.find(row => row.label === 'References')?.group).toBe('Find');
    expect(onType.find(row => row.label === 'Rename')?.group).toBe('Change');
    // Typing narrows the menu, and Enter does the first entry that is left.
    await page.keyboard.type('defin');
    await expect(menu.getByRole('option')).toHaveCount(onType.filter(row => /defin/i.test(row.label)).length);
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    // The editor went to the type's definition, far above. There the menu no longer offers to go
    // to it: the tool's answer for this place is the place itself.
    await expect(page.locator('.group-monaco-instance .view-lines').first()).toContainText('type Command struct {', { timeout: 30_000 });
    const onDefinition = await openMenu();
    expect(onDefinition.map(row => row.label)).not.toContain('Go to Definition');
    expect(onDefinition.map(row => row.label)).toEqual(expect.arrayContaining(['References', 'Rename']));
    await page.keyboard.press('Escape'); await expect(menu).toBeHidden();

    // On a word of a comment the tool has nothing to say, so the menu has no language entry at all.
    await editor.press('Control+Home');
    await cursor(editor, text, '// Command is just that, a command for your application.', 'application');
    const onComment = await openMenu();
    await shot(page, 'here-comment');
    expect(onComment.map(row => row.group).filter(Boolean)).toEqual(['Edit']);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden(); await expect(editor).toBeFocused();

    // The command list, before anything is typed: what was used lately and what applies here. No
    // line begins with a tool's name; those are found by typing it. On the comment nothing was
    // used that applies, so there is only what concerns the file.
    const list = commandList(page);
    const emptyList = async () => {
      await editor.press('F1');
      await expect(list.locator('.editor-tool-section').first()).toBeVisible();
      const sections = await list.locator('.editor-tool-section').allTextContents(), offered = await list.locator('.editor-tool-row > span').allTextContents();
      expect(sections.filter(section => !['Recently used', 'Here'].includes(section))).toEqual([]);
      expect(offered.length).toBeGreaterThan(0);
      for (const line of offered) expect(line).not.toMatch(tool);
      return { sections, offered };
    };
    const onCommentList = await emptyList();
    expect(onCommentList.sections).toEqual(['Here']); expect(onCommentList.offered).not.toContain('Go to Definition');
    await list.getByRole('searchbox').press('Escape'); await expect(list).toBeHidden();
    // Back on the use of the type, going to its definition a moment ago leads the list as used lately.
    await cursor(editor, text, 'func (c *Command) Context() context.Context {', 'Command');
    const { sections, offered } = await emptyList();
    expect(sections).toEqual(['Recently used', 'Here']); expect(offered[0]).toBe('Go to Definition');
    await shot(page, 'commands-empty');
    await list.getByRole('searchbox').fill('Go: ');
    await expect(list.getByRole('option').filter({ hasText: 'Go: Add Import' })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(list).toBeHidden();
  } finally { await close(opened); }
});

test('what gopls offers as a lens above a test is an entry of the menu inside that test, and runs it', async () => {
  test.setTimeout(420_000);
  const opened = await open(required('SETDOWN_GO_PROJECT_PATH'), 'args_test.go', { gopls: required('SETDOWN_GOPLS_PATH') });
  const { page, editor, project } = opened;
  try {
    await ready(page);
    const text = await readFile(path.join(project, 'args_test.go'), 'utf8');
    await cursor(editor, text, 'func TestNoArgs(t *testing.T) {', 'TestNoArgs');
    // Inside the function, a line below its name: the lens of the function still applies.
    await editor.press('ArrowDown');
    await expect(page.locator('.codelens-decoration a')).toHaveCount(0);
    await editor.press('Shift+F10');
    const menu = hereMenu(page);
    await expect(menu).toBeVisible({ timeout: 30_000 });
    const run = menu.getByRole('option').filter({ has: page.locator('.label', { hasText: /^Run test$/ }) });
    await expect(run).toBeVisible({ timeout: 30_000 });
    expect((await hereRows(page)).find(row => row.label === 'Run test')?.group).toBe('Run');
    await shot(page, 'here-run-test');
    await run.click();
    await expect(menu).toBeHidden();
    const terminal = page.getByRole('region', { name: 'Terminal', exact: true });
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    const rows = page.locator('.terminal-content:not(.inactive) .xterm-rows');
    await expect(rows).toContainText('go test', { timeout: 30_000 });
    await expect(rows).toContainText(/ok\s+github\.com\/spf13\/cobra/, { timeout: 240_000 });
    await expect(terminal.getByRole('alert')).toHaveCount(0);
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
    await runCommand(page, editor, 'Show or Focus Hover');
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
    // What clangd wrote for reading opens as a document beside the code, like any file: nothing floats over it.
    await command(page, editor, 'clangd: Show AST');
    const tree = page.getByRole('tab', { name: /^AST\.txt/ });
    await expect(tree).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
    await expect(page.locator('.editor-group')).toHaveCount(2);
    // The editors of the two groups; the answer's is the one whose text is the tree.
    const shown = (text: RegExp) => page.locator('.group-monaco-instance').filter({ has: page.locator('.view-lines').filter({ hasText: text }) });
    const answer = shown(/Function\s+cJSON_GetErrorPtr\s+\[\d+:\d+\]/);
    await expect(answer).toHaveCount(1);
    await expect(page.locator('.editor-group').first().getByRole('tab', { name: /^cJSON\.c/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('dialog', { name: 'AST', exact: true })).toHaveCount(0);
    // The keyboard went with the answer, into the group that is now the active one. It is clangd's
    // answer, not a file to edit: what is typed there changes neither it nor the code beside it.
    await expect(page.locator('.editor-group').nth(1)).toHaveClass(/focused/);
    await expect(answer.locator('[aria-label="Editor content"]:focus')).toHaveCount(1);
    const before = await answer.locator('.view-lines').innerText();
    await page.keyboard.type('edited');
    await expect(page.locator('.monaco-editor-overlaymessage')).toContainText('Cannot edit in read-only editor');
    expect(await answer.locator('.view-lines').innerText()).toBe(before);
    expect(await page.locator('.group-monaco-instance .view-lines').allInnerTexts()).not.toEqual(expect.arrayContaining([expect.stringContaining('edited')]));
    await expect(page.getByRole('tab', { name: /^cJSON\.c/ })).not.toContainText('●');
    await expect(tree).not.toContainText('●');
    await shot(page, 'clangd-ast');
    await command(page, await backToCode(page), 'clangd: Show memory usage');
    const memory = page.getByRole('tab', { name: /^clangd memory usage\.txt/ });
    await expect(memory).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
    await expect(shown(/clangd_server\s+[\d.]+\s[KMG]?B/)).toHaveCount(1);
    await expect(page.locator('.editor-group')).toHaveCount(2);
    await expect(page.getByRole('dialog', { name: 'clangd memory usage', exact: true })).toHaveCount(0);
    await shot(page, 'clangd-memory');
  } finally { await close(opened); }
});

test('the Svelte extension’s commands work on sveltejs/realworld: the compiled code and the uses of a component', async () => {
  test.setTimeout(300_000);
  const opened = await open(required('SETDOWN_SVELTE_PROJECT_PATH'), 'src/lib/ArticleList/ArticlePreview.svelte', {});
  const { page, editor } = opened;
  try {
    await ready(page);
    // The compiled code is a document beside the component, coloured as the JavaScript it is.
    await command(page, editor, 'Svelte: Show Compiled Code');
    const compiled = page.getByRole('tab', { name: /^Compiled code\.js/ });
    await expect(compiled).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
    await expect(page.locator('.editor-group')).toHaveCount(2);
    await expect(page.locator('.group-monaco-instance').filter({ has: page.locator('.view-lines').filter({ hasText: /from\s+['"]svelte\/internal/ }) })).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: 'Compiled code', exact: true })).toHaveCount(0);
    await shot(page, 'svelte-compiled');
    await command(page, await backToCode(page), 'Svelte: Find Component References');
    const references = page.getByRole('dialog', { name: 'Component References', exact: true });
    await expect(references.locator('.result').first()).toContainText('index.svelte', { timeout: 60_000 });
    await shot(page, 'svelte-references');
  } finally { await close(opened); }
});
