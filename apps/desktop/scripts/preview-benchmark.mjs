import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { compareRuns, summarizeRun } from './preview-benchmark-compare.mjs';

const { values } = parseArgs({ options: {
  baseline: { type: 'string' }, runs: { type: 'string', default: '5' },
  output: { type: 'string' }, relative: { type: 'string', default: '0.25' },
  'absolute-ms': { type: 'string', default: '50' },
  'skip-build': { type: 'boolean', default: false }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('npm run bench:preview -- --baseline /absolute/path/to/baseline-repo [--runs 5] [--output /path/to/new-results] [--relative 0.25] [--absolute-ms 50] [--skip-build]');
  process.exit(0);
}
if (!values.baseline) throw Error('--baseline must identify a separate installed repository checkout');
const runs = Number(values.runs);
const thresholds = { relative: Number(values.relative), absoluteMs: Number(values['absolute-ms']) };
if (!Number.isInteger(runs) || runs < 3) throw Error('--runs must be an integer >= 3 (default 5)');
if (Object.values(thresholds).some(value => !Number.isFinite(value) || value <= 0)) throw Error('Invalid regression tolerances');
const candidate = realpathSync(fileURLToPath(new URL('../../..', import.meta.url)));
const baseline = realpathSync(values.baseline);
if (baseline === candidate) throw Error('Baseline and candidate must be separate checkouts');
const desktop = root => path.join(root, 'apps/desktop');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtureHash = root => hash(readFileSync(path.join(desktop(root), 'test/fixtures/sample.md')));
const output = path.resolve(values.output ?? path.join(candidate, 'test-results', `preview-benchmark-${Date.now()}`));
// Never mix stale measurements into a new run or remove an existing directory.
mkdirSync(path.dirname(output), { recursive: true });
mkdirSync(output);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const git = (root, args) => {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || 'Cannot read checkout identity');
  return result.stdout.trim();
};
const identity = root => ({ root, commit: git(root, ['rev-parse', 'HEAD']),
  status: git(root, ['status', '--short']), diffHash: hash(git(root, ['diff', 'HEAD'])),
  lockHash: hash(readFileSync(path.join(root, 'package-lock.json'))),
  electron: createRequire(path.join(desktop(root), 'package.json'))('electron/package.json').version });
function treeHash(directory) {
  const digest = createHash('sha256');
  const visit = folder => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) digest.update(path.relative(directory, file)).update('\0').update(readFileSync(file));
    }
  };
  visit(directory);
  return digest.digest('hex');
}
const harnessHash = () => hash([
  'playwright.config.ts', 'playwright.preview-benchmark.config.ts',
  'test/e2e/sample-document-cycles.spec.ts', 'test/e2e/sample-review-cold-cycles.spec.ts',
  'test/e2e/preview-cycle-input.ts', 'test/e2e/electron-app.ts', 'test/fixtures/sample.md',
  'scripts/preview-benchmark.mjs', 'scripts/preview-benchmark-compare.mjs',
].map(file => readFileSync(path.join(desktop(candidate), file), 'utf8')).join('\0'));
const report = { schema: 1, startedAt: new Date().toISOString(), runs, thresholds,
  harness: 'candidate; same tests for both apps; five cycles per fresh process',
  measurement: 'Escape keydown to latest-content nonempty native capture; includes polling/IPC/readback, not monitor presentation',
  fixtureHash: fixtureHash(candidate),
  harnessHash: harnessHash(),
  machine: { hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(),
    cpu: os.cpus()[0]?.model, cpus: os.cpus().length, node: process.version, display: process.env.DISPLAY },
  baseline: identity(baseline), candidate: identity(candidate), order: [], measurements: { baseline: [], candidate: [] },
};
const save = () => writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2));
save();
function execute(command, args, cwd, log, extraEnv = {}) {
  const fd = openSync(log, 'w');
  try {
    const result = spawnSync(command, args, { cwd, env: { ...process.env, ...extraEnv },
      stdio: ['ignore', fd, fd], timeout: 20 * 60_000 });
    if (result.status !== 0) throw Error(`Command failed (${result.status ?? result.error}): ${command} ${args.join(' ')}; see ${log}`);
  } finally { closeSync(fd); }
}
function records(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return records(file);
    const kind = entry.name === 'document-cycles.json' ? 'document' : entry.name === 'cycles.json' ? 'review' : null;
    return kind ? [{ ...JSON.parse(readFileSync(file, 'utf8')), kind }] : [];
  });
}
try {
  for (const [label, root] of [['baseline', baseline], ['candidate', candidate]]) {
    if (!values['skip-build']) {
      console.log(`Building ${label}: ${root}`);
      execute(npm, ['run', 'build'], root, path.join(output, `${label}-build.log`));
    }
    report[label].artifacts = { renderer: treeHash(path.join(desktop(root), 'dist')),
      main: treeHash(path.join(desktop(root), 'dist-electron')) };
  }
  save();
  for (let repetition = 0; repetition < runs; repetition++) {
    // Alternate AB / BA to reduce systematic cache/thermal/order bias.
    const labels = repetition % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (const label of labels) {
      const run = `${repetition + 1}-${label}`;
      console.log(`Measuring ${run}: 8 scenarios, each in a fresh Electron process`);
      report.order.push(run); save();
      const destination = path.join(output, run);
      execute(process.execPath, [path.join(candidate, 'node_modules/@playwright/test/cli.js'), 'test',
        '--config', path.join(desktop(candidate), 'playwright.preview-benchmark.config.ts')],
      desktop(label === 'baseline' ? baseline : candidate), path.join(output, `${run}.log`), {
        SETDOWN_BENCH_OUTPUT: destination, SETDOWN_BENCH_MATRIX: '1',
        SETDOWN_DOCUMENT_READER_IDLE_MS: '0', SETDOWN_TRACE_DOCUMENT_CYCLES: '0',
        SETDOWN_TRACE_CYCLES: '0', SETDOWN_CYCLES_RETURN: 'double-click',
      });
      const measured = records(destination);
      summarizeRun(measured);
      if (harnessHash() !== report.harnessHash) throw Error('Measurement harness changed during the run');
      report.measurements[label].push(measured); save();
    }
  }
  report.comparisons = compareRuns(report.measurements.baseline, report.measurements.candidate, thresholds);
  for (const [label, root] of [['baseline', baseline], ['candidate', candidate]]) {
    if (treeHash(path.join(desktop(root), 'dist')) !== report[label].artifacts.renderer
      || treeHash(path.join(desktop(root), 'dist-electron')) !== report[label].artifacts.main)
      throw Error(`${label} build changed during the run`);
  }
  report.regressions = report.comparisons.filter(row => row.regression);
  report.passed = report.regressions.length === 0;
  report.finishedAt = new Date().toISOString(); save();
  console.table(report.comparisons.map(({ key, baselineMs, candidateMs, regression }) =>
    ({ scenario: key, baselineMs, candidateMs, regression })));
  console.log(`${report.passed ? 'PASS' : 'FAIL'}: ${report.regressions.length} regressions. ${path.join(output, 'comparison.json')}`);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.passed = false; report.error = String(error); save();
  console.error(report.error); process.exitCode = 1;
}
