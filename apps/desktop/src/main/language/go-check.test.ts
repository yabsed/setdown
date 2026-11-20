import { afterEach, beforeEach, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Diagnostic } from 'vscode-languageserver-protocol';
import { goCheckLine, goCheckPlan, goChecksOnSave, goLintCommand, goLintOnSaveDefault, goLintScopes, goLintSeverity, goLintSource, goLintTool, goLintTools, goToolEnvironment,
  goToolModuleVersion, goToolVersionArguments, golangciMajor, parseGoCheckOutput, runGoCheck, withoutDuplicates, type CheckRun, type RunCheck } from './go-check';
import { goTool } from './go-tool-table';

let directory = '';
beforeEach(async () => { directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'setdown-go-check-test-'))); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const workspace = path.resolve('/work/app'), file = path.join(workspace, 'cmd', 'serve', 'main.go'), home = path.resolve('/home/a');
const facts = { file, workspace, home };
const warning = (line: number, character: number, message: string, source: string, end = character + 1): Diagnostic =>
  ({ range: { start: { line, character }, end: { line, character: end } }, message, severity: 2, source });

test('with the settings as they come, a save runs nothing', () => {
  expect(goChecksOnSave).toEqual({ build: 'never', vet: 'never', lint: 'when go.lintTool is set' });
  expect(goCheckPlan({}, facts)).toEqual([]);
  expect(goCheckPlan(undefined, facts)).toEqual([]);
  // The settings that would build and vet without gopls change nothing.
  expect(goCheckPlan({ 'go.buildOnSave': 'workspace', 'go.vetOnSave': 'workspace', 'go.lintOnSave': 'workspace' }, facts)).toEqual([]);
  expect(goLintTool({})).toBeUndefined();
  for (const lintTool of ['', null, 7, ['staticcheck'], '/usr/bin/staticcheck', '../staticcheck', 'staticcheck --fix', '-rf', 'a;b']) {
    expect(goLintTool({ 'go.lintTool': lintTool })).toBeUndefined();
    expect(goCheckPlan({ 'go.lintTool': lintTool }, facts)).toEqual([]);
  }
});

test('a linter is run in the scope go.lintOnSave names', () => {
  const lint = { 'go.lintTool': 'staticcheck' };
  expect(goLintOnSaveDefault).toBe('package');
  // Nothing written: the package of the saved file, which a linter takes as its folder.
  expect(goCheckPlan(lint, facts)).toEqual([{ program: 'staticcheck', args: [], cwd: path.dirname(file) }]);
  expect(goCheckPlan({ go: { lintTool: 'staticcheck', lintOnSave: 'package' } }, facts)).toEqual([{ program: 'staticcheck', args: [], cwd: path.dirname(file) }]);
  expect(goCheckPlan({ ...lint, 'go.lintOnSave': 'workspace' }, facts)).toEqual([{ program: 'staticcheck', args: ['./...'], cwd: workspace }]);
  expect(goCheckPlan({ ...lint, 'go.lintOnSave': 'file' }, facts)).toEqual([{ program: 'staticcheck', args: [file], cwd: path.dirname(file) }]);
  expect(goCheckPlan({ ...lint, 'go.lintOnSave': 'off' }, facts)).toEqual([]);
  // A file outside any project folder: `workspace` has no folder to run in and lints the package.
  expect(goCheckPlan({ ...lint, 'go.lintOnSave': 'workspace' }, { file })).toEqual([{ program: 'staticcheck', args: [], cwd: path.dirname(file) }]);
  // A scope the setting does not offer is treated as `package`; one that is no text, or empty, runs nothing.
  expect(goCheckPlan({ ...lint, 'go.lintOnSave': 'everything' }, facts)).toEqual([{ program: 'staticcheck', args: [], cwd: path.dirname(file) }]);
  for (const lintOnSave of ['', null, false, 0, 7, ['package'], {}]) expect(goCheckPlan({ ...lint, 'go.lintOnSave': lintOnSave }, facts)).toEqual([]);
  // A file that is not a full path has no folder to run in.
  expect(goCheckPlan(lint, { file: 'main.go' })).toEqual([]);
  // The commands "Go: Lint Current Package" and "Go: Lint Workspace" name the scope themselves.
  expect(goLintCommand({ ...lint, 'go.lintOnSave': 'off' }, facts, 'workspace')).toEqual({ program: 'staticcheck', args: ['./...'], cwd: workspace });
  // Every linter of the setting, and a person's own, is run by its name.
  for (const tool of [...goLintTools, 'my-linter']) expect(goCheckPlan({ 'go.lintTool': tool }, facts)[0].program).toBe(tool);
});

test('go.lintFlags come first, and only golangci-lint gets flags of its own', () => {
  const flags = (lintFlags: unknown, lintTool = 'revive') => goCheckPlan({ 'go.lintTool': lintTool, 'go.lintFlags': lintFlags }, facts)[0].args;
  expect(flags(['-min_confidence=.8'], 'golint')).toEqual(['-min_confidence=.8']);
  expect(flags(['-formatter', 'default', '--json', '-set_exit_status'])).toEqual(['-formatter', 'default', '-set_exit_status']);
  // A configuration file is resolved against the project folder and the home folder; one that names no file is dropped.
  expect(flags(['-config=${workspaceFolder}/revive.toml'])).toEqual([`-config=${workspace}/revive.toml`]);
  expect(flags(['--config=${workspaceRoot}/lint/${workspaceFolderBasename}.toml'])).toEqual([`--config=${workspace}/lint/app.toml`]);
  expect(flags(['--config=~/revive.toml'])).toEqual([`--config=${path.join(home, 'revive.toml')}`]);
  expect(flags(['--config= ', '-config=', '-exclude=a'])).toEqual(['-exclude=a']);
  expect(flags(['--config=/etc/revive.toml', '--config', '${workspaceFolder}/x'])).toEqual(['--config=/etc/revive.toml', '--config', '${workspaceFolder}/x']);
  // Without a project folder only `~` is resolved.
  expect(goCheckPlan({ 'go.lintTool': 'revive', 'go.lintFlags': ['-config=${workspaceFolder}/r.toml'] }, { file, home })[0].args).toEqual(['-config=${workspaceFolder}/r.toml']);
  // What is not a list of texts.
  for (const lintFlags of [undefined, null, '-fix', { a: 1 }, 7]) expect(flags(lintFlags)).toEqual([]);
  expect(flags(['-a', 7, null, ['-b'], { flag: '-c' }, '-d', 'x'.repeat(5000)])).toEqual(['-a', '-d']);
  expect(flags(Array.from({ length: 1000 }, (_, index) => `-flag${index}`))).toHaveLength(200);

  // golangci-lint v1: `run`, findings are not a failure, and one line per finding.
  expect(flags([], 'golangci-lint')).toEqual(['run', '--issues-exit-code=0', '--print-issued-lines=false', '--out-format=line-number']);
  expect(flags(['--fast'], 'golangci-lint')).toEqual(['run', '--fast', '--issues-exit-code=0', '--print-issued-lines=false', '--out-format=line-number']);
  // What a person already wrote is not written twice.
  expect(flags(['run', '--out-format=line-number', '--issues-exit-code=0'], 'golangci-lint')).toEqual(['run', '--out-format=line-number', '--issues-exit-code=0', '--print-issued-lines=false']);
  // golangci-lint v2 has other names for the same, and prints full paths.
  expect(flags([], 'golangci-lint-v2')).toEqual(['run', '--issues-exit-code=0', '--output.text.print-issued-lines=false', '--show-stats=false', '--output.text.path=stdout', '--path-mode=abs']);
  expect(flags(['--path-mode=', '--show-stats=false'], 'golangci-lint-v2')).toEqual(['run', '--path-mode=', '--show-stats=false', '--issues-exit-code=0', '--output.text.print-issued-lines=false', '--output.text.path=stdout']);
  // What is linted comes last.
  expect(goCheckPlan({ 'go.lintTool': 'golangci-lint-v2', 'go.lintOnSave': 'workspace', 'go.lintFlags': ['--fast-only'] }, facts)).toEqual([{ program: 'golangci-lint-v2', cwd: workspace,
    args: ['run', '--fast-only', '--issues-exit-code=0', '--output.text.print-issued-lines=false', '--show-stats=false', '--output.text.path=stdout', '--path-mode=abs', './...'] }]);
});

test('an installed golangci-lint says which flags it understands', () => {
  // The answers of `go version -m <program>` the extension's own source describes.
  const modules = '/home/a/go/bin/golangci-lint: go1.24.2\n\tpath\tgithub.com/golangci/golangci-lint/v2/cmd/golangci-lint\n\tmod\tgithub.com/golangci/golangci-lint/v2\tv2.1.6\th1:LXqShFfAGM5BDzEOWD2SL1IzJAgUOqES/HRBsfKjI+w=\n\tdep\t4d63.com/gocheckcompilerdirectives\tv1.3.0\th1:Ew5y5CtcAAQeTVKUVFrE7EwHMrTO6BggtEj8BZSjZ3A=\n';
  expect(goToolVersionArguments('/home/a/go/bin/golangci-lint')).toEqual(['version', '-m', '/home/a/go/bin/golangci-lint']);
  expect(goToolModuleVersion(modules)).toBe('v2.1.6');
  expect(goToolModuleVersion('/home/a/go/bin/gopls: go1.16\n\tpath\tgolang.org/x/tools/gopls\n\tmod\tgolang.org/x/tools/gopls\t(devel)\n')).toBe('(devel)');
  // Built without modules, or nothing that can be read.
  for (const printed of ['/home/a/go/bin/golint: go1.16\n', '', 'one\ntwo\nthree', '\n\n\n']) expect(goToolModuleVersion(printed)).toBeUndefined();

  expect(golangciMajor('golangci-lint-v2')).toBe(2);
  expect(golangciMajor('golangci-lint-v2', 'v1.64.8')).toBe(2);
  expect(golangciMajor('golangci-lint')).toBe(1);
  expect(golangciMajor('golangci-lint', 'v1.64.8')).toBe(1);
  expect(golangciMajor('golangci-lint', 'v2.1.6')).toBe(2);
  expect(golangciMajor('golangci-lint', '(devel)')).toBe(2);

  // A program named golangci-lint that is the second major version gets the second version's flags.
  const settings = { 'go.lintTool': 'golangci-lint' };
  expect(goCheckPlan(settings, { ...facts, moduleVersion: goToolModuleVersion(modules) })[0].args).toContain('--output.text.path=stdout');
  expect(goCheckPlan(settings, { ...facts, moduleVersion: 'v1.64.8' })[0].args).toContain('--out-format=line-number');
});

test('what a linter printed becomes warnings by file', () => {
  const cwd = path.dirname(file);
  // staticcheck, relative to the folder it ran in.
  expect(parseGoCheckOutput('staticcheck', 'main.go:12:2: should use fmt.Println instead of fmt.Print (S1038)\nhandler.go:40:6: func unused is unused (U1000)\nmain.go:30:9: error strings should not be capitalized (ST1005)\n', cwd)).toEqual(new Map([
    [file, [warning(11, 1, 'should use fmt.Println instead of fmt.Print (S1038)', 'go-staticcheck'), warning(29, 8, 'error strings should not be capitalized (ST1005)', 'go-staticcheck')]],
    [path.join(cwd, 'handler.go'), [warning(39, 5, 'func unused is unused (U1000)', 'go-staticcheck')]]]));
  // golangci-lint v2 prints full paths; a run over the project prints paths below it.
  expect(parseGoCheckOutput('golangci-lint-v2', `${file}:8:2: Error return value of \`w.Write\` is not checked (errcheck)\n`, workspace)).toEqual(new Map([[file, [warning(7, 1, 'Error return value of `w.Write` is not checked (errcheck)', 'go-golangci-lint-v2')]]]));
  expect([...parseGoCheckOutput('revive', 'cmd/serve/main.go:3:1: exported function Run should have comment or be unexported\n', workspace).keys()]).toEqual([file]);
  expect([...parseGoCheckOutput('revive', './cmd/serve/main.go:3:1: exported function Run should have comment or be unexported\n', workspace).keys()]).toEqual([file]);
  // No column: the first character. A prefix before the file is passed over.
  expect(parseGoCheckOutput('golint', 'main.go:5: exported type T should have comment\nvet: main.go:7:3: unreachable code\n', cwd).get(file)).toEqual([
    warning(4, 0, 'exported type T should have comment', 'go-lint'), warning(6, 2, 'unreachable code', 'go-lint')]);
  // A line that starts with a tab continues the finding before it; before any finding it is nothing.
  expect(parseGoCheckOutput('my-linter', '\tstray\nmain.go:1:1: first\n\tsecond line\n\tthird line\nmain.go:2:1: next\n', cwd).get(file)).toEqual([
    warning(0, 0, 'first\n\tsecond line\n\tthird line', 'go-my-linter'), warning(1, 0, 'next', 'go-my-linter')]);
  // Windows line ends.
  expect(parseGoCheckOutput('revive', 'main.go:3:1: one\r\nmain.go:4:1: two\r\n', cwd).get(file)?.map(found => found.message)).toEqual(['one', 'two']);

  expect(goLintSource('golint')).toBe('go-lint');
  expect(goLintSource(undefined)).toBe('go-lint');
  expect(goLintSource('')).toBe('go-lint');
  expect(goLintSource('revive')).toBe('go-revive');
  expect(goLintSeverity).toBe(2);
});

test('lines that are no finding, vendored files and endless output', () => {
  const cwd = path.dirname(file);
  const nothing = ['', '\n\n', 'ok  \texample.com/app\t0.012s', '# example.com/app', 'level=warning msg="config file not found"', 'main.go: no line', 'main.go:x:1: not a number',
    'main.go:3:1:no space before the message', ':3:1: no file', `main.go:${'9'.repeat(40)}:1: a line no file has`, `main.go:3:${'9'.repeat(40)}: a column no line has`, '3 issues:', '* errcheck: 3'];
  for (const output of nothing) expect(parseGoCheckOutput('staticcheck', output, cwd).size).toBe(0);
  expect(parseGoCheckOutput('staticcheck', nothing.join('\n'), cwd).size).toBe(0);

  // A dependency copied into the project is not the person's code. A full path is taken as written.
  const vendored = [`vendor${path.sep}github.com${path.sep}x${path.sep}y.go:1:1: in vendor`, `internal${path.sep}vendor${path.sep}z.go:2:1: in a nested vendor`, `vendored${path.sep}mine.go:3:1: not in vendor`].join('\n');
  expect([...parseGoCheckOutput('staticcheck', vendored, workspace).keys()]).toEqual([path.join(workspace, 'vendored', 'mine.go')]);
  expect(parseGoCheckOutput('staticcheck', `${path.join(workspace, 'vendor', 'x', 'y.go')}:1:1: full path`, workspace).size).toBe(1);

  // Line 0 does not exist; it is shown on the first line. A message is cut at 4096 characters, also when it is continued.
  expect(parseGoCheckOutput('staticcheck', 'main.go:0:0: at the top', cwd).get(file)).toEqual([warning(0, 0, 'at the top', 'go-staticcheck')]);
  expect(parseGoCheckOutput('staticcheck', `main.go:1:1: ${'m'.repeat(9000)}`, cwd).get(file)?.[0].message).toHaveLength(4096);
  expect(parseGoCheckOutput('staticcheck', `main.go:1:1: start\n${`\t${'m'.repeat(1500)}\n`.repeat(5)}`, cwd).get(file)?.[0].message).toHaveLength(4096);
  // No more findings than a person can use.
  const many = parseGoCheckOutput('staticcheck', Array.from({ length: 5000 }, (_, index) => `file${index % 10}.go:${index + 1}:1: finding ${index}`).join('\n'), cwd);
  expect([...many.values()].reduce((sum, found) => sum + found.length, 0)).toBe(2000);
  // A file named like something every object has is only a file.
  expect([...parseGoCheckOutput('staticcheck', '__proto__:1:1: odd name\nconstructor:2:1: odd name', cwd).keys()]).toEqual([path.join(cwd, '__proto__'), path.join(cwd, 'constructor')]);
});

test('with the text of the line, a finding reaches to its end', () => {
  const cwd = path.dirname(file), lines = ['package main', '', '\t\tfmt.Print("x\\n")  ', 'x'];
  const lineText = (asked: string, line: number) => asked === file ? lines[line] : undefined;
  const found = parseGoCheckOutput('staticcheck', 'main.go:3:7: with a column\nmain.go:3: without a column\nmain.go:4:9: a column past the end\nmain.go:99:1: a line the file does not have\nother.go:3:7: a file that is not open\n', cwd, lineText);
  expect(found.get(file)).toEqual([
    warning(2, 6, 'with a column', 'go-staticcheck', lines[2].length),
    // No column: from the first character that is not a space.
    warning(2, 2, 'without a column', 'go-staticcheck', lines[2].length),
    warning(3, 1, 'a column past the end', 'go-staticcheck', 8),
    warning(98, 0, 'a line the file does not have', 'go-staticcheck')]);
  expect(found.get(path.join(cwd, 'other.go'))).toEqual([warning(2, 6, 'a file that is not open', 'go-staticcheck')]);
});

test('a finding gopls already reported at the same place is dropped', () => {
  const gopls = (line: number, character: number, severity: 1 | 2 | 3 | 4 | undefined, message = 'from gopls'): Diagnostic => ({ range: { start: { line, character }, end: { line, character: character + 5 } }, message, severity, source: 'compiler' });
  const lint = [warning(11, 1, 'a', 'go-staticcheck'), warning(29, 8, 'b', 'go-staticcheck'), warning(40, 0, 'c', 'go-staticcheck')];
  expect(withoutDuplicates(lint, [])).toEqual(lint);
  expect(withoutDuplicates([], [gopls(11, 1, 2)])).toEqual([]);
  // The same start and the same severity: gopls said it. Where the report ends does not matter, nor what it says.
  expect(withoutDuplicates(lint, [gopls(11, 1, 2)])).toEqual([lint[1], lint[2]]);
  // gopls is more severe there: dropped as well.
  expect(withoutDuplicates(lint, [gopls(29, 8, 1)])).toEqual([lint[0], lint[2]]);
  expect(withoutDuplicates(lint, [gopls(29, 8, undefined)])).toEqual([lint[0], lint[2]]);
  // gopls only hints there: the warning is more severe and stays.
  expect(withoutDuplicates(lint, [gopls(40, 0, 3), gopls(40, 0, 4)])).toEqual(lint);
  // Several reports of gopls at one place: the most severe decides.
  expect(withoutDuplicates(lint, [gopls(40, 0, 4), gopls(40, 0, 2), gopls(40, 0, 3)])).toEqual([lint[0], lint[1]]);
  // Another character of the same line, or another line, is another place.
  expect(withoutDuplicates(lint, [gopls(11, 2, 1), gopls(12, 1, 1), gopls(29, 0, 1)])).toEqual(lint);
  // A finding without a severity counts as an error: a warning of gopls does not hide it, an error of gopls does.
  const bare: Diagnostic = { range: lint[0].range, message: 'bare' };
  expect(withoutDuplicates([bare], [gopls(11, 1, 2)])).toEqual([bare]);
  expect(withoutDuplicates([bare], [gopls(11, 1, 1)])).toEqual([]);
  // The lists given are not changed.
  expect(lint).toHaveLength(3);
});

test('a tool runs with go.toolsEnvVars added to the environment', () => {
  const env = { PATH: '/usr/bin', HOME: home, GOFLAGS: '-mod=mod -json', CC: 'clang' };
  expect(goToolEnvironment(env, {})).toEqual({ ...env, GOFLAGS: '-mod=mod' });
  expect(env.GOFLAGS).toBe('-mod=mod -json');
  expect(goToolEnvironment({ PATH: '/usr/bin' }, undefined)).toEqual({ PATH: '/usr/bin' });
  const settings = { 'go.toolsEnvVars': { GOOS: 'linux', CGO_ENABLED: 0, GOFLAGS: '-tags=integration --json=1', GOCACHE: '${workspaceFolder}/.cache', GOBIN: '~/bin', CC: '${env:CC} -v${env: MISSING }', DEBUG: true,
    SKIPPED: null, ALSO: { nested: 1 }, 'BAD=NAME': 'x', '': 'x' } };
  expect(goToolEnvironment(env, settings, { workspace, home })).toEqual({ PATH: '/usr/bin', HOME: home, GOOS: 'linux', CGO_ENABLED: '0', GOFLAGS: '-tags=integration', GOCACHE: `${workspace}/.cache`, GOBIN: path.join(home, 'bin'), CC: 'clang -v', DEBUG: 'true' });
  // Without a project folder its placeholder stays as written.
  expect(goToolEnvironment({}, { go: { toolsEnvVars: { GOCACHE: '${workspaceFolder}/.cache' } } }).GOCACHE).toBe('${workspaceFolder}/.cache');
  for (const toolsEnvVars of [null, 'GOOS=linux', ['GOOS=linux'], 7]) expect(goToolEnvironment({ A: '1' }, { 'go.toolsEnvVars': toolsEnvVars })).toEqual({ A: '1' });
});

type Call = { file: string; args: string[]; options: Parameters<RunCheck>[2] };
function recorded(answer: (call: Call) => CheckRun | Promise<CheckRun>): { calls: Call[]; run: RunCheck } {
  const calls: Call[] = [];
  return { calls, run: async (program, args, options) => { calls.push({ file: program, args, options }); return answer({ file: program, args, options }); } };
}

test('a plan is run and its findings returned', async () => {
  const plan = goCheckPlan({ 'go.lintTool': 'staticcheck', 'go.lintFlags': ['-checks=all'] }, facts), cwd = path.dirname(file), env = { PATH: '/usr/bin' };
  // staticcheck ends with status 1 when it found something, and writes nothing to its error output.
  const { calls, run } = recorded(() => ({ stdout: 'main.go:12:2: should use fmt.Println (S1038)\n', stderr: '', error: 1 }));
  const result = await runGoCheck(plan, { env, find: program => `/home/a/go/bin/${program}`, run });
  expect(calls).toEqual([{ file: '/home/a/go/bin/staticcheck', args: ['-checks=all'], options: { env, cwd, signal: undefined } }]);
  expect(result).toEqual({ diagnostics: new Map([[file, [warning(11, 1, 'should use fmt.Println (S1038)', 'go-staticcheck')]]]), missing: [], log: [`${cwd}>Finished running tool: /home/a/go/bin/staticcheck -checks=all`] });

  // Without a way to find programs the name is run as it is. Nothing printed: nothing found.
  const byName = recorded(() => ({ stdout: '', stderr: '' }));
  expect((await runGoCheck(plan, { env, run: byName.run })).diagnostics.size).toBe(0);
  expect(byName.calls[0].file).toBe('staticcheck');
  // The text of open files is used for where a finding ends.
  const open = await runGoCheck(plan, { env, run: recorded(() => ({ stdout: 'main.go:1:1: x\n', stderr: '' })).run, lineText: () => 'package main' });
  expect(open.diagnostics.get(file)).toEqual([warning(0, 0, 'x', 'go-staticcheck', 12)]);
  // An empty plan runs nothing.
  expect(await runGoCheck([], { env, run })).toEqual({ diagnostics: new Map(), missing: [], log: [] });
  expect(calls).toHaveLength(1);
});

test('a linter that is not installed is reported and not installed', async () => {
  const plan = goCheckPlan({ 'go.lintTool': 'golangci-lint-v2' }, facts), env = {};
  const { calls, run } = recorded(() => ({ stdout: '', stderr: '' }));
  expect(await runGoCheck(plan, { env, find: () => undefined, run })).toEqual({ diagnostics: new Map(), missing: ['golangci-lint-v2'], log: [] });
  expect(await runGoCheck(plan, { env, find: async () => '', run })).toMatchObject({ missing: ['golangci-lint-v2'] });
  expect(calls).toEqual([]);
  // Found by name and then not there when started.
  expect(await runGoCheck(plan, { env, run: recorded(() => ({ stdout: '', stderr: '', error: 'ENOENT' })).run })).toEqual({ diagnostics: new Map(), missing: ['golangci-lint-v2'], log: [] });
  // The name is one the tool table can offer to install.
  expect(goTool('golangci-lint-v2')?.importPath).toBe('github.com/golangci/golangci-lint/v2/cmd/golangci-lint');
});

test('a linter that fails with a message gives no findings, and a stopped run gives none', async () => {
  const plan = goCheckPlan({ 'go.lintTool': 'revive', 'go.lintFlags': ['-config=missing.toml'] }, facts), env = {}, cwd = path.dirname(file);
  const failed = await runGoCheck(plan, { env, run: recorded(() => ({ stdout: 'main.go:1:1: half a run\n', stderr: `cannot read the config file\n${'e'.repeat(9000)}`, error: 1 })).run });
  expect(failed.diagnostics.size).toBe(0);
  expect(failed.missing).toEqual([]);
  expect(failed.log[0]).toBe('Error while running tool: revive -config=missing.toml');
  expect(failed.log[1]).toHaveLength(4096);
  // Words on the error output of a run that ended well are not a failure.
  const noisy = await runGoCheck(plan, { env, run: recorded(() => ({ stdout: 'main.go:1:1: found\n', stderr: 'level=warning msg="deprecated option"\n' })).run });
  expect(noisy.diagnostics.get(file)).toHaveLength(1);
  // A runner that throws, and one that answers with something else than text.
  const thrown = await runGoCheck(plan, { env, run: async () => { throw new Error('spawn EACCES'); } });
  expect(thrown).toEqual({ diagnostics: new Map(), missing: [], log: ['Error while running tool: revive -config=missing.toml', 'spawn EACCES'] });
  const odd = await runGoCheck(plan, { env, run: async () => ({ stdout: 7, stderr: null }) as unknown as CheckRun });
  expect(odd).toEqual({ diagnostics: new Map(), missing: [], log: [`${cwd}>Finished running tool: revive -config=missing.toml`] });

  // Stopped before it started, and while it ran.
  const stopped = new AbortController(); stopped.abort(new Error('a newer save'));
  const never = recorded(() => ({ stdout: '', stderr: '' }));
  await expect(runGoCheck(plan, { env, run: never.run, signal: stopped.signal })).rejects.toThrow('a newer save');
  expect(never.calls).toEqual([]);
  const during = new AbortController();
  await expect(runGoCheck(plan, { env, signal: during.signal, run: async () => { during.abort(new Error('saved again')); return { stdout: 'main.go:1:1: half\n', stderr: '', error: 'SIGTERM' }; } })).rejects.toThrow('saved again');
});

test.skipIf(process.platform === 'win32')('a real program is started in the folder of the plan', async () => {
  const script = async (name: string, body: string) => { const program = path.join(directory, name); await writeFile(program, `#!/bin/sh\n${body}\n`); await chmod(program, 0o755); return program; };
  const found = await script('found', 'echo "main.go:3:1: exported function Run should have comment or be unexported ($LINT_NOTE in $(pwd))"\nexit 1');
  const broken = await script('broken', 'echo "main.go:1:1: half a run"\necho "cannot read the config file" >&2\nexit 2');
  const command = { program: 'revive', args: ['-formatter', 'default'], cwd: directory }, env = { ...process.env, LINT_NOTE: 'noted' };

  const result = await runGoCheck([command], { env, find: () => found });
  expect(result.diagnostics).toEqual(new Map([[path.join(directory, 'main.go'), [warning(2, 0, `exported function Run should have comment or be unexported (noted in ${directory})`, 'go-revive')]]]));
  expect(result.log).toEqual([`${directory}>Finished running tool: ${found} -formatter default`]);
  expect(await runGoCheck([command], { env, find: () => broken })).toEqual({ diagnostics: new Map(), missing: [], log: [`Error while running tool: ${broken} -formatter default`, 'cannot read the config file\n'] });
  expect(await runGoCheck([command], { env, find: () => path.join(directory, 'absent') })).toEqual({ diagnostics: new Map(), missing: ['revive'], log: [] });
});

const upstream = fileURLToPath(new URL('../../../../../vendor/vscode-go/extension', import.meta.url));
test.skipIf(!existsSync(path.join(upstream, 'package.json')))('the copied rules are the ones vendor/vscode-go states', () => {
  const source = (name: string) => readFileSync(path.join(upstream, 'src', name), 'utf8');

  // goCheck.ts: build and vet are behind "no language server"; lint is not.
  const check = source('diagnostics/goCheck.ts');
  expect(check).toContain("const disableBuildAndVet = goConfig.get('useLanguageServer');");
  expect(check).toContain("buildDiagnosticCollection &&\n\t\t!disableBuildAndVet &&\n\t\t!!goConfig['buildOnSave'] &&\n\t\tgoConfig['buildOnSave'] !== 'off'");
  expect(check).toContain("if (vetDiagnosticCollection && !disableBuildAndVet && !!goConfig['vetOnSave'] && goConfig['vetOnSave'] !== 'off') {");
  expect(check).toContain("if (lintDiagnosticCollection && !!goConfig['lintOnSave'] && goConfig['lintOnSave'] !== 'off') {");
  expect(check).toContain("goLint(fileUri, goConfig, goConfig['lintOnSave']).then((errors) => ({");
  expect(check.match(/disableBuildAndVet/g)).toHaveLength(3);

  // package.json: the settings, their values and what applies when nothing is written.
  const properties = (JSON.parse(readFileSync(path.join(upstream, 'package.json'), 'utf8')) as { contributes: { configuration: { properties: Record<string, { default?: unknown; enum?: string[] }> } } }).contributes.configuration.properties;
  expect(properties['go.useLanguageServer'].default).toBe(true);
  expect(properties['go.lintOnSave']).toMatchObject({ default: goLintOnSaveDefault, enum: goLintScopes });
  expect(properties['go.lintTool'].enum).toEqual(goLintTools);
  expect(Object.hasOwn(properties['go.lintTool'], 'default')).toBe(false);
  expect(properties['go.lintFlags'].default).toEqual([]);
  expect(properties['go.toolsEnvVars'].default).toEqual({});
  // What would run without gopls, and what is off unless a person turns it on.
  expect([properties['go.buildOnSave'].default, properties['go.vetOnSave'].default, properties['go.testOnSave'].default, properties['go.coverOnSave'].default]).toEqual(['package', 'package', false, false]);

  // goLint.ts: no linter named, the folder, the flags, golangci-lint, the scope, how it is run and stopped.
  const lint = source('diagnostics/goLint.ts');
  expect(lint).toContain("const linter = goConfig.get<string>('lintTool');\n\tif (linter === undefined || linter === '') {");
  expect(lint).toContain("const cwd = scope === 'workspace' && currentWorkspace ? currentWorkspace : path.dirname(fileUri?.fsPath ?? '');");
  expect(lint).toContain('if (!path.isAbsolute(cwd)) {');
  expect(lint).toContain("if (flag === '--json') {");
  expect(lint).toContain("if (flag.startsWith('--config=') || flag.startsWith('-config=')) {");
  expect(lint).toContain('configFilePath = resolvePath(configFilePath);');
  expect(lint).toContain("if (linter.startsWith('golangci-lint')) {");
  expect(lint).toContain("if (linter === 'golangci-lint-v2') {\n\t\t\tversion = 2;");
  expect(lint).toContain('const { moduleVersion } = await inspectGoToolVersion(getBinPath(linter));');
  expect(lint).toContain("version = !moduleVersion || moduleVersion.startsWith('v1') ? 1 : 2;");
  expect(lint).toContain("if (args.indexOf('run') === -1) {\n\t\t\targs.unshift('run');");
  // Every flag the extension adds, in its order, is the flag added here.
  const added = (text: string) => [...text.matchAll(/args\.push\('(--[^']+)'\);/g)].map(match => match[1]);
  const golangci = lint.slice(lint.indexOf("if (linter.startsWith('golangci-lint')) {"), lint.indexOf("if (scope === 'workspace' && currentWorkspace) {"));
  const [common, first, second] = [golangci.slice(0, golangci.indexOf('case 1:')), golangci.slice(golangci.indexOf('case 1:'), golangci.indexOf('case 2:')), golangci.slice(golangci.indexOf('case 2:'))];
  const flags = (lintTool: string) => goCheckPlan({ 'go.lintTool': lintTool }, facts)[0].args;
  expect(['run', ...added(common), ...added(first)]).toEqual(flags('golangci-lint'));
  expect(['run', ...added(common), ...added(second)]).toEqual(flags('golangci-lint-v2'));
  expect(second).toContain("if (!args.some((v) => v.startsWith('--path-mode='))) {");
  expect(lint).toContain("if (scope === 'workspace' && currentWorkspace) {\n\t\targs.push('./...');");
  expect(lint).toContain("} else if (scope === 'file') {\n\t\targs.push(fileUri?.fsPath ?? '');");
  expect(lint).toContain('const lintEnv = toolExecutionEnvironment();');
  expect(lint).toContain("const lintPromise = runTool(args, cwd, 'warning', false, linter, lintEnv, false, tokenSource.token).then(");
  expect(lint).toContain('if (running) {\n\t\t\ttokenSource.cancel();');
  expect(lint).not.toMatch(/timeout/i);

  // diagnostics.ts: running, reading, making findings, and what gopls already said.
  const diagnostics = source('diagnostics/diagnostics.ts');
  expect(diagnostics).toContain("if (err && (<any>err).code === 'ENOENT') {");
  expect(diagnostics).toContain('if (err && stderr && !useStdErr) {');
  expect(diagnostics).toContain("const lines = (useStdErr ? stderr : stdout).toString().split('\\n');");
  expect(diagnostics).toContain("outputChannel.error(['Error while running tool:', cmd, ...args].join(' '));");
  expect(diagnostics).toContain("outputChannel.info([cwd + '>Finished running tool:', cmd, ...args].join(' '));");
  expect(diagnostics).toContain("if (l[0] === '\\t' && ret.length > 0) {\n\t\t\t\t\t\tret[ret.length - 1].msg += '\\n' + l;");
  expect(diagnostics).toContain(`const match = ${String(goCheckLine)}.exec(l);`);
  expect(diagnostics).toContain('const [, , file, , lineStr, , colStr, msg] = match;');
  expect(diagnostics).toContain('!path.isAbsolute(file) &&\n\t\t\t\t\t\t(file.startsWith(`vendor${path.sep}`) || file.indexOf(`${path.sep}vendor${path.sep}`) > -1)');
  expect(diagnostics).toContain('const filePath = path.resolve(cwd, file);');
  expect(diagnostics).toContain('let startColumn = error.col ? error.col - 1 : 0;\n\t\t\tlet endColumn = startColumn + 1;');
  expect(diagnostics).toContain('startColumn = leading.length; // beginning of the non-white space.');
  expect(diagnostics).toContain('range = new vscode.Range(error.line - 1, startColumn, error.line - 1, endColumn);');
  expect(diagnostics).toContain("if (error.severity === 'warning') {\n\t\t\tseverity = vscode.DiagnosticSeverity.Warning;");
  expect(diagnostics).toContain('diag.source = collection.name;');
  expect(diagnostics).toContain('goCtx.languageClient?.diagnostics, // #0 Gopls (Highest)');
  expect(diagnostics).toContain('goCtx.lintDiagnosticCollection // #3 Lint (Lowest)');
  expect(diagnostics.match(/const key = `\$\{diag\.range\.start\.line\}:\$\{diag\.range\.start\.character\}`;/g)).toHaveLength(2);
  expect(diagnostics).toContain('if (current === undefined || diag.severity < current) {');
  expect(diagnostics).toContain('if (maxMaskingSeverity === undefined || diag.severity < maxMaskingSeverity) {');
  expect(diagnostics).toContain('collection.set(uri, filterDiags(collection.get(uri)!, diagnostics));');

  // goMain.ts and runBuilds.ts: what a save starts, and the name findings are filed under.
  const main = source('goMain.ts');
  expect(main).toContain("function lintDiagnosticCollectionName(lintToolName: string) {\n\tif (!lintToolName || lintToolName === 'golint') {\n\t\treturn 'go-lint';\n\t}\n\treturn `go-${lintToolName}`;\n}");
  expect(main).toContain("if (vscode.window.visibleTextEditors.some((e) => e.document.fileName === document.fileName)) {\n\t\t\t\tvscode.commands.executeCommand('go.builds.run', document, getGoConfig(document.uri));");
  expect(main).toContain("registerCommand('go.lint.package', lintCode('package'));");
  expect(main).toContain("registerCommand('go.lint.workspace', lintCode('workspace'));");
  expect(source('commands/runBuilds.ts')).toContain('lintDiagnosticCollection?.clear();\n\t\tvetDiagnosticCollection?.clear();\n\t\tcheck(goCtx, document.uri, goConfig)');

  // goInstallTools.ts: the version of an installed tool.
  const install = source('goInstallTools.ts');
  expect(install).toContain("const { stdout } = await execFile(goCmd, ['version', '-m', binPath]);");
  expect(install).toContain("const lines = stdout.split('\\n', 3);");
  expect(install).toContain('const moduleVersion = lines[2].split(/\\s+/)[3];');

  // goEnv.ts, util.ts, pathUtils.ts: the environment, and the placeholders of a setting.
  const environment = source('goEnv.ts');
  expect(environment).toContain("? resolvePath(substituteEnv(toolsEnvVars[key]))");
  expect(environment).toContain("env['GOFLAGS'] = env['GOFLAGS'].replace(/(^|\\s+)-?-json[^\\s]*/g, '');");
  const util = source('util.ts');
  expect(util).toContain('return input.replace(/\\${env:([^}]+)}/g, (match, capture) => {\n\t\treturn process.env[capture.trim()] || \'\';');
  expect(util).toContain('inputPath = inputPath.replace(/\\${workspaceFolder}|\\${workspaceRoot}/g, workspaceFolder);');
  expect(util).toContain('inputPath = inputPath.replace(/\\${workspaceFolderBasename}/g, path.basename(workspaceFolder));');
  expect(source('utils/pathUtils.ts')).toContain("return inputPath.startsWith('~') ? path.join(os.homedir(), inputPath.substr(1)) : inputPath;");
});
