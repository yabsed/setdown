import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { previews } from './preview-view';
import { disposeApplication } from './electron-app';

test('integrated PTY edits Markdown beside the reader and preserves hidden sessions', async () => {
  test.skip(process.platform === 'win32', 'Commands in this scenario use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-'));
  const file = path.join(root, 'terminal.md');
  await writeFile(file, '# Before terminal\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, SHELL: '/bin/bash',
    XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    const reader = previews(app);
    await expect.poll(reader.hasVisible).toBe(true);
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-toggle-folder-tools'));
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Integrated terminal' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('tab', { name: 'bash', exact: true })).toBeVisible();
    const input = () => panel.locator('.terminal-instance:not([hidden]) .xterm-helper-textarea');
    const run = async (command: string) => { await input().pressSequentially(command); await input().press('Enter'); };
    // Real interactive PTY, with cwd inherited from the open document.
    await run('pwd > cwd.txt; tty > tty.txt; printf "# From terminal\\n" > terminal.md');
    await expect.poll(() => readFile(path.join(root, 'cwd.txt'), 'utf8').catch(() => '')).toBe(root + '\n');
    await expect.poll(() => readFile(path.join(root, 'tty.txt'), 'utf8').catch(() => '')).toMatch(/\/dev\/(pts\/|ttys)/);
    await expect.poll(() => reader.evaluate('document.body.innerText')).toContain('From terminal');
    const bounds = await reader.visibleBounds();
    const panelBounds = await panel.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(panelBounds!.y + 1);

    await run('export SETDOWN_SESSION=still-here');
    await page.getByRole('button', { name: 'Hide Terminal' }).click();
    await expect(panel).toBeHidden();
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await run('printf "%s" "$SETDOWN_SESSION" > session.txt');
    await expect.poll(() => readFile(path.join(root, 'session.txt'), 'utf8').catch(() => '')).toBe('still-here');

    await page.locator('.mode-toggle').evaluate((button: HTMLButtonElement) => button.click());
    const editor = page.getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+A');
    await editor.pressSequentially('# Edited in Setdown');
    await editor.press('Control+S');
    await expect.poll(() => readFile(file, 'utf8')).toBe('# Edited in Setdown');
    await input().focus();
    await input().press('Escape');
    await expect(page.locator('.editor-surface')).toBeVisible();
    await run('sleep 30');
    await input().press('Control+C');
    await run('printf interrupted > interrupt.txt');
    await expect.poll(() => readFile(path.join(root, 'interrupt.txt'), 'utf8').catch(() => '')).toBe('interrupted');
    await input().press('Control+Backquote');
    await expect(panel).toBeHidden();
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();

    const previousHeight = (await panel.boundingBox())!.height;
    await page.getByRole('button', { name: 'Resize Terminal' }).press('ArrowUp');
    expect((await panel.boundingBox())!.height).toBeGreaterThan(previousHeight);
    await page.getByRole('button', { name: 'New Terminal', exact: true }).click();
    await expect(panel.getByRole('tab')).toHaveCount(2);
    await expect(panel.getByRole('tab', { name: 'bash', exact: true })).toHaveCount(2);
    await run('exit 7');
    await expect(panel.getByRole('tab', { name: 'bash (exited)', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Kill Terminal' }).click();
    await expect(panel.getByRole('tab')).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('terminal.png') });
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('terminal opens without a document, uses the project directory and cleans up on reload', async () => {
  test.skip(process.platform === 'win32', 'Process checks in this scenario use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-lifecycle-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, SHELL: '/bin/bash',
    XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'New Document', exact: true })).toBeVisible();
    await page.evaluate((folder) => window.marktex.restoreProjectFolder(folder), root);
    await page.keyboard.press('Control+Backquote');
    const panel = page.getByRole('region', { name: 'Integrated terminal' });
    await expect(panel.getByRole('tab', { name: 'bash', exact: true })).toBeVisible();
    const input = panel.locator('.xterm-helper-textarea');
    await input.pressSequentially('printf "%s" "$$" > shell-pid.txt; pwd > project-cwd.txt');
    await input.press('Enter');
    await expect.poll(() => readFile(path.join(root, 'project-cwd.txt'), 'utf8').catch(() => '')).toBe(root + '\n');
    const pid = Number(await readFile(path.join(root, 'shell-pid.txt'), 'utf8'));
    expect(pid).toBeGreaterThan(0);
    await page.reload();
    await expect(panel).toHaveCount(0);
    await expect.poll(() => {
      try { process.kill(pid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    }).toBe(true);
    await page.keyboard.press('Control+Backquote');
    await expect(panel.getByRole('tab', { name: 'bash', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Kill Terminal' }).click();
    await expect(panel.getByRole('tab')).toHaveCount(0);
    await page.getByRole('button', { name: 'New Terminal', exact: true }).click();
    await expect(panel.getByRole('tab', { name: 'bash', exact: true })).toBeVisible();
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
