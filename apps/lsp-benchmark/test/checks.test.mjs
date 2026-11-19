import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { cases } from '../cases.mjs';
import { after, at, completionLabels, definitionTargets, errorsAbove, hoverText, leadsTo, marksLine, offers, withMistake } from '../lib/checks.mjs';
import { failures, table } from '../lib/report.mjs';
import { sources } from '../lib/sources.mjs';
import { projects } from '../projects.mjs';

test('every case names a known project, at one commit, and asks at least one question', () => {
  assert.equal(new Set(cases.map(item => item.id)).size, cases.length);
  for (const item of cases) {
    assert.match(projects[item.project]?.commit ?? '', /^[0-9a-f]{40}$/, item.id);
    assert.ok(item.mistake || [item.hover, item.completion, item.definition, item.faded].some(list => list?.length), item.id);
    for (const entry of item.accept ?? []) assert.ok(entry.at && entry.because, item.id);
  }
});

test('every case names text that its file contains', async t => {
  let read = 0;
  for (const item of cases) {
    // The projects are fetched by `bench.mjs fetch`; a checkout without them has nothing to compare.
    const text = await readFile(path.join(sources, item.project, item.file), 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    read++;
    for (const check of item.hover ?? []) at(text, check.at, check.on);
    for (const check of item.completion ?? []) after(text, check.after);
    for (const check of item.definition ?? []) at(text, check.at, check.on);
    for (const check of item.faded ?? []) at(text, check.at);
    for (const entry of item.accept ?? []) at(text, entry.at);
  }
  if (!read) t.skip('no project has been fetched');
});

test('places are positions as the protocol counts them', () => {
  const text = 'one\ntwo are\nthree are';
  assert.deepEqual(at(text, 'two'), { line: 1, character: 0 });
  assert.deepEqual(at(text, 'two are', 'are'), { line: 1, character: 4 }); // a part of the named text
  assert.deepEqual(after(text, 'are'), { line: 2, character: 9 }); // the last occurrence
  assert.throws(() => at(text, 'four'), /does not contain/);
  assert.throws(() => at(text, 'two', 'x'), /does not contain/);
  assert.deepEqual(withMistake('a\nb\n', 'wrong'), { text: 'a\nb\nwrong\n', line: 2 });
  assert.deepEqual(withMistake('a\nb', 'wrong'), { text: 'a\nb\nwrong\n', line: 2 });
});

test('answers are read in every shape a tool may use', () => {
  assert.equal(hoverText({ contents: { kind: 'markdown', value: ' area ' } }), 'area');
  assert.equal(hoverText({ contents: ['a', { language: 'c', value: 'b' }] }), 'a\nb');
  assert.equal(hoverText(null), '');
  assert.deepEqual(completionLabels({ items: [{ label: 'area' }, { label: { label: 'other' } }] }), ['area', 'other']);
  assert.deepEqual(completionLabels(null), []);
  assert.equal(offers([{ label: ' area(int width, int height)' }], 'area'), true); // clangd decorates its labels
  assert.equal(offers({ items: [{ label: 'area_code' }, { label: 'timeout' }] }, 'area'), false);
  assert.equal(offers([{ label: 'timeout' }], 'timeout-minutes'), false); assert.equal(offers([{ label: 'timeout-minutes' }], 'timeout-minutes'), true);
  assert.equal(offers([{ label: 'Area', filterText: 'area' }], 'area'), true);
  assert.deepEqual(definitionTargets({ uri: 'file:///a', range: { start: { line: 3 } } }), [{ uri: 'file:///a', line: 3 }]);
  const linked = definitionTargets([{ targetUri: 'file:///p/src/b%20c.rs', targetRange: { start: { line: 1 } }, targetSelectionRange: { start: { line: 2 } } }]);
  assert.deepEqual(linked, [{ uri: 'file:///p/src/b%20c.rs', line: 2 }]);
  assert.equal(leadsTo(linked, 'src/b c.rs'), true); assert.equal(leadsTo(linked, /src\/b c\.rs$/), true); assert.equal(leadsTo(linked, 'src/d.rs'), false);
  const range = (start, end, severity) => ({ severity, range: { start: { line: start }, end: { line: end } } });
  assert.equal(marksLine([range(2, 4)], 3), true); assert.equal(marksLine([range(2, 4)], 5), false);
  // Warnings in a project's own code are its own business; an error there is the tool's misreading.
  assert.equal(errorsAbove([range(1, 1, 2), range(2, 2, 1), range(2, 2), range(9, 9, 1)], 9).length, 2);
});

test('a run that misses an expectation says which one', () => {
  const run = { date: 'now', platform: 'test', profile: 'fresh', outcomes: [
    { id: 'python', language: 'Python', project: 'pallets/flask@49943b5a94', file: 'src/flask/app.py', expectedTool: 'pyright', start: { ok: true, seconds: 1, tool: 'pyright', source: 'included' },
      checks: [{ kind: 'clean', what: 'the project\'s own lines', ok: null, seconds: 60, observed: 'no error, but the tool reported nothing at all' },
        { kind: 'mistake', what: 'x: int = "three"', ok: false, seconds: 60, observed: 'not marked' },
        { kind: 'hover', what: 'MapAdapter', ok: true, seconds: 0.2, observed: '(class) MapAdapter' }, { kind: 'hover', what: 'get_debug_flag', ok: true, seconds: 0.4, observed: 'def get_debug_flag() -> bool' },
        { kind: 'definition', what: 'MapAdapter', ok: false, seconds: 60, expected: 'leads to map.py', observed: 'no target' }, { kind: 'definition', what: 'get_debug_flag', ok: true, seconds: 1, observed: 'src/flask/helpers.py:30' }] },
    { id: 'zig', language: 'Zig', project: 'a/b@1', file: 'main.zig', expectedTool: 'zls', start: { ok: false, seconds: 1, reason: 'No tool was started.', issue: { kind: 'downloads-off' } }, checks: [] },
  ] };
  assert.deepEqual(failures(run), ['python: mistake', 'python: definition at MapAdapter', 'zig: did not start (No tool was started.)']);
  const text = table(run);
  assert.match(text, /\| Python \| pallets\/flask \| pyright \| yes \(1\.0 s\) \| unknown \| NO \| yes \(2 of 2\), 0\.4 s \| – \| NO \(1 of 2\) \|/);
  assert.match(text, /\| Zig \| a\/b \| zls \| NO: downloads-off \|/);
  assert.match(text, /3 expectations were not met/);
});
