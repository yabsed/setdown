import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from '../../support/browser/browser-fixture';

test('bookmark HTML imports folders atomically, pages beyond 100, survives restart and undoes only its own batch', async () => {
  const f = await fixture(false);
  try {
    const url = 'https://example.com/existing';
    await f.page.evaluate(url => window.marktex.browser.bookmark(url, 'Existing', true), url);
    const file = path.join(f.root, 'bookmarks.html');
    await writeFile(file, '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>한글 Folder</H3><DL>' + Array.from({ length: 205 }, (_, i) => `<DT><A HREF="https://example.com/${i}">Bookmark ${i}</A>`).join('') + `<DT><A HREF="${url}">Same URL, separate folder</A><DT><A HREF="javascript:alert(1)">Skip</A></DL></DL>`);
    await f.app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
      dialog.showMessageBox = (async (_owner, options) => { if (!options?.message?.includes('206')) throw Error('Import preview count is wrong'); return { response: 0, checkboxChecked: false }; }) as typeof dialog.showMessageBox;
    }, file);
    const result = await f.page.evaluate(() => window.marktex.browser.importBookmarks());
    expect(result).toMatchObject({ added: 206, skipped: 1 });
    const folder = await f.page.evaluate(batch => window.marktex.browser.bookmarks(batch, '', 0), result!.batch);
    expect(folder.nodes.map(node => node.title)).toEqual(['한글 Folder']);
    const first = await f.page.evaluate(id => window.marktex.browser.bookmarks(id, '', 0), folder.nodes[0].id);
    expect(first.nodes).toHaveLength(100); expect(first.total).toBe(206);
    const last = await f.page.evaluate(id => window.marktex.browser.bookmarks(id, '', 200), folder.nodes[0].id);
    expect(last.nodes).toHaveLength(6); expect(last.nodes[0].title).toBe('Bookmark 200');
    expect(await f.page.evaluate(() => window.marktex.browser.places('', 'history'))).toEqual([]);
    await f.restart();
    expect(await f.page.evaluate(id => window.marktex.browser.bookmarks(id, '', 200), folder.nodes[0].id)).toEqual(last);
    await f.page.evaluate(batch => window.marktex.browser.undoBookmarkImport(batch), result!.batch);
    const remaining = await f.page.evaluate(() => window.marktex.browser.bookmarks('', '', 0));
    expect(remaining.nodes.map(node => node.title)).toEqual(['Existing']);
    expect((await f.page.evaluate(() => window.marktex.browser.places('', 'bookmarks'))).map(place => place.url)).toEqual([url]);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
test('cancelled import leaves existing bookmarks unchanged', async () => {
  const f = await fixture(false);
  try {
    await f.app.evaluate(({ dialog }) => { dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog; });
    expect(await f.page.evaluate(() => window.marktex.browser.importBookmarks())).toBeNull();
    expect((await f.page.evaluate(() => window.marktex.browser.bookmarks('', '', 0))).nodes).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
test('bookmarks export as the HTML file other browsers import, and import back with their folders', async () => {
  const f = await fixture(false);
  try {
    const source = path.join(f.root, 'source.html'), exported = path.join(f.root, 'exported.html');
    await writeFile(source, '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>읽을 것 &amp; 문서</H3><DL><DT><A HREF="https://example.com/a?x=1&amp;y=2">첫 문서</A><DT><H3>Nested</H3><DL><DT><A HREF="https://example.com/deep">Deep</A></DL></DL></DL>');
    await f.app.evaluate(({ dialog }, files) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [(globalThis as { importFrom?: string }).importFrom ?? files.source] })) as typeof dialog.showOpenDialog;
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
      dialog.showSaveDialog = (async (_owner: unknown, options: Electron.SaveDialogOptions) => {
        if (!/^bookmarks_\d{4}_\d{2}_\d{2}\.html$/.test(String(options.defaultPath))) throw Error(`Unexpected default name: ${options.defaultPath}`);
        return { canceled: false, filePath: files.exported };
      }) as typeof dialog.showSaveDialog;
    }, { source, exported });
    await expect(f.page.evaluate(() => window.marktex.browser.exportBookmarks())).rejects.toThrow('no bookmarks to export');
    await f.page.evaluate(() => window.marktex.browser.bookmark('https://example.com/starred', 'Starred "page"', true));
    const first = await f.page.evaluate(() => window.marktex.browser.importBookmarks());
    await f.page.getByRole('button', { name: 'Toggle Folder Tools' }).click();
    await f.page.getByRole('button', { name: 'Browser', exact: true }).click();
    await f.page.getByRole('button', { name: 'Export bookmarks…', exact: true }).click();
    await expect(f.page.locator('.bookmarks [role="status"]')).toContainText(`Exported 3 bookmarks to ${exported}`);
    const html = await readFile(exported, 'utf8');
    expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true);
    expect(html).toContain('<H3>읽을 것 &amp; 문서</H3>');
    expect(html).toContain('<A HREF="https://example.com/a?x=1&amp;y=2">첫 문서</A>');
    expect(html).toContain('<A HREF="https://example.com/starred">Starred &quot;page&quot;</A>');
    // Importing the exported file into an emptied library restores the same tree.
    await f.page.evaluate(batch => window.marktex.browser.undoBookmarkImport(batch), first!.batch);
    await f.page.evaluate(() => window.marktex.browser.bookmark('https://example.com/starred', 'Starred "page"', false));
    expect((await f.page.evaluate(() => window.marktex.browser.bookmarks('', '', 0))).nodes).toEqual([]);
    await f.app.evaluate((_electron, file) => { (globalThis as { importFrom?: string }).importFrom = file; }, exported);
    const again = await f.page.evaluate(() => window.marktex.browser.importBookmarks());
    expect(again).toMatchObject({ added: 3, skipped: 0 });
    const titles = async (parent: string) => (await f.page.evaluate(id => window.marktex.browser.bookmarks(id, '', 0), parent)).nodes;
    const top = await titles(again!.batch);
    expect(top.map(node => node.title)).toEqual(['Starred "page"', expect.stringMatching(/^Imported /)]);
    const folder = await titles((await titles(top[1].id))[0].id);
    expect(folder.map(node => node.title)).toEqual(['첫 문서', 'Nested']);
    expect((await titles(folder[1].id)).map(node => [node.title, node.url])).toEqual([['Deep', 'https://example.com/deep']]);
    expect(f.errors).toEqual([]);
  } finally { await f.dispose(); }
});
