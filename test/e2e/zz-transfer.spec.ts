import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('무거운 문서 인계: 배율/높이 안정성과 전환 즉시성', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-tr-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('reports/sample.md')],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });
  try {
    const page = await application.firstWindow();
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await page.waitForTimeout(3000);

    await application.evaluate(async ({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())!;
      const view = owner.contentView.children.find((candidate) =>
        'webContents' in candidate && candidate.getVisible()
        && candidate.webContents.getURL().startsWith('marktex-preview://document/'))!;
      await (view as Electron.WebContentsView).webContents.executeJavaScript(`
        window.scrollTo(0, 3000);
        window.__rec = [];
        window.__t0 = performance.now();
        setInterval(() => {
          window.__rec.push([Math.round(performance.now() - window.__t0),
            Math.round(scrollY), document.documentElement.scrollHeight, devicePixelRatio]);
        }, 8);
        true;`);
    });
    await page.waitForTimeout(400);

    // 목적지 창이 보이는 순간과 Preview가 드러나는 순간을 각각 기록한다.
    await application.evaluate(({ BrowserWindow }) => {
      const marks: string[] = [];
      (globalThis as Record<string, unknown>).__marks = marks;
      const started = Date.now();
      const before = BrowserWindow.getAllWindows().map((window) => window.id);
      let sawWindow = false;
      let sawPreview = false;
      const poll = () => {
        const fresh = BrowserWindow.getAllWindows()
          .find((window) => !before.includes(window.id));
        if (fresh && fresh.isVisible() && !sawWindow) {
          sawWindow = true;
          marks.push(`+${Date.now() - started}ms 새 창이 보임`);
        }
        if (fresh && !sawPreview) {
          const shown = fresh.contentView.children.some((candidate) =>
            'webContents' in candidate && candidate.getVisible()
            && candidate.webContents.getURL().startsWith('marktex-preview://document/'));
          if (shown) {
            sawPreview = true;
            marks.push(`+${Date.now() - started}ms Preview가 드러남`);
          }
        }
        if (!sawWindow || !sawPreview) setTimeout(poll, 4);
      };
      poll();
    });
    await page.evaluate(() => {
      const tab = document.querySelector<HTMLElement>('.document-tab')!;
      const transfer = new DataTransfer();
      tab.dispatchEvent(new DragEvent('dragstart', {
        dataTransfer: transfer, bubbles: true, cancelable: true,
      }));
      tab.dispatchEvent(new DragEvent('dragend', {
        dataTransfer: transfer, bubbles: true, cancelable: true,
        screenX: 1400, screenY: 300,
      }));
    });
    await new Promise((resolve) => setTimeout(resolve, 6000));

    const out = await application.evaluate(async ({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        const view = window.contentView.children.find((candidate) =>
          'webContents' in candidate && candidate.getVisible()
          && candidate.webContents.getURL().startsWith('marktex-preview://document/'));
        if (!view || !('webContents' in view)) continue;
        const rec = await (view as Electron.WebContentsView).webContents
          .executeJavaScript('window.__rec || null');
        if (rec) return { rec, windows: BrowserWindow.getAllWindows().length };
      }
      return null;
    });
    if (!out) { console.log('기록기를 찾지 못했습니다'); return; }
    console.log('전환 시각:', JSON.stringify(
      await application.evaluate(() => (globalThis as Record<string, unknown>).__marks)));

    const rows = out.rec as [number, number, number, number][];
    let previous = '';
    const changes: string[] = [];
    const ratios = new Set<number>();
    const heights = new Set<number>();
    for (const [at, y, height, dpr] of rows) {
      ratios.add(Math.round(dpr * 10000) / 10000);
      heights.add(height);
      const key = `${y}/${height}/${dpr}`;
      if (key === previous) continue;
      previous = key;
      changes.push(`+${at}ms  scrollY=${y}  문서높이=${height}  DPR=${Math.round(dpr * 10000) / 10000}`);
    }
    console.log(`\n창=${out.windows}  나타난 DPR=${[...ratios].join(', ')}`
      + `  나타난 높이=${[...heights].join(', ')}`);
    console.log(changes.join('\n') + '\n');
  } finally {
    await application.close().catch(() => {});
  }
});
