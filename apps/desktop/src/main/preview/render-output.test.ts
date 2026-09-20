import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildRenderOutput, type InstalledPreview } from './render-output';

function fixture() {
  const calls: string[] = [];
  const installed = new Map<string, InstalledPreview>();
  const builders = {
    split: (_html: string) => { calls.push('split'); return []; },
    diff: () => { calls.push('diff'); return null; },
    requiresCrossnote: (_html: string) => { calls.push('capability'); return false; },
    leanTemplate: (): string | null => { calls.push('lean'); return '<lean/>'; },
    fullTemplate: () => { calls.push('full'); return '<full/>'; },
  };
  const request = { tabId: 'review:modified', html: '<span class="katex">unchanged</span>', hasPage: false };
  return { calls, installed, builders, request };
}

test('HTML-only output preserves bytes and skips templates, block splitting and diffing', () => {
  const f = fixture();
  f.installed.set(f.request.tabId, { blocks: [], runtime: 'lean' });
  const result = buildRenderOutput({ ...f.request, htmlOnly: true }, f.installed, f.builders);
  assert.deepEqual(result, { html: f.request.html });
  assert.deepEqual(f.calls, []);
  assert.equal(f.installed.has(f.request.tabId), false);
});

test('initial lean page still includes both template and complete HTML', () => {
  const f = fixture();
  assert.deepEqual(buildRenderOutput(f.request, f.installed, f.builders), { template: '<lean/>', html: f.request.html });
  assert.deepEqual(f.calls, ['split', 'lean']);
  assert.equal(f.installed.get(f.request.tabId)?.runtime, 'lean');
});

test('initial unsupported lean page uses the full runtime fallback', () => {
  const f = fixture();
  f.builders.leanTemplate = () => { f.calls.push('lean'); return null; };
  assert.equal(buildRenderOutput(f.request, f.installed, f.builders).template, '<full/>');
  assert.deepEqual(f.calls, ['split', 'lean', 'full']);
  assert.equal(f.installed.get(f.request.tabId)?.runtime, 'crossnote');
});

test('warm block patch never builds a lean or full template', () => {
  const f = fixture();
  f.installed.set(f.request.tabId, { blocks: [], runtime: 'lean' });
  assert.deepEqual(buildRenderOutput({ ...f.request, hasPage: true }, f.installed, f.builders), { patch: null });
  assert.deepEqual(f.calls, ['split', 'capability', 'diff']);
});

test('lost block cache on a warm page sends complete HTML without a template', () => {
  const f = fixture();
  assert.deepEqual(buildRenderOutput({ ...f.request, hasPage: true }, f.installed, f.builders), { html: f.request.html });
  assert.deepEqual(f.calls, ['split', 'capability']);
});

test('new client-rendered content still upgrades a lean page to Crossnote', () => {
  const f = fixture();
  f.installed.set(f.request.tabId, { blocks: [], runtime: 'lean' });
  f.builders.requiresCrossnote = () => { f.calls.push('capability'); return true; };
  assert.deepEqual(buildRenderOutput({ ...f.request, hasPage: true }, f.installed, f.builders),
    { template: '<full/>', html: f.request.html });
  assert.deepEqual(f.calls, ['split', 'capability', 'full']);
  assert.equal(f.installed.get(f.request.tabId)?.runtime, 'crossnote');
});

test('an existing Crossnote page stays installed without rebuilding templates', () => {
  const f = fixture();
  f.installed.set(f.request.tabId, { blocks: [], runtime: 'crossnote' });
  assert.deepEqual(buildRenderOutput({ ...f.request, hasPage: true }, f.installed, f.builders), { patch: null });
  assert.deepEqual(f.calls, ['split', 'diff']);
  assert.equal(f.installed.get(f.request.tabId)?.runtime, 'crossnote');
});

test('a failed output builder does not advance the installed baseline', () => {
  const f = fixture();
  const previous: InstalledPreview = { blocks: [], runtime: 'lean' };
  f.installed.set(f.request.tabId, previous);
  f.builders.leanTemplate = () => { throw new Error('template failed'); };
  assert.throws(() => buildRenderOutput(f.request, f.installed, f.builders), /template failed/);
  assert.equal(f.installed.get(f.request.tabId), previous);
});
