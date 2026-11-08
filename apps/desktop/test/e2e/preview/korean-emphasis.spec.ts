import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, test } from '@playwright/test';
import { electron, disposeApplication } from '../../support/electron/electron-app';
import { previews } from '../../support/preview/preview-view';

const source = '# 한국어 강조\n\n**\'정책\'**이 중요하다. **(정책)**은 필요하다. **90%**가 증가했다.\n\n`**90%**가`\n\n```text\n**(정책)**이\n```\n';
for (const review of [false, true]) test(`Korean strong punctuation renders in ${review ? 'Git review' : 'Markdown and notebook'} without changing source`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-korean-')), file = path.join(root, 'korean.md');
  await writeFile(file, source);
  if (review) {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test'); git('add', '.'); git('commit', '-m', 'fixture');
    await writeFile(file, source + '\n**“추가”**도 표시한다.\n');
  }
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const app = await electron.launch({ args: ['.', file], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow(), reader = previews(app);
    await expect.poll(() => reader.hasVisible()).toBe(true);
    if (review) {
      await page.evaluate(root => window.marktex.restoreProjectFolder(root), root); await page.reload();
      await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
      await page.getByRole('button', { name: 'Source Control', exact: true }).click();
      await page.locator('.scm-group').filter({ has: page.getByText('CHANGES', { exact: true }) }).getByRole('button', { name: 'korean.md', exact: true }).click();
      await page.getByRole('button', { name: 'View Rendered Diff', exact: true }).click();
    }
    const strongSelector = review ? '.setdown-rendered-diff-split strong' : '.markdown-preview strong';
    await expect.poll(() => reader.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(strongSelector)}), node => node.textContent).sort()`))
      .toEqual((review ? ["'정책'", '(정책)', '90%', "'정책'", '(정책)', '90%', '“추가”'] : ["'정책'", '(정책)', '90%']).sort());
    expect(await reader.evaluate('document.querySelectorAll("code strong").length')).toBe(0);
    expect(await readFile(file, 'utf8')).toBe(source + (review ? '\n**“추가”**도 표시한다.\n' : ''));
    if (!review) {
      await page.locator('.mode-toggle').click();
      expect(await page.evaluate(async () => (await window.marktex.getDocument())?.text)).toBe(source);
      const notebook = path.join(root, 'korean.ipynb');
      const original = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ id: 'intro', cell_type: 'markdown', metadata: {}, source }] });
      await writeFile(notebook, original);
      await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), notebook);
      await expect(page.locator('.cell-markdown strong')).toHaveText(["'정책'", '(정책)', '90%']);
      await expect(page.locator('.cell-markdown code strong')).toHaveCount(0);
      expect(await readFile(notebook, 'utf8')).toBe(original);
      await page.screenshot({ path: test.info().outputPath('korean-notebook.png') });
    }
  } finally { await disposeApplication(app); await rm(root, { recursive: true, force: true }); }
});
