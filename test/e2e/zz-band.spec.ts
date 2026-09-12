import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('cursor가 화면 밖인 상태로 Escape: 띠 무게중심 경로', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-band-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('reports/sample.md')],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });
  application.process().stderr?.on('data', (chunk) =>
    console.log('[main stderr]', String(chunk).trim().slice(0, 300)));

  const previewState = () => application.evaluate(async ({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
    const preview = owner?.contentView.children.find((candidate) =>
      'webContents' in candidate
      && candidate.webContents.getURL().startsWith('marktex-preview://document/'));
    if (!preview || !('webContents' in preview)) return null;
    if (preview.webContents.isCrashed()) return { crashed: true };
    return {
      crashed: false,
      ...(await preview.webContents.executeJavaScript(
        '({ scrollY: Math.round(scrollY), innerHeight, textLength: document.body.innerText.length })',
      )),
    };
  });

  try {
    const page = await application.firstWindow();
    page.on('pageerror', (error) => console.log('[renderer pageerror]', error.message));
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await page.waitForTimeout(1500);

    for (const wheels of [20, 50]) {
      await page.locator('.mode-toggle').click();
      await expect(page.locator('.editor-surface')).toBeVisible();
      // cursor를 1행에 두고 wheel로만 내려 cursor를 화면 밖으로 보낸다.
      await page.locator('.monaco-editor').click({ position: { x: 120, y: 40 } });
      await page.keyboard.press('Control+Home');
      const box = (await page.locator('.editor-surface').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let step = 0; step < wheels; step += 1) await page.mouse.wheel(0, 500);
      await page.waitForTimeout(700);

      const gutter = await page.evaluate(() => {
        const numbers = Array.from(document.querySelectorAll('.monaco-editor .line-numbers'))
          .map((element) => Number(element.textContent))
          .filter((value) => Number.isFinite(value) && value > 0);
        return numbers.length
          ? { first: Math.min(...numbers), last: Math.max(...numbers) }
          : null;
      });

      await page.getByRole('textbox', { name: 'Editor content' }).press('Escape');
      await expect(page.locator('.viewer-surface')).toBeVisible();
      await page.waitForTimeout(1800);
      const state = await previewState();
      console.log(`wheel x${wheels}: editor lines ${gutter?.first}-${gutter?.last}`
        + ` -> preview ${JSON.stringify(state)}`);
      expect(state?.crashed).toBe(false);
      expect(await page.locator('.shell').evaluate((element) =>
        (element as HTMLElement).dataset.surface)).toBe('viewer');
    }
  } finally {
    await application.close().catch(() => {});
  }
});
