import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => readFile(path.join(here, name), 'utf8').then(JSON.parse);
const full = await read('evidence.json');
assert.equal(full.cases.length, 26);
// evidence-initial.json preserves the original run and its obsolete word-suggestion expectation.
// The final run asserts external ownership and visible CSS marker counts.
const cases = new Map(full.cases.map(entry => [entry.name, entry]));
for (const entry of cases.values()) {
  assert.equal(entry.sourceUnchanged, true, entry.name);
  if (entry.name === 'rust-brave') { assert.match(entry.connection.error, /Unknown binary 'rust-analyzer'/); continue; }
  assert.equal(entry.error, undefined, entry.name);
  assert.equal(entry.connection.error, undefined, entry.name);
  for (const request of Object.values(entry.requests)) assert.equal(request.error, undefined, entry.name);
  assert.equal(entry.console.some(message => /doValidation|Cannot read properties of null|Unexpected usage|Could not create.*worker/.test(message)), false, entry.name);
}
assert.equal(cases.get('ts-missing-server').connection.response.unavailable, 'missing');
const rename = [];
for (const kind of ['standalone', 'project', 'superproject']) {
  const entry = cases.get(`python-${kind}`), result = entry.requests.rename;
  const files = result.response.documentChanges.map(change => change.textDocument.uri).sort();
  assert.equal(files.length, 4);
  const session = entry.sessions.find(server => server.id === 'pyright').sessions[0];
  assert.ok(session.root.endsWith('/vendor/nbformat'));
  rename.push({ kind, files, ms: result.ms, root: session.root });
  const ui = cases.get(`python-${kind}-rename-ui`);
  assert.equal(ui.renameTabs.filter(tab => tab.includes('•')).length, 4);
}
assert.deepEqual(rename[0].files, rename[1].files); assert.deepEqual(rename[1].files, rename[2].files);
const ts = cases.get('ts-gitgraph');
assert.ok(ts.requests.inlayHints.response.length > 0);
assert.equal(ts.expectedEmptyCompletion, true);
assert.match(ts.uiCompletion, /No suggestions\./);
assert.match(cases.get('ts-gitgraph-completion-ui').uiCompletion, /get/);
for (const name of ['css-min-invalid', 'css-min-configured-invalid']) {
  const css = cases.get(name);
  assert.equal(css.requests.pullDiagnostics.response.items.length, 2);
  assert.deepEqual(css.cssMarkers, { errors: 1, warnings: 1 });
  assert.deepEqual(css.sessions.find(server => server.id === 'css-lsp').sessions[0].logs, []);
}
const notebook = cases.get('notebook-nbformat');
assert.ok(notebook.requests.completionResolve.response.documentation);
assert.equal(cases.get('json-nbformat').console.length, 0);
const summary = { scenarios: cases.size, connectedCases: 24, expectedMissingServer: 1, unavailableToolchain: 1,
  rename, defaultTypeScriptHints: ts.requests.inlayHints.response.length,
  cssDiagnostics: cases.get('css-min-invalid').requests.pullDiagnostics.response.items,
  notebookResolve: true, allSourcesUnchanged: true,
  initialRunExpectationMismatch: 'ts-gitgraph: declaration returns no LSP completions; the old widget contained built-in word suggestions',
  corrections: 'The final run asserts the no-suggestions message after the LSP reply and one CSS error plus one warning in real Monaco.' };
await writeFile(path.join(here, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ scenarios: summary.scenarios, renameFiles: rename.map(result => result.files.length), defaultTypeScriptHints: summary.defaultTypeScriptHints, cssDiagnostics: summary.cssDiagnostics.length, notebookResolve: true }));
