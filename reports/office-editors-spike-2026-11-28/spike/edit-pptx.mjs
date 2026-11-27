// Edits a deck with real mouse and keyboard events in Electron: type into a text box, undo, redo, save.
import { writeFile } from 'node:fs/promises';
import { launch } from './drive.mjs';
const [file, needle, out] = process.argv.slice(2);
const session = await launch('pptx');
const { page } = session;
const brief = async () => page.evaluate(() => { const s = window.spike.state().snapshot; return { selection: s.selection, canUndo: s.canUndo, canRedo: s.canRedo, revision: s.revision, mode: s.mode, active: document.activeElement?.tagName, activeClass: document.activeElement?.className?.toString?.().slice(0, 60) }; });
const texts = () => page.evaluate(() => window.spike.text().join(' | ').slice(0, 400));
try {
  const opened = await session.open(file);
  console.log('opened', opened.ms, 'ms', opened.snapshot.status, 'slides', opened.snapshot.slides.length);
  console.log('texts', await texts());
  const box = await page.evaluate(text => {
    const node = [...document.querySelectorAll('#stage svg text, #stage svg tspan')].find(item => (item.textContent ?? '').includes(text));
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height };
  }, needle);
  console.log('target', box);
  await page.mouse.click(box.x, box.y);
  console.log('after click', JSON.stringify(await brief()));
  await page.mouse.dblclick(box.x, box.y);
  console.log('after double click', JSON.stringify(await brief()));
  await page.keyboard.press('End');
  await page.keyboard.type(' edited 123');
  console.log('after typing', JSON.stringify(await brief()));
  console.log('texts', await texts());
  await page.keyboard.insertText(' 한글 입력');
  console.log('after insertText', await texts());
  await page.screenshot({ path: `${out}-typed.png` });
  await page.keyboard.press('Escape');
  console.log('after escape', JSON.stringify(await brief()));
  const typed = await texts();
  for (let step = 0; step < 3; step++) await page.keyboard.press('Control+z');
  console.log('after 3 undo', JSON.stringify(await brief()), '\n ', await texts());
  let undone = 3;
  while ((await brief()).canUndo && undone < 60) { await page.keyboard.press('Control+z'); undone++; }
  console.log('undo steps until clean', undone, await texts());
  let redone = 0;
  while ((await brief()).canRedo && redone < 60) { await page.keyboard.press('Control+y'); redone++; }
  console.log('redo steps', redone, 'same as typed', (await texts()) === typed, '\n ', await texts());
  const saved = await page.evaluate(() => window.spike.save());
  await writeFile(`${out}.pptx`, Buffer.from(saved.base64, 'base64'));
  console.log('saved', saved.ms, 'ms');
  const again = await session.open(`${out}.pptx`);
  console.log('reopened', again.snapshot.status, await texts());
  console.log('page errors', JSON.stringify(await page.evaluate(() => window.spike.errors)).slice(0, 800), JSON.stringify(session.messages).slice(0, 400));
} finally { await session.close(); }
