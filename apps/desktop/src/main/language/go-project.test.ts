import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { Diagnostic } from 'vscode-languageserver-protocol';
import { chooseGoVersion, chosenGo, goLintOnSave, goProjectEnvironment, goTagsCommand, goTestProgram, goToolFolder, goplsStartOptions, lintAfterChange } from './go-project';

const folders: string[] = [];
async function folder(): Promise<string> { const made = await mkdtemp(path.join(os.tmpdir(), 'setdown-go-project-')); folders.push(made); return made; }
afterEach(async () => { await Promise.all(folders.splice(0).map(made => rm(made, { recursive: true, force: true }))); });
const range = { start: { line: 3, character: 1 }, end: { line: 5, character: 2 } };

test('the chosen Go comes first on PATH, and a project that fixed its Go is left alone', async () => {
  const directory = await folder(), project = path.join(directory, 'project'), go = path.join(directory, 'sdk', 'go1.21.0', 'bin', 'go');
  await mkdir(path.dirname(go), { recursive: true }); await writeFile(go, '');
  const env = { PATH: `/usr/bin${path.delimiter}${path.dirname(go)}` };
  expect(await chosenGo(directory, project, undefined, env)).toBeUndefined();
  expect(await goProjectEnvironment(directory, project, undefined, env)).toEqual({ env });
  await mkdir(path.join(directory, 'go'), { recursive: true });
  await writeFile(path.join(directory, 'go', 'selected.json'), JSON.stringify({ program: go }));
  expect(await goProjectEnvironment(directory, project, undefined, env)).toEqual({ chosen: go, env: { PATH: `${path.dirname(go)}${path.delimiter}/usr/bin` } });
  // goEnvironmentStatus.ts `canChooseGoEnvironment`: `go.goroot` and GOROOT decide before any choice.
  expect(await chosenGo(directory, project, { 'go.goroot': '/opt/go' }, env)).toBeUndefined();
  expect(await chosenGo(directory, project, undefined, { ...env, GOROOT: '/opt/go' })).toBeUndefined();
  // A choice that is no longer on the disk, or is not a path, chooses nothing.
  await rm(go);
  expect(await chosenGo(directory, project, undefined, env)).toBeUndefined();
  await writeFile(path.join(directory, 'go', 'selected.json'), JSON.stringify({ program: 'go' }));
  expect(await chosenGo(directory, project, undefined, env)).toBeUndefined();
  // Clearing says whether there was a choice, and leaves none.
  expect(await chooseGoVersion(directory, project, undefined, env, { clear: true })).toBe(false);
  await writeFile(path.join(directory, 'go', 'selected.json'), JSON.stringify({ program: go }));
  expect(await chooseGoVersion(directory, project, undefined, env, { clear: true })).toBe(true);
  expect(JSON.parse(await readFile(path.join(directory, 'go', 'selected.json'), 'utf8'))).toEqual({});
  expect(goToolFolder(directory)).toBe(path.join(directory, 'go', 'bin'));
});

test('add and remove tags are sent with the settings, and asked for where the settings name none', () => {
  const uri = 'file:///p/model.go';
  expect(goTagsCommand(uri, { modification: 'add', range }, undefined)).toEqual({ ask: 'Tags to add, separated by commas, for example json,xml' });
  expect(goTagsCommand(uri, { modification: 'add', range, tags: ' json,xml ' }, undefined)).toEqual({ command: 'gopls.modify_tags', arguments: [{ URI: uri, range, modification: 'add', add: 'json,xml', addOptions: undefined, transform: undefined, valueFormat: undefined }] });
  expect(goTagsCommand(uri, { modification: 'add', range }, { 'go.addTags': { tags: 'json', options: 'json=omitempty', transform: 'camelcase' } }))
    .toEqual({ command: 'gopls.modify_tags', arguments: [{ URI: uri, range, modification: 'add', add: 'json', addOptions: 'json=omitempty', transform: 'camelcase', valueFormat: undefined }] });
  // `promptForTags` leaves the settings aside, as in goModifytags.ts.
  expect(goTagsCommand(uri, { modification: 'add', range }, { 'go.addTags': { tags: 'json', promptForTags: true } })).toEqual({ ask: 'Tags to add, separated by commas, for example json,xml' });
  expect(goTagsCommand(uri, { modification: 'remove', range, tags: 'xml' }, undefined)).toEqual({ command: 'gopls.modify_tags', arguments: [{ URI: uri, range, modification: 'remove', remove: 'xml', removeOptions: undefined }] });
  // Nothing a shell or gopls could read as more than tag names, no selection, no Go file.
  expect(goTagsCommand(uri, { modification: 'add', range, tags: 'json" -x' }, undefined)).toEqual({ ask: 'Tags to add, separated by commas, for example json,xml' });
  expect(goTagsCommand(uri, { modification: 'add', tags: 'json' }, undefined)).toBeUndefined();
  expect(goTagsCommand('file:///p/notes.md', { modification: 'add', range, tags: 'json' }, undefined)).toBeUndefined();
});

test('a test lens becomes a go test line with only the environment the settings add', () => {
  const lens = [{ URI: 'file:///p/pkg/add_test.go', Tests: ['TestAdd'], Benchmarks: [] }];
  expect(goTestProgram(lens, { 'go.testTimeout': '10s', 'go.testEnvVars': { MODE: 'ci', HOME_DIR: '${workspaceFolder}/home' } }, '/p', { PATH: '/usr/bin', MODE: 'dev' }))
    .toEqual({ cwd: '/p/pkg', program: 'go', args: ['test', '-test.fullpath=true', '-timeout', '10s', '-run', '^TestAdd$', '.'], label: 'go test TestAdd', env: { MODE: 'ci', HOME_DIR: '/p/home' } });
  expect(goTestProgram([{ URI: 'file:///p/pkg/add_test.go', Tests: ['Test;rm'] }], undefined, '/p', {})).toBeUndefined();
  expect(goTestProgram('gopls.run_tests', undefined, '/p', {})).toBeUndefined();
});

test('gopls is started with the go.* settings under its own short names', () => {
  expect(goplsStartOptions(undefined)).toEqual({});
  expect(goplsStartOptions({ 'go.buildTags': 'integration', 'go.inlayHints.parameterNames': false, gopls: { 'ui.semanticTokens': true, 'formatting.gofumpt': true } }))
    .toEqual({ semanticTokens: true, gofumpt: true, buildFlags: ['-tags', 'integration'], hints: { parameterNames: false } });
});

test('nothing is linted on save unless go.lintTool names a tool', async () => {
  const directory = await folder(), signal = new AbortController().signal;
  const facts = { file: path.join(directory, 'main.go'), project: directory, env: { PATH: '' }, directory, mayInstall: false, signal };
  expect(await goLintOnSave({ ...facts, settings: undefined })).toBeUndefined();
  expect(await goLintOnSave({ ...facts, settings: { 'go.lintTool': 'staticcheck', 'go.lintOnSave': 'off' } })).toBeUndefined();
  // A tool that is not on this computer is named, with the extension's sentence; nothing is installed where that is not allowed.
  const run = await goLintOnSave({ ...facts, settings: { 'go.lintTool': 'staticcheck' } });
  expect(run?.diagnostics.size).toBe(0);
  expect(run?.notes).toHaveLength(1); expect(run!.notes[0]).toContain('staticcheck');
});

test('what the lint tool said stays with its lines while the person types', () => {
  const at = (line: number, message: string): Diagnostic => ({ range: { start: { line, character: 0 }, end: { line, character: 4 } }, message });
  const said = [at(1, 'above'), at(5, 'changed'), at(9, 'below')];
  const lines = (found: Diagnostic[]) => found.map(item => [item.message, item.range.start.line, item.range.end.line]);
  // Two lines typed in place of line 5: what is below moves down by one, and the changed line's own mark goes.
  expect(lines(lintAfterChange(said, [{ range: { start: { line: 5, character: 0 }, end: { line: 5, character: 3 } }, text: 'a\nb' }]))).toEqual([['above', 1, 1], ['below', 10, 10]]);
  // Lines 2 to 4 removed.
  expect(lines(lintAfterChange(said, [{ range: { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } }, text: '' }]))).toEqual([['above', 1, 1], ['changed', 3, 3], ['below', 7, 7]]);
  // Several changes are applied one after another; the whole text replaced leaves nothing to show.
  expect(lines(lintAfterChange(said, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: '\n' }, { range: { start: { line: 10, character: 0 }, end: { line: 10, character: 1 } }, text: 'x' }]))).toEqual([['above', 2, 2], ['changed', 6, 6]]);
  expect(lintAfterChange(said, [{ text: 'package main' }])).toEqual([]);
});
