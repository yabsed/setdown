import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
import type { MarkTexApi } from '../../../src/protocol/desktop-api';
async function command(page: Page, title: string) {
  await page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.executeApplicationMenuItem('menu-editor-commands'));
  const dialog = page.getByRole('dialog', { name: 'Commands', exact: true }); await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox').fill(title); await dialog.getByRole('option').filter({ hasText: title }).first().click();
}
const apiText = (page: Page) => page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.getDocument().then(document => document?.text));
test('smart-search cancel restores the caret; case policy and result snapshots remain independent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-search-tools-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-search-tools-config-'));
  const file = path.join(root, 'notes.txt'), text = 'origin\n' + 'line\n'.repeat(100) + 'Needle\nneedle\nNeedle\n';
  await writeFile(file, text);
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }); await input.press('Control+Home');
    await command(page, 'Find literal text with smart case');
    let search = page.getByRole('dialog', { name: 'Smart search', exact: true }); await search.getByRole('textbox').fill('Needle');
    await search.getByRole('textbox').press('Escape'); await input.pressSequentially('@');
    await expect.poll(() => apiText(page)).toBe('@' + text); await input.press('Control+z');
    for (const query of ['Needle', 'needle']) {
      await command(page, 'Find literal text with smart case'); search = page.getByRole('dialog', { name: 'Smart search', exact: true });
      await search.getByRole('textbox').fill(query); await search.getByRole('button', { name: 'Apply', exact: true }).click();
      await command(page, 'Show current result list');
      const results = page.getByRole('dialog', { name: `Find: ${query}`, exact: true });
      await expect(results.getByRole('option')).toHaveCount(query === 'Needle' ? 2 : 3);
      await results.getByRole('searchbox').press('Escape');
    }
    await command(page, 'Previous result list');
    const original = page.getByRole('dialog', { name: 'Find: Needle', exact: true }); await expect(original.getByRole('option')).toHaveCount(2);
    await original.getByRole('searchbox').press('Escape');
    await command(page, 'Hide smart-search highlights'); await expect(page.locator('.setdown-search-highlight')).toHaveCount(0);
    await command(page, 'Next smart-search match');
    await input.pressSequentially('replaced'); await expect.poll(() => apiText(page)).toContain('replaced');
    await input.press('Control+z'); await expect.poll(() => apiText(page)).toBe(text);
    expect(await readFile(file, 'utf8')).toBe(text);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});

test('editor commands preserve Unicode targets, repeat intent, copy shape, Undo and IME ownership', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-tools-e2e-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-tools-config-'));
  const file = path.join(root, 'notes.txt'); await writeFile(file, '"한글 😄"\n009\n020\n');
  await writeFile(path.join(root, '.editorconfig'), 'root = true\n[*]\nindent_style = space\nindent_size = 3\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    const page = await app.firstWindow(); await focusApplication(app);
    const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
    const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }); await expect(input).toBeVisible();
    await input.press('Control+Home'); await input.press('ArrowRight');
    await command(page, 'Select inside quoted string'); await input.press('Delete');
    await expect.poll(() => apiText(page)).toBe('\"\"\n009\n020\n');
    await input.press('Control+z'); await expect.poll(() => apiText(page)).toBe('\"한글 😄\"\n009\n020\n');
    await command(page, 'Replace a structured target');
    await page.getByRole('dialog', { name: 'Replace target', exact: true }).getByRole('option', { name: 'quote', exact: true }).click();
    await page.getByRole('dialog', { name: 'Replacement', exact: true }).getByRole('textbox').fill('교체 😀');
    await page.getByRole('dialog', { name: 'Replacement', exact: true }).getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => apiText(page)).toBe('"교체 😀"\n009\n020\n');
    await input.press('Control+z'); await expect.poll(() => apiText(page)).toBe('"한글 😄"\n009\n020\n');
    await input.press('Control+Home'); await input.press('ArrowDown'); await input.press('Home');
    await command(page, 'Increment integer'); await expect.poll(() => apiText(page)).toBe('"한글 😄"\n010\n020\n');
    await input.press('ArrowDown'); await input.press('Home'); await command(page, 'Repeat last semantic edit');
    await expect.poll(() => apiText(page)).toBe('"한글 😄"\n010\n021\n');
    await input.press('Control+z'); await expect.poll(() => apiText(page)).toBe('"한글 😄"\n010\n020\n');
    await input.press('Control+Home'); await input.press('Home'); await input.press('Shift+End'); await input.press('Control+c');
    await input.press('Delete'); await command(page, 'Paste last explicit copy'); await expect.poll(() => apiText(page)).toBe('"한글 😄"\n010\n020\n');
    await command(page, 'Show effective settings for this file');
    const settings = page.getByRole('dialog', { name: 'Effective editor settings' }); await expect(settings).toContainText('Tab width: 3'); await expect(settings).toContainText('.editorconfig');
    await settings.getByRole('searchbox').press('Escape'); await expect(settings).not.toBeVisible();
    // A composition event must reach the editor; the application shortcut cannot steal it.
    await input.focus();
    await page.evaluate(() => { document.activeElement?.dispatchEvent(new CompositionEvent('compositionstart', { data: 'ㅎ', bubbles: true })); document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true, isComposing: true, bubbles: true })); });
    await expect(page.getByRole('dialog', { name: 'Commands', exact: true })).not.toBeVisible();
    await page.evaluate(() => document.activeElement?.dispatchEvent(new CompositionEvent('compositionend', { data: '', bubbles: true })));
    await input.press('Control+End'); await input.pressSequentially('end');
    await input.press('Control+s'); await expect.poll(() => readFile(file, 'utf8')).toBe('"한글 😄"\n010\n020\nend');
    expect(failures).toEqual([]);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});

test('explicit session restore recovers changed-disk text separately and restores independent groups', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-session-e2e-')), config = await mkdtemp(path.join(os.tmpdir(), 'setdown-session-config-'));
  const file = path.join(root, 'notes.txt'); await writeFile(file, 'saved\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  let app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: config } });
  try {
    let page = await app.firstWindow(); await focusApplication(app);
    const input = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' }); await input.press('Control+End'); await input.pressSequentially('dirty snapshot');
    await command(page, 'Split editor right'); await expect(page.locator('.editor-group')).toHaveCount(2);
    await command(page, 'Save workspace snapshot'); const save = page.getByRole('dialog', { name: 'Workspace snapshot', exact: true });
    await save.getByRole('textbox').fill('Two views'); await save.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.editorTools.snapshots.list().then(entries => entries.some(entry => entry.name === 'Two views')))).toBe(true);
    // Simulate process loss without a clean close/discard prompt.
    await expect.poll(() => page.evaluate(() => (window as unknown as { marktex: MarkTexApi }).marktex.editorTools.snapshots.list().then(entries => entries.some(entry => entry.recovery))), { timeout: 12000 }).toBe(true);
    const exited = new Promise<void>(resolve => app.process().once('exit', () => resolve())); app.process().kill('SIGKILL'); await exited;
    await writeFile(file, 'external version\n');
    app = await electron.launch({ args: ['.'], env: { ...env, XDG_CONFIG_HOME: config } }); page = await app.firstWindow(); await focusApplication(app);
    await expect(page.locator('.document-tab')).toHaveCount(0);
    await command(page, 'Restore a workspace or recovery snapshot');
    await page.getByRole('dialog', { name: 'Workspace snapshots', exact: true }).getByRole('option').filter({ hasText: 'Two views' }).click();
    await page.getByRole('dialog', { name: 'Restore snapshot into additional groups?' }).getByRole('option', { name: /^Restore/ }).click();
    const details = page.getByRole('dialog', { name: 'Snapshot restore details' }); await expect(details).toContainText('disk version changed'); await details.getByRole('searchbox').press('Escape');
    await expect(page.locator('.editor-group')).toHaveCount(2);
    await expect.poll(() => apiText(page)).toBe('saved\ndirty snapshot'); expect(await readFile(file, 'utf8')).toBe('external version\n');
    await expect(page.locator('.document-tab .tab-dirty')).toHaveCount(2);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); await rm(config, { recursive: true, force: true }); }
});
