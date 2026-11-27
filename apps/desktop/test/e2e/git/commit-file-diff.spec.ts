import { expect, test, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';

const exec = promisify(execFile);
// A paper as it is kept in a repository: LaTeX sources beside the PDF they build.
const method = (claim: string, bound: string) => ['\\section{Method}', '', `We ${claim} the model on the held-out split.`, '',
  ...Array.from({ length: 60 }, (_, index) => `Line ${index + 1} of the derivation stays as it was.`), '',
  `The bound is $${bound}$.`, ''].join('\n');
// The smallest file a PDF reader opens: empty pages of the given width.
const pdf = (width: number, pages = 3) => {
  const kids = Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(' ');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 400] >>`)];
  let body = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'; const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body, 'latin1')); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
};
const size = (page: Page) => page.evaluate(() => {
  const host = document.querySelector<HTMLElement>('.review-content:not(.inactive) .git-diff-editor')!;
  const editor = host.querySelector<HTMLElement>('.monaco-diff-editor')!, modified = host.querySelector<HTMLElement>('.editor.modified .monaco-editor')!;
  return { host: Math.round(host.getBoundingClientRect().height), editor: Math.round(editor.getBoundingClientRect().height),
    modified: Math.round(modified.getBoundingClientRect().height), tall: host.getBoundingClientRect().height > 200 };
});

test('a file of a commit is compared in full: source at the height of its tab, PDF side by side, binaries with their sizes', async () => {
  test.setTimeout(180_000);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'setdown-commit-file-'));
  const root = path.join(temporary, 'paper');
  const git = (...args: string[]) => exec('git', args, { cwd: root });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await mkdir(path.join(root, 'sections'), { recursive: true });
    await exec('git', ['init', '-b', 'main', root]);
    await git('config', 'user.name', 'Paper Test'); await git('config', 'user.email', 'paper@example.test');
    const tex = path.join(root, 'sections', '2-method.tex');
    await writeFile(tex, method('train', 'O(n)'));
    await writeFile(path.join(root, 'main.pdf'), pdf(300));
    await writeFile(path.join(root, 'legacy.txt'), Buffer.from('caf\xe9 au lait\n', 'latin1'));
    await writeFile(path.join(root, 'figures.zip'), Buffer.from([80, 75, 3, 4, 0, 0, 0, 0]));
    await writeFile(path.join(root, 'main.tex'), '\\documentclass{article}\n\\begin{document}\n\\input{sections/2-method}\n\\end{document}\n');
    await git('add', '.'); await git('commit', '-m', 'First draft');
    await writeFile(tex, method('evaluate', 'O(n \\log n)'));
    await writeFile(path.join(root, 'main.pdf'), pdf(420));
    await writeFile(path.join(root, 'legacy.txt'), Buffer.from('caf\xe9 cr\xe8me\n', 'latin1'));
    await writeFile(path.join(root, 'figures.zip'), Buffer.from([80, 75, 3, 4, 0, 0, 0, 0, 1, 2, 3, 4]));
    await git('commit', '-am', 'Revise the method');
    const second = (await git('rev-parse', 'HEAD')).stdout.trim();
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
    // The paper's main file is open first, so the code editor is already loaded when the commit's file is clicked.
    app = await electron.launch({ args: ['.', path.join(root, 'main.tex')], env: { ...env, XDG_CONFIG_HOME: path.join(temporary, 'config') } });
    const page = await app.firstWindow(); const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(async folder => {
      await window.marktex.restoreProjectFolder(folder);
      sessionStorage.setItem('setdown:git-graph-panel', JSON.stringify({ expanded: true, ratio: .55 }));
    }, root);
    await page.reload(); await focusApplication(app);
    await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('documentclass');
    await page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await page.getByRole('button', { name: 'Source Control', exact: true }).click();
    const graph = page.locator('web-git-graph');
    await expect(graph.locator('.row')).toHaveCount(2);
    await graph.locator(`.row[data-oid="${second}"]`).click();
    const file = (name: string) => graph.locator('.tree-file').filter({ hasText: name });

    await file('2-method.tex').click();
    const modified = page.locator('.review-content:not(.inactive) .modified-in-monaco-diff-editor');
    await expect(modified.locator('.view-lines:not([monaco-view-zone])')).toContainText('evaluate');
    await page.screenshot({ path: test.info().outputPath('commit-tex.png') });
    await expect.poll(() => size(page)).toMatchObject({ tall: true });
    let measured = await size(page);
    expect(measured.editor).toBe(measured.host);
    expect(measured.modified).toBeGreaterThan(measured.host - 40);
    await expect(modified.locator('.view-line').filter({ hasText: 'evaluate' })).toBeVisible();

    // The comparison follows the window's height in both directions.
    for (const height of [520, 860]) {
      await app.evaluate(({ BrowserWindow }, height) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(window.getContentSize()[0], height); }, height);
      await expect.poll(async () => { const now = await size(page); return now.tall && now.editor === now.host && now.host !== measured.host; }).toBe(true);
      measured = await size(page);
    }

    // A source file that is not UTF-8 is compared too, and says how it was read.
    await file('legacy.txt').click();
    await expect(modified.locator('.view-lines:not([monaco-view-zone])')).toContainText('cr\uFFFDme');
    await expect(page.locator('.review-content:not(.inactive) .git-reading-note')).toContainText('not valid UTF-8');
    await expect.poll(async () => { const now = await size(page); return now.tall && now.editor === now.host; }).toBe(true);

    // The PDF the sources build: both versions in the PDF reader, turning pages together.
    await file('main.pdf').click();
    const comparison = page.locator('.review-content:not(.inactive)').getByRole('region', { name: 'Document comparison', exact: true });
    const before = comparison.getByRole('region', { name: 'Original document', exact: true });
    const after = comparison.getByRole('region', { name: 'Modified document', exact: true });
    await expect(before.locator('.pdf-surface')).toHaveAttribute('data-pdf-pages', '3');
    await expect(after.locator('.pdf-surface')).toHaveAttribute('data-pdf-pages', '3');
    await expect(before).toContainText(/^Original/); await expect(after).toContainText(second.slice(0, 8));
    await expect(comparison).not.toContainText('Binary');
    const pane = await after.locator('.pdf-host').boundingBox();
    expect(pane!.height).toBeGreaterThan(200);
    await after.getByRole('button', { name: 'Next PDF page' }).click();
    await expect(after.locator('.pdf-surface')).toHaveAttribute('data-pdf-page', '2');
    await expect(before.locator('.pdf-surface')).toHaveAttribute('data-pdf-page', '2');
    await comparison.getByLabel('Turn pages together').uncheck();
    await before.getByRole('button', { name: 'Previous PDF page' }).click();
    await expect(before.locator('.pdf-surface')).toHaveAttribute('data-pdf-page', '1');
    await expect(after.locator('.pdf-surface')).toHaveAttribute('data-pdf-page', '2');
    await page.screenshot({ path: test.info().outputPath('commit-pdf.png') });

    // A file with no reader says what it is and how each version differs in size.
    await file('figures.zip').click();
    const notice = page.locator('.review-content:not(.inactive)').getByRole('status', { name: 'Comparison not shown' });
    await expect(notice).toContainText('Binary file');
    await expect(notice).toContainText('8 B'); await expect(notice).toContainText('12 B'); await expect(notice).toContainText('4 B larger');
    await page.screenshot({ path: test.info().outputPath('commit-binary.png') });
    expect(errors).toEqual([]);
  } finally {
    if (app) await disposeApplication(app);
    await rm(temporary, { recursive: true, force: true });
  }
});
