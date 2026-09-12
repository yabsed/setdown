import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('cursor가 화면 밖이면 띠 전체의 정렬 오차를 측정한다', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-band-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', path.resolve('reports/sample.md')],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });
  const previewEval = (script: string) => application.evaluate(async ({ BrowserWindow }, source) => {
    const owner = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
    const preview = owner?.contentView.children.find((candidate) =>
      'webContents' in candidate
      && candidate.webContents.getURL().startsWith('marktex-preview://document/'));
    if (!preview || !('webContents' in preview)) return null;
    return await preview.webContents.executeJavaScript(source);
  }, script);

  try {
    const page = await application.firstWindow();
    await expect(page.locator('.viewer-surface')).toBeVisible();
    await expect.poll(() => previewEval('document.body.innerText.length')).toBeGreaterThan(100);

    const rows: string[] = [];
    for (const wheels of [20, 40, 60, 90]) {
      await page.locator('.mode-toggle').click();
      await expect(page.locator('.editor-surface')).toBeVisible();
      // cursor를 1행에 두고 wheel로만 내려가 cursor를 화면 밖으로 보낸다.
      await page.locator('.monaco-editor').click({ position: { x: 120, y: 40 } });
      await page.keyboard.press('Control+Home');
      const box = (await page.locator('.editor-surface').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let step = 0; step < wheels; step += 1) await page.mouse.wheel(0, 500);
      await page.waitForTimeout(700);

      // Editor에 보이는 줄과 그 화면 비율.
      const band = await page.evaluate(() => {
        const lines = document.querySelectorAll('.monaco-editor .view-line');
        const host = document.querySelector('.monaco-editor')!.getBoundingClientRect();
        const out: { line: number; ratio: number }[] = [];
        lines.forEach((element) => {
          const rect = element.getBoundingClientRect();
          const top = (element as HTMLElement).style.top;
          void top;
          const margin = element.previousElementSibling;
          void margin;
          out.push({ line: -1, ratio: (rect.top - host.top) / host.height });
        });
        return { count: out.length, height: host.height };
      });

      await page.getByRole('textbox', { name: 'Editor content' }).press('Escape');
      await expect(page.locator('.viewer-surface')).toBeVisible();
      await page.waitForTimeout(1800);

      // Editor 첫/마지막 가시 줄이 Viewer에서 어디에 놓였는지.
      const gutter = await page.evaluate(() => {
        const numbers = Array.from(document.querySelectorAll('.monaco-editor .line-numbers'))
          .map((element) => Number(element.textContent))
          .filter((value) => Number.isFinite(value) && value > 0);
        return numbers.length ? { first: Math.min(...numbers), last: Math.max(...numbers) } : null;
      });
      const placement = await previewEval(`(() => {
        const root = document.querySelector('.markdown-preview[data-for="preview"]');
        const at = (line) => {
          const element = root.querySelector('[data-source-line="' + line + '"]');
          return element ? Math.round(element.getBoundingClientRect().top) : null;
        };
        return { first: at(${gutter?.first ?? 1}), last: at(${gutter?.last ?? 1}),
          innerHeight };
      })()`) as { first: number | null; last: number | null; innerHeight: number };

      rows.push(`wheel x${wheels}: editor lines ${gutter?.first}-${gutter?.last}`
        + ` (band ${band.count} rows)`
        + ` -> viewer top=${placement.first} bottom=${placement.last}`
        + ` / ${placement.innerHeight}`);
    }
    console.log('\n' + rows.join('\n') + '\n');
  } finally {
    await application.close();
  }
});
