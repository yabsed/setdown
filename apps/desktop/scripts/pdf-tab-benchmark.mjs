import { _electron as electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

// Use current production builds; the same candidate-owned fixture and harness
// drive both versions, each with its own installed Electron executable.
const { values } = parseArgs({ options: { baseline: { type: 'string' }, output: { type: 'string' }, runs: { type: 'string', default: '3' } } });
if (!values.baseline || !values.output) throw Error('Required: --baseline /installed/repo --output /new/output/directory');
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 3) throw Error('At least three matched repetitions are required.');
const candidate = realpathSync(fileURLToPath(new URL('../../..', import.meta.url)));
const roots = { baseline: realpathSync(values.baseline), candidate };
if (roots.baseline === roots.candidate) throw Error('Use a separate baseline checkout.');
await mkdir(values.output);
const fixture = await build({ entryPoints: [fileURLToPath(new URL('../test/e2e/pdf-fixture.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm' });
const { pdfFixture } = await import(`data:text/javascript;base64,${Buffer.from(fixture.outputFiles[0].text).toString('base64')}`);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function buildHash(root) {
  const digest = createHash('sha256');
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file); else digest.update(path.relative(root, file)).update(readFileSync(file));
    }
  };
  visit(path.join(root, 'apps/desktop/dist')); visit(path.join(root, 'apps/desktop/dist-electron'));
  return digest.digest('hex');
}
const report = { startedAt: new Date().toISOString(), runs, machine: { platform: os.platform(), cpu: os.cpus()[0]?.model, display: process.env.DISPLAY },
  measurement: 'Tab click through current-page canvas/text verification and one nonempty native capture; includes automation, polling, IPC and capture readback, not monitor presentation.',
  fixtureHash: sha(pdfFixture(100)), harnessHash: sha(readFileSync(fileURLToPath(import.meta.url))),
  versions: Object.fromEntries(Object.entries(roots).map(([label, root]) => [label, { root,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    electron: createRequire(path.join(root, 'apps/desktop/package.json'))('electron/package.json').version,
    buildHash: buildHash(root) }])), samples: [] };
const save = () => writeFile(path.join(values.output, 'comparison.json'), JSON.stringify(report, null, 2));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  for (let repetition = 0; repetition < runs; repetition++) for (const scenario of ['markdown', 'pdf']) {
    for (const label of repetition % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-pdf-latency-'));
      const file = path.join(root, 'target.pdf'), other = path.join(root, scenario === 'pdf' ? 'other.pdf' : 'notes.md');
      await writeFile(file, pdfFixture(100));
      await writeFile(other, scenario === 'pdf' ? pdfFixture(12) : '# Notes\n\nTab switching benchmark.');
      const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
      const app = await electron.launch({ executablePath: createRequire(path.join(roots[label], 'apps/desktop/package.json'))('electron'),
        cwd: path.join(roots[label], 'apps/desktop'), args: ['.', other], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
      try {
        const page = await app.firstWindow();
        await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);
        await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.focus(); window.webContents.focus(); });
        await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFocused())).toBe(true);
        await expect(page.getByRole('tab').filter({ hasText: path.basename(other) })).toBeVisible();
        const pdf = page.getByRole('region', { name: 'PDF reader', exact: true });
        async function verified(pageNumber, name = 'target.pdf') {
          await expect(page.getByRole('tab', { selected: true })).toContainText(name);
          await expect(pdf).toHaveAttribute('data-pdf-page', String(pageNumber));
          await expect(pdf.locator(`[data-page-number="${pageNumber}"] .textLayer`)).toContainText(`PDF page ${pageNumber}`);
          await expect.poll(() => pdf.locator(`[data-page-number="${pageNumber}"] canvas`).evaluate((canvas) => {
            if (!canvas.width || !canvas.height) return false;
            const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && pixels[i] < 200) return true;
            return false;
          })).toBe(true);
          const capture = await app.evaluate(async ({ BrowserWindow }) => {
            const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
            return { empty: image.isEmpty(), bytes: image.toPNG().length };
          });
          if (capture.empty || capture.bytes < 1000) throw Error('Empty native capture');
        }
        if (scenario === 'pdf') await verified(1, 'other.pdf');
        else await expect.poll(() => app.evaluate(async ({ webContents }) => {
          const readers = webContents.getAllWebContents().filter((contents) => contents.getURL().startsWith('marktex-preview://document/'));
          return (await Promise.all(readers.map((contents) => contents.executeJavaScript('document.body.innerText.includes("Tab switching benchmark.")')))).some(Boolean);
        })).toBe(true);
        const initial = performance.now();
        await page.evaluate((file) => window.marktex.openLink(`marktex-resource://file${file}`), file);
        await verified(1);
        const initialMs = performance.now() - initial;
        await pdf.getByRole('spinbutton', { name: 'PDF page number' }).fill('98');
        await pdf.getByRole('spinbutton', { name: 'PDF page number' }).press('Enter');
        await verified(98);
        await expect.poll(() => page.evaluate(async () => (await window.marktex.reloadDocument())?.readingPosition)).toMatchObject({ kind: 'pdf', page: 98 });
        const cycles = [];
        for (let cycle = 0; cycle < 5; cycle++) {
          await page.getByRole('tab').filter({ hasText: path.basename(other) }).click();
          await expect(page.locator('.shell')).toHaveAttribute('data-surface', scenario === 'pdf' ? 'pdf' : 'viewer');
          if (scenario === 'pdf') await verified(1, 'other.pdf');
          const started = performance.now();
          await page.getByRole('tab').filter({ hasText: 'target.pdf' }).click();
          await verified(98);
          cycles.push(performance.now() - started);
        }
        report.samples.push({ repetition: repetition + 1, label, scenario, initialMs, cycles });
        await save();
        console.log(`${label} ${scenario} run ${repetition + 1}: initial ${Math.round(initialMs)}ms, returns ${cycles.map(Math.round).join(', ')}ms`);
      } catch (error) {
        report.failure = { label, scenario, repetition: repetition + 1,
          native: await app.evaluate(({ BrowserWindow, webContents }) => ({ windows: BrowserWindow.getAllWindows().map((window) => ({ title: window.getTitle(), focused: window.isFocused(), visible: window.isVisible() })), focusedContents: webContents.getFocusedWebContents()?.getURL() })).catch(() => null),
          document: await (await app.firstWindow()).evaluate(() => window.marktex.getDocument()).catch(() => null) };
        throw error;
      } finally {
        await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
        await app.close(); await rm(root, { recursive: true, force: true });
      }
    }
  }
  report.summary = [];
  for (const scenario of ['markdown', 'pdf']) for (const label of ['baseline', 'candidate']) {
    const samples = report.samples.filter((sample) => sample.scenario === scenario && sample.label === label);
    if (samples.length !== runs) throw Error('Missing samples');
    report.summary.push({ scenario, label, initial: median(samples.map((s) => s.initialMs)),
      first: median(samples.map((s) => s.cycles[0])), second: median(samples.map((s) => s.cycles[1])),
      warm: median(samples.map((s) => median(s.cycles.slice(2)))) });
  }
  for (const [label, root] of Object.entries(roots)) if (buildHash(root) !== report.versions[label].buildHash)
    throw Error('Application build changed during measurement');
  if (sha(readFileSync(fileURLToPath(import.meta.url))) !== report.harnessHash) throw Error('Harness changed during measurement');
  report.complete = true;
  console.table(report.summary);
} catch (error) { report.error = String(error); throw error; }
finally { await save(); }
