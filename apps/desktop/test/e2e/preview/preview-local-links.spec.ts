import { electron } from '../../support/electron/electron-app';
import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { previews } from '../../support/preview/preview-view';
import { disposeApplication } from '../../support/electron/electron-app';
import { savePastedPng } from '../../../src/main/documents/pasted-image';
import { markdownDestinationForFile } from '../../../src/main/documents/markdown-link';
import sharp from 'sharp';

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

test('generated image and document links preserve reserved characters through the real preview', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-reserved#%25-links-'));
  const source = path.join(root, 'notes#1.md'), target = path.join(root, 'note#part%25.md');
  const image = await savePastedPng(source, await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer());
  await writeFile(source, `${image.markdown}\n\n[Reserved](<${markdownDestinationForFile(source, target)}>)`);
  await writeFile(target, '# Reserved target\n\nCorrect document.');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', source], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow(), reading = previews(app);
    try {
      await expect.poll(() => reading.evaluate("document.querySelector('.markdown-preview img')?.naturalWidth || 0")).toBe(1);
    } finally {
      const evidence = testInfo.outputPath('reserved-links.json');
      await writeFile(evidence, JSON.stringify({
        markdown:image.markdown, preview:await reading.evaluate("({html:document.querySelector('.markdown-preview')?.innerHTML,base:document.baseURI,images:[...document.images].map(i=>({src:i.src,complete:i.complete,width:i.naturalWidth}))})"),
      }, null, 2));
      await testInfo.attach('reserved-links', { contentType:'application/json', path:evidence });
    }
    await reading.evaluate("[...document.querySelectorAll('a')].find(a => a.textContent === 'Reserved').click()");
    await expect(page.locator('.document-tab[aria-selected="true"] .tab-name')).toHaveText('note#part%25.md');
    await expect.poll(() => reading.evaluate("document.querySelector('.markdown-preview')?.textContent || ''")).toContain('Correct document.');
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
