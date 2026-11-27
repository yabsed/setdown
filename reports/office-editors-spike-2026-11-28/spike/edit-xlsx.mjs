// Edits a workbook with real key events in Electron: a number under a SUM, a new formula, Korean text; then undo, redo, save.
import { writeFile } from 'node:fs/promises';
import { launch } from './drive.mjs';
const [file, out] = process.argv.slice(2);
const session = await launch('xlsx');
const { page } = session;
const brief = () => page.evaluate(() => { const s = window.spike.state().snapshot; return { cell: s.activeCell, ref: s.selectionRef, stale: s.stale, editing: s.editing, canUndo: s.canUndo, canRedo: s.canRedo, refusal: s.refusal, active: document.activeElement?.tagName }; });
const at = async (row, col) => { await page.evaluate(([r, c]) => window.spike.call('select', { row: r, col: c }), [row, col]); return (await brief()).cell; };
try {
  const opened = await session.open(file);
  console.log('opened', opened.ms, 'ms', opened.snapshot.status, 'stale', opened.snapshot.stale, 'fonts', JSON.stringify(opened.fonts).slice(0, 300));
  for (const [row, col] of [[1, 0], [2, 0], [3, 0], [0, 1]]) console.log('cell', JSON.stringify(await at(row, col)));
  await page.screenshot({ path: `${out}-before.png`, clip: { x: 0, y: 0, width: 700, height: 260 } });
  await page.evaluate(() => window.spike.call('focus'));
  await at(1, 0);
  await page.keyboard.type('40'); await page.keyboard.press('Enter');
  console.log('after typing 40 into A2', JSON.stringify(await brief()));
  console.log('A2', JSON.stringify(await at(1, 0)), 'A4', JSON.stringify(await at(3, 0)));
  await at(0, 1);
  await page.keyboard.type('=A2+1'); await page.keyboard.press('Enter');
  console.log('after typing =A2+1 into B1', JSON.stringify(await brief()), 'B1', JSON.stringify(await at(0, 1)));
  await at(0, 2);
  await page.keyboard.insertText('한글 메모'); await page.keyboard.press('Enter');
  console.log('C1', JSON.stringify(await at(0, 2)));
  await page.screenshot({ path: `${out}-edited.png`, clip: { x: 0, y: 0, width: 700, height: 260 } });
  await page.keyboard.press('Control+z');
  console.log('after undo: C1', JSON.stringify(await at(0, 2)), JSON.stringify(await brief()));
  await page.keyboard.press('Control+y');
  console.log('after redo: C1', JSON.stringify(await at(0, 2)));
  const saved = await page.evaluate(() => window.spike.save());
  await writeFile(`${out}.xlsx`, Buffer.from(saved.base64, 'base64'));
  const again = await session.open(`${out}.xlsx`);
  console.log('reopened', again.snapshot.status, 'stale', again.snapshot.stale);
  for (const [row, col] of [[1, 0], [3, 0], [0, 1], [0, 2]]) console.log('cell', JSON.stringify(await at(row, col)));
  await page.screenshot({ path: `${out}-reopened.png`, clip: { x: 0, y: 0, width: 700, height: 260 } });
  console.log('page errors', JSON.stringify(await page.evaluate(() => window.spike.errors)).slice(0, 600), JSON.stringify(session.messages).slice(0, 300));
} finally { await session.close(); }
