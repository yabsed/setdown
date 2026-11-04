import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { dragTerminal } from '../../support/terminal/terminal-drag';

test('terminal find searches scrollback, wrapped and Korean text without writing or resizing the PTY', async () => {
  test.skip(process.platform === 'win32', 'Commands use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-search-'));
  const file = path.join(root, 'notes.md'); await writeFile(file, '# Notes\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app); const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
    await page.locator('.new-terminal-tab-button').click();
    const tab = page.getByRole('tab', { name: /^Terminal 1/ });
    await dragTerminal(page, tab, page.locator('.group-body'), 'right');
    const surface = page.locator('.terminal-surface'), input = surface.locator('.xterm-helper-textarea');
    const run = async (command: string) => { await input.pressSequentially(command); await input.press('Enter'); };
    await run('stty size > size.txt; printf %s $$ > pid.txt');
    await expect.poll(() => readFile(path.join(root, 'size.txt'), 'utf8').catch(() => '')).toMatch(/^\d+ \d+/);
    const size = await readFile(path.join(root, 'size.txt'), 'utf8'), cols = Number(size.trim().split(' ')[1]);
    const pid = await readFile(path.join(root, 'pid.txt'), 'utf8');
    await writeFile(path.join(root, 'output.txt'), ['needle first', ...Array.from({ length: 100 }, (_, i) => `line ${i}`),
      'needle second', 'needle third', '검색어 첫째', '검색어 둘째', 'x'.repeat(cols - 3) + 'boundary', 'OUTPUT_READY'].join('\n') + '\n');
    await run('cat output.txt');
    await expect(surface.locator('.xterm-rows')).toContainText('OUTPUT_READY');
    const grid = await surface.locator('.terminal-instance').boundingBox();
    await input.press('Control+f');
    const find = surface.getByRole('textbox', { name: 'Find in terminal' }), count = surface.locator('.terminal-find-count');
    await expect(find).toBeFocused(); await find.fill('needle');
    await expect(count).toHaveText('1 / 3');
    expect(await surface.locator('.terminal-instance').boundingBox()).toEqual(grid);
    await expect(surface.locator('.xterm-rows')).toContainText('needle first');
    await find.press('Enter'); await expect(count).toHaveText('2 / 3');
    await surface.getByRole('button', { name: 'Next match', exact: true }).click(); await expect(count).toHaveText('3 / 3');
    await find.press('Enter'); await expect(count).toHaveText('1 / 3');
    await find.press('Shift+Enter'); await expect(count).toHaveText('3 / 3');
    await surface.getByRole('button', { name: 'Previous match', exact: true }).click(); await expect(count).toHaveText('2 / 3');
    await find.fill('boundary'); await expect(count).toHaveText('1 / 1');
    // Pinned addon-search renders active matches with its configured outline.
    await expect.poll(() => surface.locator('.xterm-find-result-decoration').evaluateAll(elements =>
      elements.some(el => getComputedStyle(el).outlineColor === 'rgb(224, 108, 0)'))).toBe(true);
    await find.fill('not-present'); await expect(count).toHaveText('0 / 0');
    await find.dispatchEvent('compositionstart'); await find.fill('검색어');
    await find.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
    await expect(find).toBeVisible(); await expect(count).toHaveText('0 / 0');
    await find.dispatchEvent('compositionend', { data: '검색어' }); await expect(count).toHaveText('1 / 2');
    await page.screenshot({ path: test.info().outputPath('terminal-find-split.png') });
    await find.press('Escape'); await expect(find).toHaveCount(0); await expect(input).toBeFocused();
    await expect(surface.locator('.xterm-find-result-decoration')).toHaveCount(0);
    await run('printf %s $$ > pid-after.txt; stty size > size-after.txt');
    await expect.poll(() => readFile(path.join(root, 'pid-after.txt'), 'utf8').catch(() => '')).toBe(pid);
    await expect.poll(() => readFile(path.join(root, 'size-after.txt'), 'utf8').catch(() => '')).toBe(size);
    await input.press('Control+Shift+f'); await expect(find).toBeFocused();
    await find.fill('needle'); await expect(count).toHaveText('1 / 3');
    // Output continues while search owns the keyboard, and refreshes its count.
    const id = await surface.getAttribute('data-terminal-id');
    await page.evaluate(id => window.marktex.terminal.write(id!, 'cat output.txt\r'), id);
    await expect(count).toHaveText(/\/ 6$/);
    await surface.getByRole('button', { name: 'Close terminal search' }).click(); await expect(input).toBeFocused();
    await expect(surface.getByRole('button', { name: 'Find in terminal', exact: true })).toHaveCount(0);
    await input.press('Control+f'); await expect(find).toBeFocused();
    const bounds = (await surface.boundingBox())!, panel = (await surface.locator('.terminal-find').boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(bounds.x); expect(panel.x + panel.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(errors).toEqual([]);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
