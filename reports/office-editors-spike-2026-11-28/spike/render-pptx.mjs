// Paints every slide of each deck in the bare engine and saves one PNG per slide.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch } from './drive.mjs';
const [listFile, outDir, fontsFile] = process.argv.slice(2);
const decks = (await readFile(listFile, 'utf8')).split('\n').filter(Boolean);
const fonts = fontsFile ? JSON.parse(await readFile(fontsFile, 'utf8')) : null;
const options = fonts ? { faces: fonts.faces, substitutions: fonts.substitutions, files: await Promise.all(fonts.files.map(async file => (await readFile(file)).toString('base64'))) } : {};
const session = await launch('pptx');
const report = [];
try {
  await session.page.setViewportSize?.({ width: 1400, height: 900 });
  for (const deck of decks) {
    const name = path.basename(deck).replace(/\.pptx?m?$/i, '');
    const folder = path.join(outDir, name);
    await mkdir(folder, { recursive: true });
    const opened = await session.open(deck, options);
    const row = { deck: path.basename(deck), ms: opened.ms, status: opened.snapshot?.status, slides: opened.count ?? 0, substituted: opened.snapshot?.substitutedFonts, fontErrors: opened.fontErrors, perSlide: [] };
    // Fonts land after the first layout; wait until the engine stops resolving them.
    for (let wait = 0; wait < 100; wait++) { const state = await session.page.evaluate(() => window.spike.state().fonts); if (!state?.resolving) break; await session.page.waitForTimeout(50); }
    // The first twelve slides of a deck are enough to compare renderers.
    for (let index = 0; index < Math.min(row.slides, 12); index++) {
      const box = await session.page.evaluate(i => window.spike.slide(i), index);
      if (!box) { row.perSlide.push(null); continue; }
      await session.page.screenshot({ path: path.join(folder, `editor-${String(index + 1).padStart(2, '0')}.png`), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
      row.perSlide.push({ texts: box.texts, images: box.images, families: box.families });
    }
    row.after = await session.page.evaluate(() => { const s = window.spike.state(); return { substituted: s.snapshot.substitutedFonts, fonts: s.fonts, fontErrors: s.fontErrors }; });
    report.push(row);
    console.log(row.deck, row.status, row.slides, 'slides', row.ms, 'ms');
  }
  report.push({ pageErrors: await session.page.evaluate(() => window.spike.errors), driver: session.messages });
} finally { await session.close(); }
await writeFile(path.join(outDir, 'editor-render.json'), JSON.stringify(report, null, 1));
