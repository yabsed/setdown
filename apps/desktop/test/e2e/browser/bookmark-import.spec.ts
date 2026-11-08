import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
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
