// Paints the first screen of each workbook in the bare engine, with the packaged fonts and optionally with host fonts.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch } from './drive.mjs';
const [listFile, outDir, fontsFile] = process.argv.slice(2);
const books = (await readFile(listFile, 'utf8')).split('\n').filter(Boolean);
const fonts = fontsFile ? JSON.parse(await readFile(fontsFile, 'utf8')) : null;
const options = fonts ? { faces: fonts.faces, files: await Promise.all(fonts.files.map(async file => (await readFile(file)).toString('base64'))) } : {};
await mkdir(outDir, { recursive: true });
const session = await launch('xlsx');
const report = [];
try {
  for (const book of books) {
    const opened = await session.open(book, options);
    await session.page.waitForTimeout(300);
    await session.page.screenshot({ path: path.join(outDir, `${path.basename(book)}.png`), clip: { x: 0, y: 0, width: 1000, height: 520 } });
    const faces = opened.fonts?.faces ?? [];
    report.push({ book: path.basename(book), ms: opened.ms, status: opened.snapshot?.status, failure: opened.snapshot?.failure, fontReport: { ...opened.fonts, faces: `${faces.length} faces`, origins: [...new Set(faces.map?.(face => face.origin) ?? [])] } });
    console.log(JSON.stringify(report.at(-1)).slice(0, 700));
  }
  console.log('errors', JSON.stringify(await session.page.evaluate(() => window.spike.errors)).slice(0, 500));
} finally { await session.close(); }
await writeFile(path.join(outDir, 'render.json'), JSON.stringify(report, null, 1));
