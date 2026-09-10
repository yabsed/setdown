import { expect, test, type Page } from '@playwright/test';
import { launchWithDocument } from './app';

test.describe.configure({ mode: 'serial' });

/** Viewer iframe이 화면에서 차지하는 사각형. */
async function viewerBox(page: Page) {
  const box = await page.locator('.preview-frame').boundingBox();
  if (!box) throw new Error('Viewer가 화면에 없습니다.');
  return box;
}

/** Viewer가 다시 그려질 때까지 기다린다. */
async function viewerReady(page: Page) {
  await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'viewer');
  await page
    .frameLocator('.preview-frame')
    .locator('.markdown-preview[data-for="preview"]')
    .waitFor({ state: 'attached', timeout: 20_000 });
}

async function backToViewer(page: Page) {
  await page.keyboard.press('Escape');
  await viewerReady(page);
}

test('빈 문서의 어느 지점을 눌러도 Editor로 넘어간다', async () => {
  test.setTimeout(180_000);
  // 0 byte 문서. 렌더할 block이 없으므로 data-source-line이 하나도 없다.
  const app = await launchWithDocument('빈 문서.md', '');
  const { page } = app;
  try {
    await viewerReady(page);
    const box = await viewerBox(page);

    for (const yFraction of [0.1, 0.5, 0.9]) {
      for (const xFraction of [0.08, 0.5, 0.92]) {
        const x = box.x + box.width * xFraction;
        const y = box.y + box.height * yFraction;
        await page.mouse.dblclick(x, y);
        // mapping이 fallback이어도 전환은 성공이다.
        await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
        await expect(page.locator('.shell')).toHaveAttribute('data-anchor-line', '1');
        await expect(page.locator('.shell')).toHaveAttribute(
          'data-anchor-reason',
          'empty-document',
        );
        await backToViewer(page);
      }
    }
  } finally {
    await app.close();
  }
});

test('수식과 여백과 링크에서도 전환은 보장되고 위치는 최선을 다한다', async () => {
  test.setTimeout(180_000);
  const document = [
    '# 제목', // 1
    '', // 2
    '문장 속 $x^2$ 수식이 있는 문단입니다.', // 3
    '', // 4
    '$$', // 5
    'E=mc^2', // 6
    '$$', // 7
    '', // 8
    '[예시 링크](https://example.com)를 담은 문단입니다.', // 9
    '', // 10
    '마지막 문단입니다.', // 11
    '',
  ].join('\n');
  const app = await launchWithDocument('수식.md', document);
  const { page } = app;
  const preview = page.frameLocator('.preview-frame');
  try {
    await viewerReady(page);

    await test.step('독립 수식은 opening delimiter 행으로 간다', async () => {
      const math = preview.locator('.crossnote-math-source').first();
      await expect(math).toBeVisible({ timeout: 20_000 });
      await math.dblclick({ force: true });
      await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
      await expect(page.locator('.shell')).toHaveAttribute('data-anchor-line', '5');
      await backToViewer(page);
    });

    await test.step('인라인 수식은 delimiter 열까지 안다', async () => {
      const inline = preview.locator('.crossnote-inline-math-source').first();
      await inline.dblclick({ force: true });
      await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
      await expect(page.locator('.shell')).toHaveAttribute('data-anchor-line', '3');
      await expect(page.locator('.shell')).toHaveAttribute('data-anchor-confidence', 'exact');
      await backToViewer(page);
    });

    await test.step('문서 끝 여백도 전환한다', async () => {
      const box = await viewerBox(page);
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height - 12);
      await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
      const line = Number(await page.locator('.shell').getAttribute('data-anchor-line'));
      expect(line).toBeGreaterThanOrEqual(1);
      await backToViewer(page);
    });

    await test.step('링크는 열리지 않고 원문으로 넘어간다', async () => {
      const link = preview.locator('a[href*="example.com"]').first();
      await link.dblclick({ force: true });
      await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
      await expect(page.locator('.shell')).toHaveAttribute('data-anchor-line', '9');
      // 링크를 따라가 버렸다면 Viewer의 문서가 통째로 바뀌었을 것이다.
      await backToViewer(page);
      await expect(preview.getByText('마지막 문단입니다.')).toBeVisible();
    });
  } finally {
    await app.close();
  }
});

test('Esc는 cursor가 아니라 보고 있던 화면을 따른다', async () => {
  test.setTimeout(180_000);
  const lines: string[] = [];
  for (let line = 1; line <= 400; line += 1) lines.push(`${line}행 본문입니다.`);
  const app = await launchWithDocument('긴 문서.md', lines.join('\n\n') + '\n');
  const { page } = app;
  try {
    await viewerReady(page);
    const preview = page.frameLocator('.preview-frame');
    await expect(preview.getByText('1행 본문입니다.', { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // 문서 앞쪽을 더블 클릭해 Editor로 들어간다. cursor는 여기에 남는다.
    await preview.getByText('5행 본문입니다.', { exact: true }).dblclick({ force: true });
    await expect(page.locator('.shell')).toHaveAttribute('data-surface', 'editor');
    const cursorLine = Number(await page.locator('.shell').getAttribute('data-anchor-line'));
    expect(cursorLine).toBeLessThan(20);

    // cursor는 그대로 둔 채 마우스 휠로 한참 아래를 읽는다.
    const editorBox = await page.locator('.editor-surface').boundingBox();
    if (!editorBox) throw new Error('Editor가 화면에 없습니다.');
    await page.mouse.move(
      editorBox.x + editorBox.width / 2,
      editorBox.y + editorBox.height / 2,
    );
    for (let step = 0; step < 20; step += 1) {
      await page.mouse.wheel(0, 600);
    }
    await expect
      .poll(async () => Number(await page.locator('.shell').getAttribute('data-anchor-line')))
      .toBeLessThan(20); // 아직 Esc 전이므로 anchor는 그대로다.

    await page.keyboard.press('Escape');
    await viewerReady(page);
    const followed = Number(await page.locator('.shell').getAttribute('data-anchor-line'));
    // cursor는 5행 근처에 남아 있지만 화면은 한참 아래였다.
    expect(followed).toBeGreaterThan(50);
  } finally {
    await app.close();
  }
});
