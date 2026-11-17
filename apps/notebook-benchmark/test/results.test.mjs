import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configurations, standard } from '../configurations.mjs';
import { projectFile } from '../lib/analyzer.mjs';
import { chooseNotebooks, nearbyModules } from '../lib/corpus.mjs';
import { category, delta, groups, pack, place, sample, scoreLabels, summarize, unpack } from '../lib/results.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const row = (notebook, cell, line, rule = 'reportArgumentType', severity = 'error', message = `Argument of type "${notebook}" is wrong`) =>
  ({ notebook, cell, line, column: 0, endLine: line, endColumn: 4, severity, rule, message });

test('a summary counts marked lines once and separates red from yellow', () => {
  const rows = [row('a/b/one.ipynb', 0, 1), row('a/b/one.ipynb', 0, 1, 'reportCallIssue'), row('a/b/two.ipynb', 3, 2, 'reportUndefinedVariable', 'warning'),
    row('c/d/three.ipynb', 1, 1, 'syntax'), row('c/d/three.ipynb', 1, 4, 'reportMissingImports', 'warning')];
  const counts = summarize(rows, 5);
  assert.deepEqual([counts.notebooks, counts.notebooksWithErrors, counts.errors, counts.errorLines, counts.warnings, counts.warningLines], [5, 2, 3, 2, 2, 2]);
  assert.deepEqual(counts.errorCategories, { type: { diagnostics: 2, lines: 1 }, syntax: { diagnostics: 1, lines: 1 } });
  assert.deepEqual(Object.keys(counts.warningCategories).sort(), ['missing-import', 'undefined-name']);
  assert.deepEqual(counts.repositories, { 'a/b': { diagnostics: 2, lines: 1 }, 'c/d': { diagnostics: 1, lines: 1 } });
  assert.equal(category(row('a/b/one.ipynb', 0, 1, 'reportMissingModuleSource')), 'missing-import');
});

test('a comparison reports what one side alone marks, over the repositories both analysed', () => {
  const kept = row('a/b/one.ipynb', 0, 1), gone = row('a/b/one.ipynb', 2, 5), added = row('a/b/two.ipynb', 0, 3);
  const change = delta([kept, gone, row('only/before/x.ipynb', 0, 1)], [kept, added, row('a/b/two.ipynb', 0, 3, 'reportUndefinedVariable', 'warning'), row('only/after/y.ipynb', 0, 1)]);
  assert.deepEqual([change.before, change.after], [{ diagnostics: 2, lines: 2 }, { diagnostics: 2, lines: 2 }]);
  assert.deepEqual([change.removed, change.added, change.removedLines, change.addedLines], [[gone], [added], 1, 1]);
});

test('reports of one kind fall into one group whatever names they quote', () => {
  const [first, second] = groups([row('a/b/one.ipynb', 0, 1), row('a/b/two.ipynb', 0, 1), row('c/d/three.ipynb', 0, 1, 'reportCallIssue', 'error', 'No overloads')]);
  assert.deepEqual([first.name, first.rows.length, first.notebooks, first.repositories], ['[ArgumentType] Argument of type "…" is wrong', 2, 2, 1]);
  assert.equal(second.name, '[CallIssue] No overloads');
});

test('a sample is repeatable, holds whole lines and changes with the seed', () => {
  const rows = Array.from({ length: 60 }, (_, i) => row('a/b/one.ipynb', i % 20, 1, i < 20 ? 'reportCallIssue' : 'reportArgumentType'));
  const first = sample(rows, 5, 7), again = sample(rows, 5, 7), other = sample(rows, 5, 8);
  assert.deepEqual(first, again);
  assert.equal(first.length, 5);
  assert.ok(first.every(items => items.length === 3 && new Set(items.map(place)).size === 1));
  assert.notDeepEqual(first.map(items => place(items[0])), other.map(items => place(items[0])));
  assert.equal(sample(rows, 100, 1).length, 20);
});

test('labels score a configuration by the judged lines it still marks red', () => {
  const labels = [{ notebook: 'a/b/one.ipynb', cell: 0, line: 1, verdict: 'real' }, { notebook: 'a/b/one.ipynb', cell: 1, line: 1, verdict: 'false' },
    { notebook: 'a/b/one.ipynb', cell: 2, line: 1, verdict: 'false' }, { notebook: 'a/b/one.ipynb', cell: 3, line: 1, verdict: 'hazard' }];
  const score = scoreLabels([row('a/b/one.ipynb', 0, 1), row('a/b/one.ipynb', 1, 1), row('a/b/one.ipynb', 2, 1, 'reportUndefinedVariable', 'warning')], labels);
  assert.deepEqual(score.verdicts, { real: { marked: 1, of: 1 }, false: { marked: 1, of: 2 }, hazard: { marked: 0, of: 1 } });
  assert.deepEqual([score.marked, score.precision], [2, 0.5]);
  assert.equal(scoreLabels([], labels).precision, undefined);
});

test('a saved baseline gives back the same diagnostics', () => {
  const rows = [row('a/b/one.ipynb', 0, 1), row('a/b/one.ipynb', 4, 2, 'reportUndefinedVariable', 'warning'), row('c/d/three.ipynb', 1, 1, 'syntax')];
  const packed = pack(rows);
  assert.deepEqual(packed.notebooks, ['a/b/one.ipynb', 'c/d/three.ipynb']);
  assert.deepEqual(unpack(JSON.parse(JSON.stringify(packed))), rows);
});

test('the corpus sample spreads over a repository and leaves translated copies out', () => {
  const files = [...Array.from({ length: 30 }, (_, i) => `chapters/${String(i).padStart(2, '0')}.ipynb`), 'translations/ko/00.ipynb', 'chapters/.ipynb_checkpoints/00-checkpoint.ipynb', 'setup.py', 'chapters/helpers.py', 'tests/test_helpers.py'];
  const { total, chosen } = chooseNotebooks(files, 10);
  assert.equal(total, 30);
  assert.deepEqual(chosen, ['00', '03', '06', '09', '12', '15', '18', '21', '24', '27'].map(name => `chapters/${name}.ipynb`));
  assert.deepEqual(chooseNotebooks(files.slice(0, 3), 10).chosen, files.slice(0, 3));
  assert.deepEqual(nearbyModules(files, chosen), ['setup.py', 'chapters/helpers.py']);
});

test('the notebook host’s settings become a project file, and an unknown setting stops the run', () => {
  assert.deepEqual(projectFile({ typeCheckingMode: 'off', autoSearchPaths: true, diagnosticMode: 'openFilesOnly', extraPaths: ['/stubs'], diagnosticSeverityOverrides: { reportUndefinedVariable: 'warning' } }),
    { typeCheckingMode: 'off', extraPaths: ['/stubs'], reportUndefinedVariable: 'warning' });
  assert.throws(() => projectFile({ typeCheckingMode: 'basic', stubPath: 'typings' }), /stubPath/);
});

test('the committed label set and configurations are consistent with the corpus', () => {
  const corpus = read('corpus.json'), { labels, verdicts } = read('labels.json');
  const notebooks = new Set(corpus.repositories.flatMap(entry => entry.notebooks.map(name => `${entry.repo}/${name}`)));
  assert.ok(corpus.repositories.every(entry => /^[0-9a-f]{40}$/.test(entry.sha)), 'every repository is pinned to a commit');
  assert.equal(new Set(labels.map(place)).size, labels.length, 'a line is judged once');
  for (const label of labels) {
    assert.ok(notebooks.has(label.notebook), `${label.notebook} is in corpus.json`);
    assert.ok(Object.hasOwn(verdicts, label.verdict) && label.cause && label.source, `${place(label)} has a verdict, a cause and its source line`);
    assert.ok(Number.isInteger(label.cell) && label.cell >= 0 && Number.isInteger(label.line) && label.line >= 1);
  }
  for (const name of standard) assert.ok(configurations[name], `${name} is a configuration`);
});
