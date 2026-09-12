import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('파일을 열 때 preview view의 노출/URL 전환을 추적한다', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-probe-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('reports/2026_09_12_20_14_zero_wait_preview_transition_architecture.md')],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });
  try {
    const page = await application.firstWindow();
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await application.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('preview-theme-solarized-dark')?.click();
    });
    await page.waitForTimeout(2000);

    // main process 안에서 고빈도로 상태를 기록한다. capturePage는 쓰지 않는다.
    await application.evaluate(({ BrowserWindow }) => {
      const log: string[] = [];
      (globalThis as Record<string, unknown>).__log = log;
      const started = Date.now();
      const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())!;
      let previous = '';
      const tick = () => {
        const rows = owner.contentView.children
          .filter((candidate) => 'webContents' in candidate)
          .map((candidate, index) => {
            const contents = (candidate as Electron.WebContentsView).webContents;
            const url = contents.getURL();
            return `${index}:${candidate.getVisible() ? 'SHOWN' : 'hidden'}`
              + `:${url ? url.slice(-10) : 'BLANK'}`
              + `:${contents.isLoading() ? 'loading' : 'idle'}`;
          })
          .join(' | ');
        if (rows !== previous) {
          log.push(`+${Date.now() - started}ms  ${rows}`);
          previous = rows;
        }
        if (Date.now() - started < 9000) setTimeout(tick, 4);
      };
      tick();
    });

    const other = path.resolve('reports/sample.md');
    await application.evaluate(({ app }, argv) => {
      app.emit('second-instance', {}, argv);
    }, [process.execPath, other]);

    await page.waitForTimeout(9500);
    const log = await application.evaluate(() => (globalThis as Record<string, unknown>).__log);
    console.log('\n' + (log as string[]).join('\n') + '\n');
  } finally {
    await application.close().catch(() => {});
  }
});
