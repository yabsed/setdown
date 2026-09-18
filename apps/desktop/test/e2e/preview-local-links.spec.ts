import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { previews } from './preview-view';
import { disposeApplication } from './electron-app';

test('opens a parent-relative Markdown link in a document tab', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'setdown-local-link-e2e-'));
  const configRoot = path.join(temporaryRoot, 'config');
  const sourcePath = path.join(temporaryRoot, 'work', 'notes', 'index.md');
  const linkedPath = path.join(
    temporaryRoot,
    'prior-research',
    'papers',
    'md',
    '2024',
    '2024_Mondrian.md',
  );
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await mkdir(path.dirname(linkedPath), { recursive: true });
  await writeFile(sourcePath, [
    '# 논문 목록',
    '',
    '원문 : [Markdown](../../prior-research/papers/md/2024/2024_Mondrian.md)'
      + ' · [PDF](../../prior-research/papers/pdf/2024/2024_Mondrian.pdf)',
  ].join('\n'), 'utf8');
  await writeFile(linkedPath, '# Mondrian\n\n연결된 문서 본문', 'utf8');

  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const application = await electron.launch({
    args: ['.', sourcePath],
    env: { ...environment, XDG_CONFIG_HOME: configRoot },
  });

  try {
    const window = await application.firstWindow();
    const reading = previews(application);
    await expect(window.locator('.document-tab')).toHaveCount(1);
    await expect.poll(() => reading.evaluate(
      "document.querySelector('.markdown-preview')?.textContent || ''",
    )).toContain('Markdown');

    await reading.evaluate(`([...document.querySelectorAll('a')]
      .find((anchor) => anchor.textContent === 'Markdown'))?.click()`);

    await expect(window.locator('.document-tab')).toHaveCount(2);
    await expect(window.locator('.document-tab[aria-selected="true"] .tab-name'))
      .toHaveText('2024_Mondrian.md');
    await expect.poll(() => reading.evaluate(
      "document.querySelector('.markdown-preview')?.textContent || ''",
    )).toContain('연결된 문서 본문');

    // 이미 열린 목적지를 다시 누르면 복제 탭을 만들지 않고 그 탭을 활성화한다.
    await window.locator('.document-tab', { hasText: 'index.md' }).click();
    await reading.evaluate(`([...document.querySelectorAll('a')]
      .find((anchor) => anchor.textContent === 'Markdown'))?.click()`);
    await expect(window.locator('.document-tab')).toHaveCount(2);
    await expect(window.locator('.document-tab[aria-selected="true"] .tab-name'))
      .toHaveText('2024_Mondrian.md');
  } finally {
    await disposeApplication(application);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
