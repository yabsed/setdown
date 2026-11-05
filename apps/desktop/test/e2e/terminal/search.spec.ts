import { expect, test } from '@playwright/test';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { dragTerminal } from '../../support/terminal/terminal-drag';

for (const mode of ['mouse', 'arrows'] as const)
test(`full-screen ${mode} scrolling preserves wheel distance and app search keys`, async () => {
  test.skip(process.platform === 'win32', 'Commands use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-wheel-'));
  const file = path.join(root, 'notes.txt'); await writeFile(file, 'Terminal wheel\n');
  await copyFile(path.join(process.cwd(), 'test/fixtures/terminal-wheel.cjs'), path.join(root, 'wheel.cjs'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app); const page = await app.firstWindow();
    await page.locator('.new-terminal-tab-button').click();
    const surface = page.locator('.terminal-surface'), input = surface.locator('.xterm-helper-textarea');
    await input.pressSequentially(`node wheel.cjs ${mode}`); await input.press('Enter');
    await expect(surface.locator('.xterm-rows')).toContainText('TUI_READY');
    const box = (await surface.locator('.xterm-rows').boundingBox())!;
    await page.mouse.move(box.x + 50, box.y + 50);
    const read = () => readFile(path.join(root, 'input.bin'), 'utf8').catch(() => '');
    const reports = async () => (await read()).match(mode === 'mouse' ? /\x1b\[<6[45];\d+;\d+M/g : /\x1b\[[AB]/g) ?? [];
    await page.mouse.wheel(0, -120);
    await expect.poll(async () => (await reports()).length).toBe(3);
    expect((await reports()).every(value => mode === 'mouse' ? value.startsWith('\x1b[<64;') : value === '\x1b[A')).toBe(true);
    await page.mouse.wheel(0, 240);
    await expect.poll(async () => (await reports()).length).toBe(9);
    expect((await reports()).slice(3).every(value => mode === 'mouse' ? value.startsWith('\x1b[<65;') : value === '\x1b[B')).toBe(true);
    // Four small touchpad events add up to one report, not four whole lines.
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -10);
    await expect.poll(async () => (await reports()).length).toBe(10);
    const font = () => surface.locator('.xterm-rows').evaluate(el => getComputedStyle(el).fontSize);
    const originalFont = await font(), beforeZoom = await read();
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
    await expect.poll(font).not.toBe(originalFont); expect(await read()).toBe(beforeZoom);
    await page.getByRole('button', { name: 'Reset terminal zoom', exact: true }).click();
    await expect.poll(font).toBe(originalFont);
    await input.focus();
    const beforeFind = await read();
    await input.press('Control+f'); await expect.poll(read).toBe(beforeFind + '\x06');
    const beforePanel = await read();
    await input.press('Control+Shift+f');
    const find = surface.getByRole('textbox', { name: 'Find in terminal' });
    await expect(find).toBeFocused(); await expect(surface.getByRole('note')).toContainText('Current screen only');
    await find.fill('TUI_READY'); await expect(surface.locator('.terminal-find-count')).toHaveText('1 / 1');
    await surface.locator('summary').click(); await expect(surface.getByRole('note')).toContainText('codex --no-alt-screen');
    await expect(surface.locator('.xterm-scrollable-element > .scrollbar.vertical')).toHaveCSS('opacity', '0');
    await page.screenshot({ path: test.info().outputPath(`terminal-${mode}-search.png`) });
    await find.press('Escape'); await expect(input).toBeFocused(); expect(await read()).toBe(beforePanel);
    // An app can leave its alternate screen while the find panel is open.
    await input.press('Control+Shift+f'); await expect(find).toBeFocused();
    const id = await surface.getAttribute('data-terminal-id');
    await page.evaluate(id => window.marktex.terminal.write(id!, 'q'), id);
    await expect(surface.locator('.xterm-rows')).not.toContainText('TUI_READY');
    await expect(surface.getByRole('note')).toHaveCount(0);
    await expect(surface.locator('.terminal-find-count')).toHaveText('0 / 0');
    await find.press('Escape'); await input.press('Control+f'); await expect(find).toBeFocused();
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

for (const scenario of ['wheel', 'scrollbar', 'history', 'clear-screen'] as const)
test(`terminal ${scenario} keeps earlier output reachable`, async () => {
  test.skip(process.platform === 'win32', 'Commands use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-history-'));
  const file = path.join(root, 'notes.txt'); await writeFile(file, 'Terminal history\n');
  const output = ['EARLY_OUTPUT_MARKER', ...Array.from({ length: 6000 }, (_, i) => `history-line-${i.toString().padStart(5, '0')}`),
    'BEFORE_CLEAR_MARKER', ...(scenario === 'clear-screen' ? ['\x1b[H\x1b[2J'] : []), 'OUTPUT_READY'].join('\n') + '\n';
  await writeFile(path.join(root, 'output.txt'), output);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app); const page = await app.firstWindow();
    await page.locator('.new-terminal-tab-button').click();
    const surface = page.locator('.terminal-surface'), input = surface.locator('.xterm-helper-textarea');
    await input.pressSequentially('cat output.txt'); await input.press('Enter');
    const rows = surface.locator('.xterm-rows'); await expect(rows).toContainText('OUTPUT_READY');
    if (scenario === 'wheel') {
      const topLine = async () => Number((await rows.innerText()).match(/history-line-(\d+)/)?.[1]);
      const start = await topLine(); expect(Number.isFinite(start)).toBe(true);
      const cellHeight = await rows.locator(':scope > div').first().evaluate(el => el.getBoundingClientRect().height);
      const box = (await rows.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -120);
      await expect.poll(async () => (start - await topLine()) * cellHeight).toBeGreaterThanOrEqual(100);
      expect((start - await topLine()) * cellHeight).toBeLessThanOrEqual(200);
      await page.mouse.wheel(0, 120); await expect.poll(topLine).toBe(start);
    } else if (scenario === 'scrollbar') {
      const bar = surface.locator('.xterm-scrollable-element > .scrollbar.vertical');
      const box = (await rows.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.move(1, 1);
      // xterm's auto-hide delay (500ms) plus opacity fade (800ms).
      await page.waitForTimeout(1400);
      await expect(bar).toHaveCSS('opacity', '1');
      await expect(bar).toHaveCSS('pointer-events', 'auto');
      const track = (await bar.boundingBox())!, thumb = (await bar.locator('.slider').boundingBox())!;
      expect(track.width).toBeGreaterThanOrEqual(10);
      expect(thumb.height).toBeLessThan(track.height);
      await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
      await page.mouse.down(); await page.mouse.move(thumb.x + thumb.width / 2, track.y, { steps: 10 }); await page.mouse.up();
      await expect(rows).toContainText('EARLY_OUTPUT_MARKER');
      await page.screenshot({ path: test.info().outputPath('terminal-history-scrollbar.png') });
    } else {
      const marker = scenario === 'history' ? 'EARLY_OUTPUT_MARKER' : 'BEFORE_CLEAR_MARKER';
      await expect(rows).not.toContainText(marker);
      await input.press('Control+f');
      const find = surface.getByRole('textbox', { name: 'Find in terminal' });
      await find.fill(marker); await expect(surface.locator('.terminal-find-count')).toHaveText('1 / 1');
      await expect(rows).toContainText(marker);
      await find.press('Escape'); await expect(input).toBeFocused();
    }
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

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
