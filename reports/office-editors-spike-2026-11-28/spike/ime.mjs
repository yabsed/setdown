// Types real Hangul through ibus-hangul into both engines on the isolated display.
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { launch } from './drive.mjs';
const run = promisify(execFile);
const [deck, book, out] = process.argv.slice(2);
const home = await mkdtemp(path.join(os.tmpdir(), 'spike-ibus-'));
const imeEnv = { ...process.env, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'), GSETTINGS_BACKEND: 'keyfile', GTK_IM_MODULE: 'ibus', XMODIFIERS: '@im=ibus' };
await run('gsettings', ['set', 'org.freedesktop.ibus.engine.hangul', 'initial-input-mode', 'hangul'], { env: imeEnv });
const daemon = spawn('ibus-daemon', ['--xim', '--panel', 'disable'], { env: imeEnv, stdio: 'ignore' });
let address = '';
for (let attempt = 0; attempt < 80 && !address.startsWith('unix:'); attempt++) { await new Promise(resolve => setTimeout(resolve, 150)); address = (await run('ibus', ['address'], { env: imeEnv }).catch(() => ({ stdout: '' }))).stdout.trim(); }
for (let attempt = 0; attempt < 40; attempt++) { await run('ibus', ['engine', 'hangul'], { env: imeEnv }).catch(() => {}); if ((await run('ibus', ['engine'], { env: imeEnv }).catch(() => ({ stdout: '' }))).stdout.trim() === 'hangul') break; await new Promise(resolve => setTimeout(resolve, 150)); }
console.log('ibus', address.slice(0, 30), (await run('ibus', ['engine'], { env: imeEnv })).stdout.trim());
const native = input => run('python3', ['-I', path.join(import.meta.dirname, 'native.py'), JSON.stringify(input)]);
const extra = { GTK_IM_MODULE: 'ibus', XMODIFIERS: '@im=ibus', IBUS_ADDRESS: address };
const record = page => page.evaluate(() => {
  window.imeLog = [];
  for (const type of ['keydown', 'compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input'])
    document.addEventListener(type, event => window.imeLog.push(`${type}${event.key ? ':' + event.key : ''}${event.inputType ? ':' + event.inputType : ''}${event.data ? '=' + event.data : ''}`), true);
});
try {
  if (!process.env.SPIKE_SHEET_STEPS) { // Slides: a caret in the title, then Hangul, a space, Hangul, End.
    const session = await launch('pptx', extra);
    const { page, app } = session;
    await session.open(deck);
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
    const box = await page.evaluate(() => { const node = [...document.querySelectorAll('#stage svg text')].find(item => (item.textContent ?? '').includes('Presentation Title')); const r = node.getBoundingClientRect(); return { x: r.right - 4, y: r.top + r.height / 2 }; });
    await record(page);
    await native({ click: { x: bounds.x + box.x, y: bounds.y + box.y } });
    await page.waitForTimeout(300);
    await native({ steps: ['key:End', 'key:space', 'gksrmfdlqfur', 'key:space', 'dkssud', 'key:End'] });
    await page.waitForTimeout(400);
    const text = await page.evaluate(() => window.spike.text().join(''));
    console.log('SLIDES title after real Hangul typing:', JSON.stringify(text.slice(0, 60)), '| expected to contain', JSON.stringify(' 한글입력 안녕'), '→', text.includes(' 한글입력 안녕'));
    console.log('  events:', (await page.evaluate(() => window.imeLog)).slice(0, 60).join(' '));
    await page.screenshot({ path: `${out}-pptx.png` });
    const state = await page.evaluate(() => window.spike.state().snapshot);
    console.log('  undo available', state.canUndo, 'errors', JSON.stringify(await page.evaluate(() => window.spike.errors)));
    await session.close();
  }
  { // Sheets: click an empty cell, type Hangul, Enter; then a second cell with a space inside.
    const session = await launch('xlsx', extra);
    const { page, app } = session;
    await session.open(book);
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
    await record(page);
    await native({ click: { x: bounds.x + 250, y: bounds.y + 170 } });
    await page.waitForTimeout(300);
    const where = await page.evaluate(() => window.spike.state().snapshot.selectionRef);
    await native({ steps: process.env.SPIKE_SHEET_STEPS ? JSON.parse(process.env.SPIKE_SHEET_STEPS) : ['gksrmf', 'key:Return', 'dkssud', 'key:space', 'gktpdy', 'key:Return'] });
    await page.waitForTimeout(400);
    const read = async (row, col) => { await page.evaluate(([r, c]) => window.spike.call('select', { row: r, col: c }), [row, col]); return page.evaluate(() => window.spike.state().snapshot.activeCell); };
    console.log('SHEETS clicked', where, '| cells after real Hangul typing:', JSON.stringify(await read(7, 1)), JSON.stringify(await read(8, 1)), '| expected 한글 and 안녕 하세요');
    console.log('  events:', (await page.evaluate(() => window.imeLog)).slice(0, 60).join(' '));
    await page.screenshot({ path: `${out}-xlsx.png`, clip: { x: 0, y: 0, width: 700, height: 260 } });
    console.log('  errors', JSON.stringify(await page.evaluate(() => window.spike.errors)));
    await session.close();
  }
} finally { daemon.kill(); await rm(home, { recursive: true, force: true }); }
