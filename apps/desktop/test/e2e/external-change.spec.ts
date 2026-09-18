import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { previews } from './preview-view';
import { disposeApplication } from './electron-app';

test('reloads or keeps an externally changed document with content-based dirty state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-external-change-'));
  const documentPath = path.join(root, 'external.md');
  await writeFile(documentPath, '# original\n', 'utf8');
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', documentPath],
    env: { ...environment, XDG_CONFIG_HOME: path.join(root, 'config') },
  });

  try {
    const window = await application.firstWindow();
    const reading = previews(application);
    await expect(window.locator('.viewer-surface')).toBeVisible();
    await expect.poll(reading.hasVisible).toBe(true);

    await writeFile(documentPath, '# disk change\n', 'utf8');
    await expect(window.locator('.notice')).toBeVisible({ timeout: 5_000 });
    await window.locator('.notice-reload').click();
    await expect(window.locator('.notice')).toBeHidden();
    await expect.poll(() => reading.evaluate('document.body.innerText')).toContain('disk change');
    await expect(window.locator('.tab-dirty')).toHaveCount(0);
    await expect(window.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');

    await window.locator('.mode-toggle').click();
    await expect(window.locator('.editor-surface')).toBeVisible();
    const editor = window.getByRole('textbox', { name: 'Editor content' });
    await editor.press('Control+A');
    await editor.pressSequentially('# edited');
    await expect(window.locator('.tab-dirty')).toHaveCount(1);

    // revision은 이미 증가했지만 저장된 문자열로 돌아오면 clean이어야 한다.
    await editor.press('Control+A');
    await editor.pressSequentially('# disk change\n');
    await expect(window.locator('.tab-dirty')).toHaveCount(0);
    await expect(window.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');

    await writeFile(documentPath, '# changed outside again\n', 'utf8');
    await expect(window.locator('.notice')).toBeVisible({ timeout: 5_000 });
    await window.locator('.notice-keep').click();
    await expect(window.locator('.notice')).toBeHidden();
    await expect(window.locator('.tab-dirty')).toHaveCount(1);
    await expect(window.locator('.shell')).toHaveAttribute('data-dirty-tabs', '1');

    // 이제 dirty의 기준은 외부 프로그램이 쓴 최신 내용이다.
    await editor.press('Control+A');
    await editor.pressSequentially('# changed outside again\n');
    await expect(window.locator('.tab-dirty')).toHaveCount(0);
    await expect(window.locator('.shell')).toHaveAttribute('data-dirty-tabs', '0');
  } finally {
    await disposeApplication(application);
    await rm(root, { recursive: true, force: true });
  }
});
