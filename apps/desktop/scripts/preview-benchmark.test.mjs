import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareRuns, scenarios, summarizeRun } from './preview-benchmark-compare.mjs';

const run = (ms = 100) => scenarios.map(scenario => ({ ...scenario,
  samples: Array.from({ length: 5 }, (_, index) => ({ cycle: index + 1,
    captureMs: ms, doubleClickToEditorMs: ms, captureRequiresLatestContent: scenario.edits })) }));
const repeats = (ms = 100) => Array.from({ length: 5 }, () => run(ms));

test('first and second cycle regressions cannot be hidden by warm cycles or another scenario', () => {
  const after = repeats();
  for (const record of after) {
    record[0].samples[0].captureMs = 300;
    record[1].samples[1].doubleClickToEditorMs = 250;
  }
  const regressions = compareRuns(repeats(), after).filter(row => row.regression);
  assert.equal(regressions.length, 2);
  assert.match(regressions[0].key, /first\/captureMs$/);
  assert.match(regressions[1].key, /second\/doubleClickToEditorMs$/);
});
test('requires both relative and absolute tolerances and tolerates a single outlier', () => {
  assert.ok(compareRuns(repeats(20), repeats(50)).every(row => !row.regression));
  assert.ok(compareRuns(repeats(1000), repeats(1100)).every(row => !row.regression));
  const after = repeats(); after[0] = run(5000);
  assert.ok(compareRuns(repeats(), after).every(row => !row.regression));
  assert.ok(compareRuns(repeats(), repeats(200)).every(row => row.regression));
});
test('incomplete, duplicate, stale and invalid measurements fail closed', () => {
  assert.throws(() => summarizeRun(run().slice(1)), /Missing scenarios/);
  assert.throws(() => summarizeRun([...run(), run()[0]]), /duplicate/);
  const short = run(); short[0].samples.pop();
  assert.throws(() => summarizeRun(short), /Incomplete cycles/);
  const stale = run(); stale[1].samples[0].captureRequiresLatestContent = false;
  assert.throws(() => summarizeRun(stale), /Stale-content/);
  const invalid = run(); invalid[0].samples[1].captureMs = NaN;
  assert.throws(() => summarizeRun(invalid), /Invalid/);
  assert.throws(() => compareRuns([run()], [run()]), /three matched/);
  assert.throws(() => compareRuns(repeats(), repeats(), { relative: NaN }), /tolerances/);
});
