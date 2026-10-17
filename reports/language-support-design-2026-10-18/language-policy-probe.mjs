import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Research only: execute installed Monaco workers in Node, with no external
// language server, network requests, Electron window, or application-source edits.
const require = createRequire(import.meta.url);
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
async function loadWorker(language, name) {
  const entry = path.join(root, `node_modules/monaco-editor/esm/vs/languages/features/${language}/${language}Worker.js`);
  const bundled = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, module, module.exports);
  return module.exports[name];
}
const [JSONWorker, CSSWorker, HTMLWorker] = await Promise.all([
  loadWorker('json', 'JSONWorker'), loadWorker('css', 'CSSWorker'), loadWorker('html', 'HTMLWorker'),
]);
function context(uri, text) {
  return { getMirrorModels: () => [{ uri: { toString: () => uri }, version: 1, getValue: () => text }] };
}
const summarize = diagnostics => diagnostics.map(({ code, severity, message }) => ({ code, severity, message }));
async function json(text, settings = {}) {
  const uri = 'file:///policy-probe/settings.json';
  const worker = new JSONWorker(context(uri, text), { languageId: 'json', enableSchemaRequest: false,
    languageSettings: { validate: true, allowComments: false, schemas: [], schemaRequest: 'warning', schemaValidation: 'error', ...settings } });
  return summarize(await worker.doValidation(uri));
}
const jsonValid = await json('{"name":"Setdown"}');
const jsonSyntaxError = await json('{"name":}');
const jsonUnavailableSchema = await json('{"$schema":"https://setdown.invalid/schema.json","name":"Setdown"}');
const jsonLocalSchema = await json('{"count":"wrong"}', { schemas: [{ uri: 'inmemory://policy-schema', fileMatch: ['*'],
  schema: { type: 'object', properties: { count: { type: 'number' } } } }] });
assert.equal(jsonValid.length, 0);
assert(jsonSyntaxError.length > 0);
assert(jsonUnavailableSchema.some(d => /schema/i.test(d.message)));
assert(jsonLocalSchema.some(d => /number/i.test(d.message)));

async function css(text, data) {
  const uri = 'file:///policy-probe/style.css';
  const worker = new CSSWorker(context(uri, text), { languageId: 'css', options: {
    validate: true, lint: { unknownProperties: 'warning' }, data,
  } });
  return summarize(await worker.doValidation(uri));
}
const cssKnownProperty = await css('a { color: red; }');
const cssSyntaxError = await css('a { color red; }');
const cssWithoutCustomData = await css('a { setdown-token: 1; }');
const cssWithCustomData = await css('a { setdown-token: 1; }', { useDefaultDataProvider: true,
  dataProviders: { fixture: { version: 1.1, properties: [{ name: 'setdown-token', description: 'Controlled custom-dialect fixture' }] } } });
assert.equal(cssKnownProperty.length, 0);
assert(cssSyntaxError.length > 0);
assert(cssWithoutCustomData.some(d => d.code === 'unknownProperties'));
assert.equal(cssWithCustomData.length, 0);

const htmlUri = 'file:///policy-probe/index.html';
const html = new HTMLWorker(context(htmlUri, '<di'), { languageId: 'html', languageSettings: {} });
const completions = await html.doComplete(htmlUri, { line: 0, character: 3 });
assert(completions.items.some(item => item.label === 'div'));
assert.equal(typeof html.doValidation, 'undefined');

const grammarPackages = Object.fromEntries(['python', 'cpp'].map(language => {
  const pkg = JSON.parse(readFileSync(path.join(root, `vendor/vscode/extensions/${language}/package.json`), 'utf8'));
  assert(!pkg.main && !pkg.browser);
  return [language, { languages: pkg.contributes.languages.map(l => l.id), grammarCount: pkg.contributes.grammars.length,
    hasRuntimeEntrypoint: !!(pkg.main || pkg.browser), hasProblemMatchers: !!pkg.contributes.problemMatchers }];
}));
const result = {
  investigationDate: '2026-10-18',
  method: 'Installed Monaco workers in Node; no external LSP, network or GUI. VS Code grammar package metadata inspected.',
  monacoVersion: JSON.parse(readFileSync(path.join(root, 'node_modules/monaco-editor/package.json'), 'utf8')).version,
  json: { valid: jsonValid, syntaxError: jsonSyntaxError, unavailableSchema: jsonUnavailableSchema, localSchemaViolation: jsonLocalSchema },
  css: { knownProperty: cssKnownProperty, syntaxError: cssSyntaxError, withoutCustomData: cssWithoutCustomData, withCustomData: cssWithCustomData },
  html: { completionContainsDiv: true, hasValidationMethod: false },
  vscodeBuiltInGrammarPackages: grammarPackages,
};
writeFileSync(path.join(directory, 'language-policy-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
