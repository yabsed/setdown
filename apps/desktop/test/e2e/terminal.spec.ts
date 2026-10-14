import { electron } from './electron-app';
import { expect, test, type Locator } from '@playwright/test';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { previews } from './preview-view';
import { disposeApplication, focusApplication } from './electron-app';
import { dragTerminal } from './terminal-drag';

const run = async (input: Locator, command: string) => { await input.pressSequentially(command); await input.press('Enter'); };
const input = (page: import('@playwright/test').Page) => page.locator('.terminal-content:not(.inactive) .xterm-helper-textarea');

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
    // The dedicated menu reset also leaves the other factors alone.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await expect.poll(fontOf).not.toBe(font0);
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-reset-terminal-zoom'));
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
    const destination = app.windows().find(candidate => candidate !== page && !candidate.isClosed())!;
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
    const destination = app.windows().find(candidate => candidate !== page && !candidate.isClosed())!;
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
