const { _electron: electron } = require('@playwright/test');
const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const desktop = path.resolve(process.env.SETDOWN_PROBE_APP || 'apps/desktop');
const executablePath = createRequire(path.join(desktop, 'package.json'))('electron');
const source = process.argv[2];
if (!source) throw Error('Pass the directory containing notebook copies to inspect.');
const destination = __dirname;
const captures = path.join(os.tmpdir(), 'setdown-notebook-diagnosis-2026-11-06');
const names = process.argv.length > 3 ? process.argv.slice(3) : ['00-데이터-준비.ipynb', '02-파형과-측정.ipynb', '09-작은-CNN-대조.ipynb'];
const results = [];

async function inspect(app, page, file, start) {
  await page.waitForFunction(() => {
    const scroll = document.querySelector('.notebook-scroll');
    return scroll && !scroll.classList.contains('preparing');
  }, undefined, { timeout: 30000 });
  const readyMs = Date.now() - start;
  const initial = await page.evaluate(() => {
    const el = document.querySelector('.notebook-scroll');
    return { cells: document.querySelectorAll('.notebook-cell').length,
      editors: document.querySelectorAll('.notebook-cell .monaco-editor').length,
      images: document.querySelectorAll('.notebook-outputs img').length,
      scrollHeight: el.scrollHeight, viewport: el.clientHeight };
  });
  const imageCells = await fs.readFile(file, 'utf8').then(JSON.parse).then(nb => nb.cells
    .filter(cell => cell.outputs?.some(output => Object.keys(output.data || {}).some(mime => mime.startsWith('image/'))))
    .map(cell => cell.id));
  console.log(JSON.stringify({ phase: 'first-paint', file: path.basename(file), readyMs, initial }));
  const imageSamples = [];
  const geometry = id => page.evaluate(id => {
    const cell = document.querySelector(`[data-cell-id="${id}"]`), scroll = document.querySelector('.notebook-scroll');
    const image = cell.querySelector('.notebook-outputs img'), r=cell.getBoundingClientRect(), s=scroll.getBoundingClientRect(), ir=image?.getBoundingClientRect();
    return { scrollTop: scroll.scrollTop, cellTop: r.top, cellBottom: r.bottom, viewportTop: s.top, viewportBottom: s.bottom,
      mounted: !!image, decoded: !!image?.complete && image.naturalWidth > 0,
      imageTop: ir?.top, imageBottom: ir?.bottom, editor: !!cell.querySelector('.monaco-editor') };
  }, id);
  for (const id of imageCells.slice(0, 2)) {
    await page.locator(`[data-cell-id="${id}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const afterJump = await geometry(id), samples = [];
    const bounds = await page.locator('.notebook-scroll').boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const begin=Date.now(); let visible=false;
    for (let n=0;n<80;n++) {
      const state=await geometry(id); samples.push(state);
      if (state.decoded && state.imageBottom > state.viewportTop && state.imageTop < state.viewportBottom) { visible=true; break; }
      const top=state.imageTop ?? state.cellTop;
      const direction=top < state.viewportTop ? -1 : 1;
      await page.mouse.wheel(0,direction * 300); await page.waitForTimeout(100);
    }
    const sample={id,afterJump,visible,scrollToImageMs:Date.now()-begin,samples};
    imageSamples.push(sample);
    console.log(JSON.stringify({ phase:'image-scroll',file:path.basename(file),...sample }));
  }
  return { readyMs, initial, imageSamples, markdownRequests: await app.evaluate(() => globalThis.__notebookProbe || []) };
}

async function run(name, warm) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setdown-notebook-probe-'));
  const file = path.join(root, name), blank = path.join(root, 'blank.txt');
  await fs.copyFile(path.join(source, name), file);
  await fs.writeFile(blank, 'Notebook opening measurement\n');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const start = Date.now();
  const app = await electron.launch({ executablePath, cwd: desktop, args: ['.', warm ? blank : file],
    chromiumSandbox: true, env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ ipcMain }) => {
      globalThis.__notebookProbe = [];
      const handlers = ipcMain._invokeHandlers;
      for (const [channel, handler] of handlers) {
        if (!channel.includes('notebook:markdown')) continue;
        handlers.set(channel, async (...args) => {
          const at = Date.now();
          try { return await handler(...args); }
          finally { globalThis.__notebookProbe.push({ channel, at, durationMs: Date.now() - at }); }
        });
      }
    });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus();
    });
    let opening = start;
    if (warm) {
      await page.locator('.editor-surface .monaco-editor').waitFor();
      opening = Date.now();
      await page.evaluate(file => window.marktex.openLink(`marktex-resource://file${file}`), file);
    }
    const measured = await inspect(app, page, file, opening);
    await page.screenshot({ path: path.join(captures, `${name.slice(0, 2)}-${warm ? 'warm' : 'cold'}.png`) });
    const result = { name, warmMonaco: warm, ...measured };
    results.push(result); console.log(JSON.stringify(result));
  } finally {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close(); await fs.rm(root, { recursive: true, force: true });
    await fs.writeFile(path.join(destination, process.env.SETDOWN_PROBE_REPORT || 'measurements.json'), JSON.stringify(results, null, 2) + '\n');
  }
}

(async () => {
  await fs.mkdir(captures, { recursive: true });
  for (const name of names) for (const warm of [false, true]) await run(name, warm);
})().catch(error => { console.error(error); process.exitCode = 1; });
