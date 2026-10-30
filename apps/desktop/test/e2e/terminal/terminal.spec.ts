import { electron } from '../../support/electron/electron-app';
import { expect, test, type Locator } from '@playwright/test';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { previews } from '../../support/preview/preview-view';
import { disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { THEME_IDS } from '../../../src/core/theme/theme-catalog';
import { terminalTheme } from '../../../src/core/theme/terminal-theme';
import { dragTerminal } from '../../support/terminal/terminal-drag';

const run = async (input: Locator, command: string) => { await input.pressSequentially(command); await input.press('Enter'); };
const input = (page: import('@playwright/test').Page) => page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');

for (const direction of ['right', 'down'] as const)
test(`new terminal opens in the clicked ${direction} split while the other editor is focused`, async () => {
  test.skip(process.platform === 'win32', 'Commands use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-target-group-'));
  const first = path.join(root, 'first.txt'), second = path.join(root, 'second.txt');
  await writeFile(first, 'First editor\n'); await writeFile(second, 'Second editor\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', first], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  const page = await app.firstWindow();
  try {
    await focusApplication(app);
    await expect(page.getByRole('tab', { name: /first.txt/ })).toBeVisible();
    await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), second);
    await expect(page.getByRole('tab', { name: /second.txt/ })).toHaveAttribute('aria-selected', 'true');
    await dragTerminal(page, page.getByRole('tab', { name: /second.txt/ }), page.locator('.group-body'), direction);
    await expect(page.locator('.editor-group')).toHaveCount(2);
    const source = page.locator('.editor-group').filter({ has: page.getByRole('tab', { name: /first.txt/ }) });
    const target = page.locator('.editor-group').filter({ has: page.getByRole('tab', { name: /second.txt/ }) });
    await source.getByRole('tab', { name: /first.txt/ }).click();
    await expect(source).toHaveClass(/focused/);
    await expect(target).not.toHaveClass(/focused/);

    await target.getByRole('button', { name: 'New terminal', exact: true }).click();
    await expect(target.getByRole('tab', { name: /^Terminal 1/ })).toHaveAttribute('aria-selected', 'true');
    await expect(target).toHaveClass(/focused/);
    await expect(source.locator('.tab-name')).toHaveText(['first.txt']);
    await expect(source.getByRole('tab', { name: /first.txt/ })).toHaveAttribute('aria-selected', 'true');
    await expect(source.locator('.view-lines')).toContainText('First editor');
    await expect(input(page)).toBeFocused();
    await run(input(page), 'printf target-group > terminal-target.txt');
    await expect.poll(() => readFile(path.join(root, 'terminal-target.txt'), 'utf8').catch(() => '')).toBe('target-group');
  } finally {
    await page.screenshot({ path: test.info().outputPath('terminal-target-group.png') }).catch(() => {});
    await disposeApplication(app); await rm(root, { recursive: true, force: true });
  }
});

test('canceling quit and reloading a document retain the PTY and external file watcher', async () => {
  test.skip(process.platform === 'win32', 'Commands use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-quit-reload-'));
  const file = path.join(root, 'quit.md'); await writeFile(file, '# Original\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app); const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Switch to Editor' }).click();
    const editor = page.getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+End'); await editor.pressSequentially('unsaved');
    await page.locator('.new-terminal-tab-button').click();
    await run(input(page), 'export SETDOWN_QUIT_MARKER=preserved-session');
    await app.evaluate(({ app }) => app.quit());
    const close = page.locator('dialog[aria-labelledby="close-prompt-title"]');
    await expect(close).toBeVisible(); await close.locator('.close-cancel').click();
    await run(input(page), 'printf "%s" "$SETDOWN_QUIT_MARKER" > after-quit.txt');
    await expect.poll(() => readFile(path.join(root, 'after-quit.txt'), 'utf8').catch(() => '')).toBe('preserved-session');
    await writeFile(file, '# External after cancel\n');
    await page.getByRole('tab', { name: /quit.md/ }).click();
    await expect(page.locator('.notice:not([hidden])')).toContainText('changed by another application');
    const shellId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id);
    await page.getByRole('button', { name: 'Reload file', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reload from Disk' }).click();
    await expect(page.locator('.editor-surface .view-lines')).toContainText('External after cancel');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id)).toBe(shellId);
    await page.getByRole('tab', { name: /Terminal 1/ }).click();
    await run(input(page), 'printf "%s" "$SETDOWN_QUIT_MARKER" > after-reload.txt');
    await expect.poll(() => readFile(path.join(root, 'after-reload.txt'), 'utf8').catch(() => '')).toBe('preserved-session');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('horizontal resizing preserves a two-line right prompt, input and prior output', async () => {
  test.skip(process.platform === 'win32', 'Commands use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-resize-'));
  const file = path.join(root, 'resize.md'); await writeFile(file, '# Resize\n');
  await copyFile(path.join(process.cwd(), 'test/fixtures/terminal-resize.cjs'), path.join(root, 'prompt.cjs'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app); const page = await app.firstWindow();
    await page.locator('.new-terminal-tab-button').click();
    await run(input(page), 'node prompt.cjs');
    const rows = page.locator('.xterm-rows'); await expect(rows).toContainText('RESIZE-LEFT');
    await input(page).pressSequentially('typed-but-not-submitted');
    const down = Array.from({ length: 21 }, (_, i) => 1180 - i * 20), up = [...down].reverse();
    for (const widths of [down, up, down, up, down]) {
      for (const width of widths) {
        await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 700), width);
        await page.waitForTimeout(12);
      }
      await expect.poll(async () => (await rows.innerText()).split('RESIZE-LEFT').length - 1).toBe(1);
      await expect(rows).toContainText('RESIZE-RIGHT-STATUS');
      await expect(rows).toContainText('typed-but-not-submitted');
    }
    expect((await rows.innerText()).replaceAll('\n', '')).toContain('HISTORY-START-' + '0123456789'.repeat(18) + '-HISTORY-END');
    await page.screenshot({ path: test.info().outputPath('terminal-prompt-resize.png') });
    await input(page).press('Control+C');
    await expect.poll(() => readFile(path.join(root, 'typed.txt'), 'utf8').catch(() => '')).toBe('typed-but-not-submitted');
    await run(input(page), 'stty size > tty-size.txt');
    await expect.poll(() => readFile(path.join(root, 'tty-size.txt'), 'utf8').catch(() => '')).toBe(await readFile(path.join(root, 'grid.txt'), 'utf8'));
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
test('ctrl+wheel over the terminal changes terminal zoom only and refits the grid in both directions', async () => {
  test.skip(process.platform === 'win32', 'Commands use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-zoom-'));
  const file = path.join(root, 'zoom.md'); await writeFile(file, '# Zoom\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app); const page = await app.firstWindow();
    await page.locator('.new-terminal-tab-button').click();
    await run(input(page), 'stty size | cat > size-0.txt');
    await expect.poll(() => readFile(path.join(root, 'size-0.txt'), 'utf8').catch(() => '')).toMatch(/\d+ \d+/);
    const box = await page.locator('.terminal-instance').boundingBox();
    const fontOf = () => page.locator('.terminal-instance .xterm-rows').evaluate(el => getComputedStyle(el).fontSize);
    const font0 = await fontOf();
    const initial = (await readFile(path.join(root, 'size-0.txt'), 'utf8')).trim();
    await page.keyboard.down('Control');
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await expect.poll(fontOf).not.toBe(font0);
    // Terminal wheel zoom moves only the terminal factor; editor/preview text
    // size and app zoom stay at 100%.
    await expect.poll(() => page.evaluate(async () => {
      const zoom = await window.marktex.getZoom();
      return zoom.app === 100 && zoom.text === 100 && (zoom.tabs?.[document.querySelector<HTMLElement>('.document-tab[aria-selected="true"]')!.dataset.tabId!] ?? 100) > 100;
    })).toBe(true);
    let zoomed = '';
    await expect.poll(async () => {
      await run(input(page), 'stty size | cat > size-1.txt');
      zoomed = (await readFile(path.join(root, 'size-1.txt'), 'utf8').catch(() => 'missing')).trim();
      return zoomed;
    }).toMatch(/^\d+ \d+$/);
    expect(zoomed).not.toBe(initial);
    const [rows0, cols0] = initial.split(/\s+/).map(Number), [rows1, cols1] = zoomed.split(/\s+/).map(Number);
    expect(cols1).toBeLessThan(cols0);
    expect(rows1).toBeLessThanOrEqual(rows0);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 240);
    await page.keyboard.up('Control');
    await expect.poll(fontOf).toBe(font0);
    await expect.poll(() => page.evaluate(() => window.marktex.getZoom()))
      .toMatchObject({ app: 100, text: 100, terminal: 100 });
    // The location-bar reset also leaves the other factors alone.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await expect.poll(fontOf).not.toBe(font0);
    await page.getByRole('button', { name: 'Reset terminal zoom', exact: true }).click();
    await expect.poll(fontOf).toBe(font0);
    await expect.poll(() => page.evaluate(() => window.marktex.getZoom()))
      .toMatchObject({ app: 100, text: 100, terminal: 100 });
    let reset = '';
    await expect.poll(async () => {
      await run(input(page), 'stty size | cat > size-2.txt');
      reset = (await readFile(path.join(root, 'size-2.txt'), 'utf8').catch(() => 'missing')).trim();
      return reset;
    }).toBe(initial);
    await expect(page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('100%');
    await page.getByRole('button', { name: 'Zoom terminal in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reset terminal zoom', exact: true })).toHaveText('110%');
    await expect.poll(fontOf).not.toBe(font0);
    await page.getByRole('button', { name: 'Reset terminal zoom', exact: true }).click();
    await expect.poll(fontOf).toBe(font0);
    await expect.poll(() => page.evaluate(() => window.marktex.getZoom())).toMatchObject({ app: 100, text: 100, terminal: 100 });
    await page.screenshot({ path: test.info().outputPath('terminal-wheel-zoom.png') });
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
for (const direction of ['right', 'down'] as const) test(`terminal tabs split ${direction}, preserve PTYs, and manage sessions in the sidebar`, async () => {
  test.skip(process.platform === 'win32', 'Commands use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-'));
  const file = path.join(root, 'terminal.md');
  await writeFile(file, '# Before terminal\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app);
    const page = await app.firstWindow(), reader = previews(app);
    await expect.poll(reader.hasVisible).toBe(true);
    await page.locator('.new-terminal-tab-button').click();
    const tab = page.getByRole('tab', { name: /^Terminal \d/ });
    await expect(tab).toBeVisible();
    await expect.poll(reader.hasVisible).toBe(false);
    await run(input(page), 'export SETDOWN_SESSION=still-here; pwd > cwd.txt; tty > tty.txt; printf "%s" "$$" > pid.txt');
    await expect.poll(() => readFile(path.join(root, 'cwd.txt'), 'utf8').catch(() => '')).toBe(root + '\n');
    await expect.poll(() => readFile(path.join(root, 'tty.txt'), 'utf8').catch(() => '')).toMatch(/\/dev\/(pts\/|ttys)/);
    const pid = await readFile(path.join(root, 'pid.txt'), 'utf8');
    const id = await tab.getAttribute('data-tab-id');
    await page.getByRole('tab', { name: /terminal\.md/ }).click();
    await expect(input(page)).toHaveCount(0);
    await expect.poll(reader.hasVisible).toBe(true);
    await tab.click();
    await dragTerminal(page, tab, page.locator('.group-body'), direction);
    await expect(page.locator('.editor-group')).toHaveCount(2);
    await expect.poll(reader.hasVisible).toBe(true);
    await expect(tab).toHaveAttribute('data-tab-id', id!);
    await run(input(page), 'printf "%s:%s" "$$" "$SETDOWN_SESSION" > session.txt; printf "# From terminal\\n" > terminal.md');
    await expect.poll(() => readFile(path.join(root, 'session.txt'), 'utf8').catch(() => '')).toBe(`${pid}:still-here`);
    await expect.poll(() => reader.evaluate('document.body.innerText')).toContain('From terminal');
    const terminalBox = (await page.locator('.terminal-surface').boundingBox())!, native = (await reader.visibleBounds())!;
    if (direction === 'right') expect(native.x + native.width).toBeLessThanOrEqual(terminalBox.x + 1);
    else expect(native.y + native.height).toBeLessThanOrEqual(terminalBox.y + 1);
    // Group resizing sends the new dimensions to the live PTY.
    await run(input(page), 'stty size > size-before.txt');
    await expect.poll(() => readFile(path.join(root, 'size-before.txt'), 'utf8').catch(() => '')).toMatch(/\d+ \d+/);
    const before = await readFile(path.join(root, 'size-before.txt'), 'utf8');
    await page.getByRole('button', { name: 'Resize editor groups' }).press(direction === 'right' ? 'ArrowLeft' : 'ArrowUp');
    await run(input(page), 'stty size > size-after.txt');
    await expect.poll(() => readFile(path.join(root, 'size-after.txt'), 'utf8').catch(() => before)).not.toBe(before);
    await input(page).press('Escape');
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'terminal');
    // Bash treats Escape as a pending Meta prefix. Cancel that idle readline
    // state before typing the separate foreground-interruption scenario.
    await input(page).press('Control+C');
    await expect(page.locator('.terminal-content:not(.inactive) .xterm-rows')).toContainText('^C');
    // Interrupt an actually running foreground process; Enter returning only
    // confirms input delivery and can precede the shell starting sleep.
    await run(input(page), "sh -c 'echo $$ > foreground.pid; exec sleep 30'");
    let foregroundState = { command: '', child: '', output: '' };
    try { await expect.poll(async () => {
      const child = (await readFile(path.join(root, 'foreground.pid'), 'utf8').catch(() => '')).trim();
      let command = '';
      if (/^\d+$/.test(child)) {
        try { command = execFileSync('ps', ['-p', child, '-o', 'comm='], { encoding: 'utf8' }).trim(); }
        catch { /* Include the terminal transcript if the child is not running. */ }
      }
      foregroundState = { command, child, output: await page.locator('.terminal-content:not(.inactive) .xterm-rows').innerText() };
      return foregroundState.command;
    }).toMatch(/(?:^|\/)sleep$/); } finally {
      await writeFile(test.info().outputPath('foreground-state.json'), JSON.stringify(foregroundState));
    }
    await input(page).press('Control+C');
    const foreground = Number(await readFile(path.join(root, 'foreground.pid'), 'utf8'));
    await expect.poll(() => { try { process.kill(foreground, 0); return false; } catch { return true; } }).toBe(true);
    await run(input(page), 'printf interrupted > interrupt.txt');
    await expect.poll(() => readFile(path.join(root, 'interrupt.txt'), 'utf8').catch(() => '')).toBe('interrupted');
    await input(page).press('Control+Backquote');
    const list = page.getByRole('region', { name: 'Terminal sessions' });
    await expect(list).toBeVisible();
    await expect(list.locator('.session')).toHaveCount(1);
    await list.getByRole('button', { name: 'New terminal session' }).click();
    await expect(page.getByRole('tab', { name: /^Terminal \d/ })).toHaveCount(2);
    await expect(list.locator('.session')).toHaveCount(2);
    await run(input(page), 'exit 7');
    await expect(page.getByRole('tab', { name: /Terminal 2 \(exited\)/ })).toBeVisible();
    await list.getByRole('button', { name: 'Close terminal Terminal 2', exact: true }).click();
    await expect(list.locator('.session')).toHaveCount(1);
    await run(input(page), 'printf "%s" "$SETDOWN_SESSION" > still.txt');
    await expect.poll(() => readFile(path.join(root, 'still.txt'), 'utf8').catch(() => '')).toBe('still-here');
    await page.screenshot({ path: test.info().outputPath(`terminal-${direction}.png`) });
    await list.getByRole('button', { name: 'Close terminal Terminal 1', exact: true }).click();
    await expect(page.locator('.editor-group')).toHaveCount(1);
    await expect(page.locator('.terminal-surface')).toHaveCount(0);
    await expect.poll(() => { try { process.kill(Number(pid), 0); return false; } catch { return true; } }).toBe(true);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('terminal list opens without creating a process; a terminal tab uses project cwd and cleans up on reload', async () => {
  test.skip(process.platform === 'win32', 'Process checks use POSIX.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-lifecycle-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'New Document', exact: true })).toBeVisible();
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
    await page.keyboard.press('Control+Backquote');
    const list = page.getByRole('region', { name: 'Terminal sessions' });
    await expect(list).toContainText('No open terminals.');
    await expect(page.locator('.terminal-surface')).toHaveCount(0);
    await list.getByRole('button', { name: 'New terminal session' }).click();
    await expect(page.getByRole('tab', { name: /^Terminal \d/ })).toBeVisible();
    await run(input(page), 'printf "%s" "$$" > shell-pid.txt; pwd > project-cwd.txt');
    await expect.poll(() => readFile(path.join(root, 'project-cwd.txt'), 'utf8').catch(() => '')).toBe(root + '\n');
    const pid = Number(await readFile(path.join(root, 'shell-pid.txt'), 'utf8'));
    await page.reload();
    await expect(page.locator('.terminal-surface')).toHaveCount(0);
    await expect.poll(() => { try { process.kill(pid, 0); return false; } catch { return true; } }).toBe(true);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('detaching a terminal transfers the same shell and restores its screen', async () => {
  test.skip(process.platform === 'win32', 'Commands use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-transfer-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.shell')).toBeVisible();
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
    await page.locator('.empty-new').click();
    await page.locator('.new-terminal-tab-button').click();
    const tab = page.getByRole('tab', { name: /^Terminal \d/ });
    await expect(tab).toBeVisible();
    await run(input(page), 'export TRANSFER_STATE=preserved; printf "TRANSFER-OUTPUT\\n"; printf "%s" "$$" > before.txt');
    await expect.poll(() => readFile(path.join(root, 'before.txt'), 'utf8').catch(() => '')).toMatch(/^\d+$/);
    const pid = await readFile(path.join(root, 'before.txt'), 'utf8');
    await tab.evaluate(element => {
      const dataTransfer = new DataTransfer();
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      element.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer, relatedTarget: null }));
      element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer, screenX: 640, screenY: 420 }));
    });
    await expect(tab).toHaveCount(0);
    const destination = app.windows().find(candidate => candidate !== page && !candidate.isClosed() && candidate.url() === page.url())!;
    await expect(destination.getByRole('tab', { name: /^Terminal \d/ })).toBeVisible();
    await expect(destination.locator('.xterm-screen')).toContainText('TRANSFER-OUTPUT');
    await run(input(destination), 'printf "%s:%s" "$$" "$TRANSFER_STATE" > after.txt');
    await expect.poll(() => readFile(path.join(root, 'after.txt'), 'utf8').catch(() => '')).toBe(`${pid}:preserved`);
    await page.reload();
    await run(input(destination), 'printf alive > owner.txt');
    await expect.poll(() => readFile(path.join(root, 'owner.txt'), 'utf8').catch(() => '')).toBe('alive');
    await destination.getByRole('tab', { name: /^Terminal \d/ }).getByTitle('Close tab', { exact: true }).click();
    expect(() => process.kill(Number(pid), 0)).not.toThrow();
    await destination.getByRole('button', { name: 'Toggle Folder Tools', exact: true }).click();
    await destination.getByRole('button', { name: 'Terminal', exact: true }).click();
    await destination.getByRole('button', { name: 'Close terminal Terminal 1', exact: true }).click();
    await expect.poll(() => { try { process.kill(Number(pid), 0); return false; } catch { return true; } }).toBe(true);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('two visible terminal groups receive input independently and survive tab-strip merging', async () => {
  test.skip(process.platform === 'win32', 'Commands use a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-two-terminals-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.empty-new')).toBeVisible();
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
    await page.locator('.empty-new').click();
    await page.locator('.new-terminal-tab-button').click();
    await expect(page.getByRole('tab', { name: /^Terminal \d/ })).toHaveCount(1);
    const first = await page.getByRole('tab', { name: /^Terminal \d/ }).getAttribute('data-tab-id');
    await run(input(page), 'export SESSION_NAME=one');
    await page.locator('.new-terminal-tab-button').click();
    await expect(page.getByRole('tab', { name: /^Terminal \d/ })).toHaveCount(2);
    const second = await page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id');
    await run(input(page), 'export SESSION_NAME=two');
    await dragTerminal(page, page.locator(`[data-tab-id="${second}"]`), page.locator('.group-body'), 'right');
    await expect(page.locator('.terminal-content:not(.inactive)')).toHaveCount(2);
    for (const [id, name] of [[first, 'one'], [second, 'two']]) {
      await run(page.locator(`[data-terminal-tab="${id}"] .xterm-helper-textarea`), `printf "%s" "$SESSION_NAME" > ${name}.txt`);
      await expect.poll(() => readFile(path.join(root, `${name}.txt`), 'utf8').catch(() => '')).toBe(name);
      await expect(page.locator(`[data-tab-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
    }
    const tab = page.locator(`[data-tab-id="${second}"]`), box = (await tab.boundingBox())!;
    const strip = (await page.locator('.tab-strip').first().boundingBox())!;
    await page.mouse.move(box.x + 25, box.y + 20); await page.mouse.down();
    await page.mouse.move(box.x + 45, box.y + 30, { steps: 8 });
    await page.mouse.move(strip.x + 8, strip.y + 20, { steps: 12 });
    await expect(page.locator('.tab-drop-indicator')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.editor-group')).toHaveCount(1);
    await run(input(page), 'printf "%s" "$SESSION_NAME" > merged.txt');
    await expect.poll(() => readFile(path.join(root, 'merged.txt'), 'utf8').catch(() => '')).toBe('two');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});


test('a live Vim alternate screen retains visible text and insert mode across window transfer', async () => {
  test.skip(process.platform === 'win32', 'This scenario uses the POSIX Vim fixture.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-vim-'));
  const file = path.join(root, 'tui.txt');
  await writeFile(file, 'first-screen-marker\nsecond-screen-marker\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.'], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.empty-new')).toBeVisible();
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);
    await page.locator('.empty-new').click();
    await page.locator('.new-terminal-tab-button').click();
    const tab = page.getByRole('tab', { name: /^Terminal \d/ });
    await expect(tab).toBeVisible();
    await run(input(page), 'printf "%s" "$$" > shell.txt; vim -Nu NONE -n tui.txt');
    await expect(page.locator('.xterm-rows')).toContainText('first-screen-marker');
    await input(page).press('i'); await input(page).pressSequentially('before');
    await expect(page.locator('.xterm-rows')).toContainText('beforefirst-screen-marker');
    const text = await page.locator('.xterm-rows').innerText();
    const dimensions = await page.locator('.terminal-instance').boundingBox();
    await tab.evaluate(element => {
      const dataTransfer = new DataTransfer();
      element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      element.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer, relatedTarget: null }));
      element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer, screenX: 640, screenY: 420 }));
    });
    await expect(tab).toHaveCount(0);
    const destination = app.windows().find(candidate => candidate !== page && !candidate.isClosed() && candidate.url() === page.url())!;
    await expect.poll(() => destination.locator('.xterm-rows').innerText()).toBe(text);
    const restored = (await destination.locator('.terminal-instance').boundingBox())!;
    expect(restored.width).toBe(dimensions!.width); expect(restored.height).toBe(dimensions!.height);
    await input(destination).pressSequentially('after');
    await input(destination).press('Escape');
    await input(destination).pressSequentially(':wq'); await input(destination).press('Enter');
    await expect.poll(() => readFile(file, 'utf8')).toBe('beforeafterfirst-screen-marker\nsecond-screen-marker\n');
    const pid = await readFile(path.join(root, 'shell.txt'), 'utf8');
    await run(input(destination), 'printf "%s" "$$" > after.txt');
    await expect.poll(() => readFile(path.join(root, 'after.txt'), 'utf8').catch(() => '')).toBe(pid);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});

test('all terminal themes preserve the PTY and readable ANSI, indexed and truecolor text', async () => {
  test.skip(process.platform === 'win32', 'The PTY fixture uses a POSIX shell.');
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-terminal-themes-'));
  const file = path.join(root, 'themes.md'); await writeFile(file, '# Terminal themes\n');
  const samples = Array.from({ length: 16 }, (_, i) => `\x1b[${i < 8 ? 30 + i : 90 + i - 8}mANSI${String(i).padStart(2, '0')}\x1b[0m\r\n`).join('')
    + '\x1b[38;5;231mINDEXED\x1b[0m\r\n\x1b[38;2;255;249;239mTRUECOLOR\x1b[0m\r\n'
    + '\x1b[38;2;255;255;255;48;2;250;250;250mEXPLICIT\x1b[0m\r\n\x1b[7mINVERSE\x1b[0m\r\n';
  await writeFile(path.join(root, 'colors.txt'), samples);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, SHELL: '/bin/bash', XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    await focusApplication(app); const page = await app.firstWindow();
    await page.locator('.new-terminal-tab-button').click();
    await run(input(page), 'printf "%s" "$$" > pid-before; cat colors.txt');
    await expect(page.locator('.xterm-rows')).toContainText('INVERSE');
    await input(page).pressSequentially('not-submitted');
    await page.evaluate(() => { (window as any).__keptTerminal = document.querySelector('.xterm'); });
    for (const id of THEME_IDS) {
      await app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(`preview-theme-${id}`)!.click(), id);
      const palette = terminalTheme(id);
      const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      await expect.poll(() => page.locator('.terminal-surface').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(rgb(palette.background!));
      const readings = () => page.locator('.xterm-rows').evaluate(rows => {
        const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const luminance = (value: number[]) => value.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
          .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
        return Array.from(rows.querySelectorAll('span')).filter(span => /^(ANSI\d\d|INDEXED|TRUECOLOR|EXPLICIT|INVERSE)$/.test(span.textContent?.trim() ?? '')).map(span => {
          const style = getComputedStyle(span); let node: Element | null = span, background = style.backgroundColor;
          while (node && background === 'rgba(0, 0, 0, 0)') { node = node.parentElement; if (node) background = getComputedStyle(node).backgroundColor; }
          const fg = luminance(rgb(style.color)), bg = luminance(rgb(background));
          return { label: span.textContent!.trim(), foreground: style.color, background, contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
        });
      });
      // Theme CSS changes before xterm's scheduled cell repaint. Wait for the
      // actual rendered colors; all 20 samples must still meet the same 4.5 ratio.
      await expect.poll(async () => {
        const samples = await readings();
        return { count: samples.length, lowContrast: samples.filter(sample => sample.contrast < 4.5) };
      }, { message: `${id} rendered terminal contrast` }).toEqual({ count: 20, lowContrast: [] });
      expect(await page.evaluate(() => (window as any).__keptTerminal === document.querySelector('.xterm'))).toBe(true);
      await expect(page.locator('.xterm-rows')).toContainText('not-submitted');
      await page.screenshot({ path: test.info().outputPath(`terminal-${id}.png`) });
    }
    await input(page).press('Control+C');
    await run(input(page), 'printf "%s" "$$" > pid-after');
    await expect.poll(() => readFile(path.join(root, 'pid-after'), 'utf8').catch(() => '')).toBe(await readFile(path.join(root, 'pid-before'), 'utf8'));
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
