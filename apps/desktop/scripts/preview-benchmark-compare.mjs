export const scenarios = ['document', 'review'].flatMap(kind => [0, 3000].flatMap(idle =>
  [false, true].map(edits => ({ kind, idle, edits }))));
export const scenarioKey = ({ kind, idle, edits }) => `${kind}/idle=${idle}/edits=${edits}`;
export const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Fail closed: missing scenarios/cycles or stale-content captures are not fast runs. */
export function summarizeRun(records) {
  const expected = new Set(scenarios.map(scenarioKey));
  const result = {};
  for (const record of records) {
    const key = scenarioKey(record);
    if (!expected.delete(key)) throw Error(`Unexpected/duplicate scenario: ${key}`);
    if (record.readerIdle !== undefined && record.readerIdle !== 0) throw Error('Reader idle changes the workload');
    if (record.returnMethod !== undefined && record.returnMethod !== 'double-click') throw Error('Real double-click required');
    if (record.samples?.length !== 5) throw Error(`Incomplete cycles: ${key}`);
    for (const [index, sample] of record.samples.entries()) {
      if (sample.cycle !== index + 1) throw Error(`Out-of-order cycles: ${key}`);
      if (record.edits && sample.captureRequiresLatestContent !== true) throw Error(`Stale-content capture: ${key}`);
      for (const metric of ['captureMs', 'doubleClickToEditorMs']) {
        if (!Number.isFinite(sample[metric]) || sample[metric] < 0) throw Error(`Invalid ${metric}: ${key}`);
      }
    }
    for (const metric of ['captureMs', 'doubleClickToEditorMs']) {
      result[`${key}/first/${metric}`] = record.samples[0][metric];
      result[`${key}/second/${metric}`] = record.samples[1][metric];
      // One observation per fresh application: don't overweight warm cycles.
      result[`${key}/warm/${metric}`] = median(record.samples.slice(2).map(sample => sample[metric]));
    }
  }
  if (expected.size) throw Error(`Missing scenarios: ${[...expected].join(', ')}`);
  return result;
}

export function compareRuns(baseline, candidate, { relative = .25, absoluteMs = 50 } = {}) {
  if (!Number.isFinite(relative) || relative <= 0 || !Number.isFinite(absoluteMs) || absoluteMs <= 0)
    throw Error('Regression tolerances must be finite and positive');
  if (baseline.length < 3 || baseline.length !== candidate.length) throw Error('At least three matched repetitions required');
  const before = baseline.map(summarizeRun), after = candidate.map(summarizeRun);
  return Object.keys(before[0]).map(key => {
    const baselineSamples = before.map(run => run[key]);
    const candidateSamples = after.map(run => run[key]);
    const baselineMs = median(baselineSamples), candidateMs = median(candidateSamples);
    const deltaMs = candidateMs - baselineMs;
    return { key, baselineMs, candidateMs, deltaMs,
      relativeChange: baselineMs === 0 ? null : deltaMs / baselineMs,
      // Both tolerances must be exceeded. Never average away the first two Escs.
      regression: deltaMs > absoluteMs && candidateMs > baselineMs * (1 + relative),
      baselineSamples, candidateSamples };
  });
}
