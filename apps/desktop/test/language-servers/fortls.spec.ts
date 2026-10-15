import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { electron, disposeApplication, focusApplication } from '../e2e/electron-app';

test('installed fortls connects without registration and supplies hover and completion after rescan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-fortls-'));
  const file = path.join(root, 'hello.f90');
  await writeFile(file, 'program example\n  implicit none\n  integer :: answer\n  answer = square(4)\ncontains\n  integer function square(number) result(value)\n    integer, intent(in) :: number\n    value = number * number\n  end function square\nend program example\n');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const application = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await application.firstWindow(); await focusApplication(application);
    await expect(page.locator('.editor-host')).toHaveAttribute('data-language-server', 'ready', { timeout: 30_000 });
    const editor = page.locator('.editor-surface').getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+Home'); for (let i = 0; i < 3; i++) await editor.press('ArrowDown');
    await editor.press('Home'); for (let i = 0; i < 14; i++) await editor.press('ArrowRight');
    await editor.press('F1'); await page.locator('.quick-input-box input').fill('>Show or Focus Hover');
    await page.locator('.quick-input-box input').press('Enter');
    await expect(page.locator('.monaco-hover:visible')).toContainText(/square/i, { timeout: 15_000 });
    await editor.press('Escape');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Language Support…', exact: true }).click();
    const management = page.getByRole('dialog', { name: 'Language Support' });
    await management.getByRole('searchbox').fill('fortls'); await management.locator('.server-list button').click();
    await expect(management.locator('.state')).toHaveText('Running');
    await management.getByRole('button', { name: 'Rescan installed servers' }).click();
    await expect(management.getByRole('button', { name: 'Rescan installed servers' })).toBeEnabled();
    await expect(management.locator('.state')).toHaveText('Running');
    const data = await application.evaluate(({ app }) => app.getPath('userData'));
    expect(await readFile(path.join(data, 'language-servers.json'), 'utf8').catch(() => null)).toBeNull();
    await management.getByRole('button', { name: 'Close language support' }).click();
    await editor.press('Control+Home'); for (let i = 0; i < 3; i++) await editor.press('ArrowDown');
    await editor.press('Home'); await editor.press('Shift+End'); await editor.pressSequentially('  answer = squa');
    await editor.press('Control+Space');
    await expect(page.locator('.suggest-widget.visible')).toContainText(/square/i, { timeout: 15_000 });
  } finally { await disposeApplication(application); await rm(root, { recursive: true, force: true }); }
});
