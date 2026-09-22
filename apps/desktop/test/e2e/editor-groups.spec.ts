import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WebContentsView } from 'electron';
import type { MarkTexApi } from '../../src/protocol/desktop-api';
import { disposeApplication, focusApplication } from './electron-app';

async function open(page: Page, file: string) {
  await page.evaluate(file => (window as unknown as { marktex: MarkTexApi }).marktex.openLink(`marktex-resource://file${file}`), file);
  await expect(page.getByRole('tab', { name: new RegExp(path.basename(file).replaceAll('.', '\\.')) })).toHaveAttribute('aria-selected', 'true');
}
async function drop(page: Page, name: string, groupIndex: number, side: 'right' | 'down' | 'center') {
  const tab = page.locator('.document-tab').filter({ hasText: name });
  const data = await page.evaluateHandle(() => new DataTransfer());
  await tab.dispatchEvent('dragstart', { dataTransfer: data });
  const body = page.locator('.group-body').nth(groupIndex);
  const box = (await body.boundingBox())!;
  const point = { clientX: box.x + box.width * (side === 'right' ? .98 : .5),
    clientY: box.y + box.height * (side === 'down' ? .98 : .5), dataTransfer: data };
  await body.dispatchEvent('dragover', point);
  await expect(page.locator('.group-drop-overlay')).toBeVisible();
  await body.dispatchEvent('drop', point);
  await data.dispose();
}

test('wheel scrolls without selection; nested groups retain live native readers and collapse on close', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-editor-groups-'));
  const first = path.join(root, 'first.md'), second = path.join(root, 'second.md'), third = path.join(root, 'third.md');
  await writeFile(first, '# First reader\n\nKeep this visible.\n');
  await writeFile(second, '# Second reader\n\nIndependent native reader.\n');
  await writeFile(third, '# Third reader\n\nOpen directly in the drop target.\n');
  const image = path.join(root, 'picture.png');
  await copyFile(path.resolve('../../docs/assets/image2.png'), image);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', first], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  const page = await app.firstWindow();
  await focusApplication(app);
  const visibleReaders = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
    .filter(view => view.getVisible()).length);
  try {
    await expect.poll(visibleReaders).toBe(1);
    await open(page, second);
    await expect.poll(visibleReaders).toBe(1);
    await drop(page, 'second.md', 0, 'right');
    await expect(page.locator('.editor-group')).toHaveCount(2);
    await expect.poll(visibleReaders).toBe(2);
    await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => Promise.all(
      BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible())
        .map(view => (view as WebContentsView).webContents.executeJavaScript('document.body.innerText')),
    ))).toEqual(expect.arrayContaining([expect.stringContaining('First reader'), expect.stringContaining('Second reader')]));
    await page.evaluate(folder => window.marktex.restoreProjectFolder(folder), root);

    // Terminal and BrowserWindow resizing must leave both native readers inside
    // their current DOM group boxes. In particular, no stale foreground bounds
    // may extend across the terminal while background bounds are being updated.
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-toggle-terminal'));
    const terminal = page.getByRole('region', { name: 'Integrated terminal' });
    await expect(terminal).toBeVisible();
    const nativeLayoutMatches = async () => {
      const bodies = await page.locator('.group-body').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }).sort((a, b) => a.x - b.x || a.y - b.y));
      const native = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
        .filter(view => view.getVisible()).map(view => view.getBounds())
        .sort((a, b) => a.x - b.x || a.y - b.y));
      const panel = await terminal.boundingBox();
      return !!panel && bodies.length === native.length && bodies.every((body, index) => {
        const view = native[index];
        return Math.abs(body.x - view.x) <= 1 && Math.abs(body.y - view.y) <= 1
          && Math.abs(body.width - view.width) <= 1 && Math.abs(body.height - view.height) <= 1
          && view.y + view.height <= panel.y + 1;
      });
    };
    await expect.poll(nativeLayoutMatches).toBe(true);
    const terminalTop = (await terminal.boundingBox())!.y;
    const liveResizeSamples = await app.evaluate(async ({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows()[0];
      const [startWidth, height] = owner.getSize();
      const samples: Array<Array<{ x: number; y: number; width: number; height: number }>> = [];
      const sample = () => samples.push(owner.contentView.children.filter(view => view.getVisible())
        .map(view => view.getBounds()).sort((a, b) => a.x - b.x || a.y - b.y));
      owner.on('resize', sample);
      for (const width of [startWidth + 180, startWidth - 140, startWidth + 60]) {
        owner.setSize(width, height);
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      owner.off('resize', sample);
      return samples;
    });
    expect(liveResizeSamples.length).toBeGreaterThan(0);
    for (const sample of liveResizeSamples) {
      expect(sample).toHaveLength(2);
      expect(sample[0].x + sample[0].width).toBeLessThanOrEqual(sample[1].x + 1);
      expect(sample.every(box => box.y + box.height <= terminalTop + 1)).toBe(true);
    }
    for (const [width, height] of [[980, 720], [1220, 840], [1080, 760]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height]);
      await expect.poll(nativeLayoutMatches).toBe(true);
      await expect.poll(visibleReaders).toBe(2);
    }
    await terminal.getByRole('button', { name: 'Hide Terminal' }).click();
    await expect(terminal).toBeHidden();

    // Opening a project file by dropping it in group 2 must never first paint a
    // tab in the focused/default group and move it on the next task.
    await page.evaluate(() => {
      const observed: string[] = [];
      const record = () => document.querySelectorAll<HTMLElement>('.editor-group').forEach(group => {
        if ([...group.querySelectorAll('.tab-name')].some(tab => tab.textContent === 'third.md')) {
          const id = group.dataset.groupId ?? '';
          if (observed.at(-1) !== id) observed.push(id);
        }
      });
      new MutationObserver(record).observe(document.querySelector('.editor-area')!, { subtree: true, childList: true, characterData: true });
      (window as typeof window & { __thirdTabGroups?: string[] }).__thirdTabGroups = observed;
    });
    const targetGroupId = await page.locator('.editor-group').nth(1).getAttribute('data-group-id');
    const targetBody = page.locator('.group-body').nth(1);
    const targetBox = (await targetBody.boundingBox())!;
    const fileTransfer = await page.evaluateHandle(file => {
      const transfer = new DataTransfer(); transfer.setData('application/x-setdown-project-file', file); return transfer;
    }, third);
    const filePoint = { clientX: targetBox.x + targetBox.width / 2, clientY: targetBox.y + targetBox.height / 2,
      dataTransfer: fileTransfer };
    await targetBody.dispatchEvent('dragover', filePoint);
    await targetBody.dispatchEvent('drop', filePoint);
    await expect(page.getByRole('tab', { name: /third\.md/ })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __thirdTabGroups?: string[] }).__thirdTabGroups ?? [])).toEqual([targetGroupId]);
    await page.getByRole('tab', { name: /third\.md/ }).getByTitle('Close tab', { exact: true }).click();
    await fileTransfer.dispose();

    // DOM menus cover native readers only after every visible group has a
    // painted replacement, so neither the focused nor background group blanks.
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await expect(page.locator('.preview-frames[data-frozen="true"]')).toBeVisible();
    await expect(page.locator('.group-body[data-native-preview-frozen="true"]')).toHaveCount(1);
    expect(await page.locator('.group-body[data-native-preview-frozen="true"]').evaluate(node =>
      getComputedStyle(node).backgroundImage)).not.toBe('none');
    await page.keyboard.press('Escape');
    await expect(page.locator('.group-body[data-native-preview-frozen="true"]')).toHaveCount(0);
    await expect.poll(visibleReaders).toBe(2);
    await open(page, image);
    await drop(page, 'picture.png', 1, 'down');
    await expect(page.locator('.editor-group')).toHaveCount(3);
    await expect.poll(visibleReaders).toBe(2);
    await expect(page.getByRole('region', { name: 'Image reader', exact: true })).toBeVisible();
    const boxes = await page.locator('.editor-group').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    expect(boxes[0].width).toBeCloseTo(boxes[1].width, 0);
    expect(boxes[0].height).toBeCloseTo(boxes[1].height * 2, 0);
    expect(boxes[2].y).toBeGreaterThan(boxes[1].y);
    const imageBounds = (await page.getByRole('region', { name: 'Image reader', exact: true }).boundingBox())!;
    const imageBody = (await page.locator('.group-body').nth(2).boundingBox())!;
    expect(imageBounds.x).toBeCloseTo(imageBody.x, 0);
    expect(imageBounds.y).toBeCloseTo(imageBody.y, 0);
    expect(imageBounds.width).toBeCloseTo(imageBody.width, 0);
    expect(imageBounds.height).toBeCloseTo(imageBody.height, 0);
    await page.screenshot({ path: 'test-results/editor-groups.png' });
    const sash = page.locator('.group-sash.vertical');
    // Grab the vertical boundary away from its intersection with the horizontal sash.
    const sashBox = (await sash.boundingBox())!;
    const nativeWidths = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(view => view.getVisible()).map(view => view.getBounds()).sort((a, b) => a.x - b.x).map(box => box.width));
    const widthsBeforeResize = await nativeWidths();
    await page.mouse.move(sashBox.x + sashBox.width / 2, sashBox.y + sashBox.height * .3);
    await page.mouse.down();
    await expect(page.locator('.group-body[data-native-preview-frozen="true"]')).toHaveCount(0);
    await page.mouse.move(sashBox.x + 75, sashBox.y + sashBox.height * .3);
    // The live native readers follow the boundary before pointer-up. A stretched
    // capture cannot satisfy this because its WebContentsView keeps the old box.
    await expect.poll(async () => (await nativeWidths())[0]).toBeGreaterThan(widthsBeforeResize[0] + 30);
    await expect.poll(visibleReaders).toBe(2);
    await page.mouse.up();
    await expect(page.locator('.group-body[data-native-preview-frozen="true"]')).toHaveCount(0);
    await expect.poll(async () => (await page.locator('.editor-group').first().boundingBox())!.width).toBeGreaterThan(boxes[0].width + 30);
    await expect.poll(visibleReaders).toBe(2);
    await sash.dblclick({ position: { x: 2, y: 10 } });
    // Focusing the left source must leave the right reader and image in place.
    await page.locator('.document-tab').filter({ hasText: 'first.md' }).click();
    await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    await expect.poll(visibleReaders).toBe(1);
    await page.locator('.document-tab').filter({ hasText: 'second.md' }).click();
    await page.getByRole('button', { name: 'Switch to Editor', exact: true }).click();
    await expect.poll(() => page.locator('.monaco-editor:visible').count()).toBe(2);
    await page.screenshot({ path: 'test-results/editor-groups-source.png' });
    // Clicking an unfocused editor must retain keyboard focus after reparenting.
    await page.locator('.group-editor-host .monaco-editor:visible').click();
    await expect(page.locator('.editor-group.focused .tab-name')).toHaveText('first.md');
    await page.keyboard.press('Control+End'); await page.keyboard.type('Direct group edit');
    await expect(page.locator('.focused-content .view-lines')).toContainText('Direct group edit');
    await page.keyboard.press('Control+z');
    await page.locator('.document-tab').filter({ hasText: 'second.md' }).click();
    // Model changes and Undo survive group focus and moving a tab back.
    await page.locator('.focused-content .monaco-editor').click();
    await page.keyboard.press('Control+End'); await page.keyboard.type('\nSecond edit');
    await page.locator('.document-tab').filter({ hasText: 'first.md' }).click();
    await page.locator('.document-tab').filter({ hasText: 'second.md' }).click();
    await page.locator('.focused-content .monaco-editor').click();
    await expect(page.locator('.focused-content .view-lines')).toContainText('Second edit');
    await page.keyboard.press('Control+z');
    await expect(page.locator('.focused-content .view-lines')).not.toContainText('Second edit');
    await page.locator('.document-tab').filter({ hasText: 'picture.png' }).getByTitle('Close tab', { exact: true }).click();
    await expect(page.locator('.editor-group')).toHaveCount(2);
    await drop(page, 'second.md', 0, 'center');
    await expect(page.locator('.editor-group')).toHaveCount(1);
    // Fill a strip beyond its viewport; vertical wheel changes scrollLeft only.
    for (let i = 0; i < 14; i++) {
      const file = path.join(root, `document-${i}.txt`); await writeFile(file, `Document ${i}`); await open(page, file);
    }
    const list = page.locator('.tab-list');
    const selected = await page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id');
    await list.evaluate(node => { node.scrollLeft = 0; });
    await list.hover(); await page.mouse.wheel(0, 500);
    await expect.poll(() => list.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    expect(await page.locator('.document-tab[aria-selected="true"]').getAttribute('data-tab-id')).toBe(selected);
    await page.mouse.wheel(0, -2000);
    await expect.poll(() => list.evaluate(node => node.scrollLeft)).toBe(0);
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
