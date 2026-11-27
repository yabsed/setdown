// Opens every document of a list in the bare engine, saves it unchanged, and opens what was saved.
// One line of JSON per document. A document that hangs or kills the page costs one relaunch.
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch } from './drive.mjs';
const [kind, listFile, outDir] = process.argv.slice(2);
const files = (await readFile(listFile, 'utf8')).split('\n').filter(Boolean);
await mkdir(path.join(outDir, 'saved'), { recursive: true });
const log = path.join(outDir, `${kind}-corpus.jsonl`);
await writeFile(log, '');
const LIMIT_MS = 90_000, MAX_BYTES = 40 * 1024 * 1024;
const within = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Error(`no answer in ${ms} ms`)), ms))]);
const brief = report => kind === 'pptx'
  ? { status: report.snapshot?.status, count: report.count, readOnly: report.snapshot?.readOnlyReason ?? null, substituted: (report.snapshot?.substitutedFonts ?? []).length, fontErrors: report.fontErrors?.length ?? 0 }
  : { status: report.snapshot?.status, count: report.count, failureCode: report.snapshot?.failure?.code ?? report.result?.failure?.code ?? null, stale: report.snapshot?.stale ?? null };
let session = await launch(kind), seen = 0;
for (const file of files) {
  const row = { file: path.basename(file), bytes: (await stat(file)).size };
  if (row.bytes > MAX_BYTES) { row.skipped = 'larger than 40 MiB'; await appendFile(log, JSON.stringify(row) + '\n'); continue; }
  try {
    const first = await within(session.open(file), LIMIT_MS);
    Object.assign(row, { ms: first.ms, paintedMs: first.paintedMs, heapMiB: first.heapMiB, failure: first.failure, ...brief(first) });
    if (row.status === 'ready') {
      const saved = await within(session.page.evaluate(() => window.spike.save()), LIMIT_MS);
      if (!saved) row.save = 'refused';
      else {
        const target = path.join(outDir, 'saved', row.file);
        await writeFile(target, Buffer.from(saved.base64, 'base64'));
        row.saveMs = saved.ms; row.savedBytes = (await stat(target)).size;
        const again = await within(session.open(target), LIMIT_MS);
        row.again = { ms: again.ms, failure: again.failure, ...brief(again) };
      }
    }
    const errors = await session.page.evaluate(() => window.spike.errors);
    row.pageErrors = errors.slice(seen, seen + 4); seen = errors.length;
  } catch (error) {
    row.crash = String(error.message).slice(0, 200);
    await session.close(); session = await launch(kind); seen = 0;
  }
  await appendFile(log, JSON.stringify(row) + '\n');
}
await session.close();
console.log('done', files.length);
