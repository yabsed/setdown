import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SHOTS = process.env.SETDOWN_SHOTS ?? os.tmpdir();

test('메뉴 팝업이 Preview 위에 온전히 보인다', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-menu-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('reports/sample.md')],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  const previewVisible = () => application.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
    const preview = owner?.contentView.children.find((candidate) =>
      'webContents' in candidate
      && candidate.webContents.getURL().startsWith('marktex-preview://document/'));
    return preview && 'webContents' in preview ? preview.getVisible() : null;
  });
  const capture = async (name: string) => {
    const data = await application.evaluate(async ({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
      if (!owner) return null;
      return (await owner.webContents.capturePage()).toPNG().toString('base64');
    });
    if (data) await writeFile(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  };

  try {
    const page = await application.firstWindow();
    page.on('pageerror', (error) => console.log('[renderer pageerror]', error.message));
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await page.waitForTimeout(1800);
    console.log('메뉴 열기 전 native view 노출:', await previewVisible());

    await page.locator('.application-menu button', { hasText: 'View' }).click();
    const popup = page.locator('.application-menu-popup');
    await expect(popup).toBeVisible();
    await page.waitForTimeout(700);

    const frozen = await page.locator('.preview-frames').evaluate((element) =>
      (element as HTMLElement).dataset.frozen ?? null);
    console.log('메뉴 열린 뒤 native view 노출:', await previewVisible(), '| 정지 화면:', frozen);
    const box = (await popup.boundingBox())!;
    console.log('팝업 박스:', JSON.stringify(box));
    await capture('menu-open');

    // 팝업 전체가 창 안에 있고, 마지막 항목까지 클릭 가능해야 한다.
    const rows = await popup.locator('.product-menu-row > button').count();
    const last = popup.locator('.product-menu-row > button').last();
    await expect(last).toBeVisible();
    console.log('팝업 항목 수:', rows);

    expect(await previewVisible()).toBe(false);
    expect(frozen).toBe('true');

    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await page.waitForTimeout(600);
    console.log('메뉴 닫은 뒤 native view 노출:', await previewVisible(),
      '| 정지 화면:', await page.locator('.preview-frames').evaluate((element) =>
        (element as HTMLElement).dataset.frozen ?? null));
    await capture('menu-closed');
    expect(await previewVisible()).toBe(true);
  } finally {
    await application.close().catch(() => {});
  }
});
