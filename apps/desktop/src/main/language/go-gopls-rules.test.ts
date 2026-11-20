import { expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ClientCapabilities } from 'vscode-languageserver-protocol';
import { GoplsProgressLog, goInlayHints, goTestCommand, goTestEnvironment, goTestTimeoutDefault, goVulncheckModes, goplsCapabilities, goplsCommand, goplsCommandFailure, goplsCommands,
  goplsConfiguration, goplsHasCommand, goplsOptionName, goplsOptionSince, goplsOptions, goplsOwnOptions, goplsProgressStyles, goplsProgressToken, goplsRules, goplsRunTests, goplsTokenModifiers,
  goplsVersionArguments, govulncheckBusy, govulncheckEnd, installedGoplsVersion, knownPackages, vulncheckToggle, zedGoplsDefaults, type GoplsCommand, type GoplsCommandContext } from './go-gopls-rules';

const workspace = path.resolve('/work/app'), file = path.join(workspace, 'store', 'store_test.go'), uri = pathToFileURL(file).href, home = path.resolve('/home/a');
const range = { start: { line: 11, character: 5 }, end: { line: 11, character: 9 } };

test('gopls is told its own token modifiers and that progress may be a log', () => {
  const general: ClientCapabilities = {
    textDocument: { hover: { contentFormat: ['markdown'] }, semanticTokens: { requests: { full: true }, tokenTypes: ['function'], tokenModifiers: ['declaration', 'readonly'], formats: ['relative'] } },
    window: { workDoneProgress: true }, experimental: { serverStatusNotification: true } };
  const told = goplsCapabilities(general);
  expect(told.textDocument?.semanticTokens?.tokenModifiers).toEqual(['declaration', 'readonly', ...goplsTokenModifiers]);
  expect(told.textDocument?.semanticTokens?.tokenTypes).toEqual(['function']);
  expect(told.textDocument?.hover).toEqual({ contentFormat: ['markdown'] });
  expect(told.window).toEqual({ workDoneProgress: true });
  expect(told.experimental).toEqual({ serverStatusNotification: true, progressMessageStyles: ['log'] });
  // The forms of gopls are not declared.
  expect(JSON.stringify(told)).not.toContain('interactiveResolve');
  // What was given is not changed, and telling twice adds nothing twice.
  expect(general.textDocument?.semanticTokens?.tokenModifiers).toEqual(['declaration', 'readonly']);
  expect(general.experimental).toEqual({ serverStatusNotification: true });
  expect(goplsCapabilities(told)).toEqual(told);
  // No semantic tokens declared: none are added. An `experimental` that is no object is replaced.
  expect(goplsCapabilities({})).toEqual({ experimental: { progressMessageStyles: ['log'] } });
  expect(goplsCapabilities({ textDocument: { hover: {} }, experimental: 'yes' })).toEqual({ textDocument: { hover: {} }, experimental: { progressMessageStyles: ['log'] } });
  expect(goplsCapabilities({ textDocument: { semanticTokens: { requests: {}, tokenTypes: [], formats: [] } as never } }).textDocument?.semanticTokens?.tokenModifiers).toEqual(goplsTokenModifiers);
});

test('a progress that starts with "style: log" is read as lines', () => {
  const log = new GoplsProgressLog();
  const progress = (token: unknown, value: unknown) => log.read({ token, value });
  expect(progress('t1', { kind: 'begin', title: 'Run govulncheck', message: 'style: log\n\nRunning...', cancellable: true })).toEqual({ token: 't1', title: 'Run govulncheck', lines: ['Running...'], done: false });
  expect(progress('t1', { kind: 'report', message: 'Scanning your code and 42 packages' })).toEqual({ token: 't1', title: 'Run govulncheck', lines: ['Scanning your code and 42 packages'], done: false });
  expect(progress('t1', { kind: 'report', percentage: 50 })).toEqual({ token: 't1', title: 'Run govulncheck', lines: [], done: false });
  expect(progress('t1', { kind: 'end', message: 'completed' })).toEqual({ token: 't1', title: 'Run govulncheck', lines: ['completed'], done: true });
  // Ended: the token is forgotten.
  expect(progress('t1', { kind: 'report', message: 'late' })).toBeUndefined();

  // Only the header, a numbered token, spaces around the header, and no paragraph past the second.
  expect(progress(7, { kind: 'begin', title: 'A', message: ' style: log ' })).toEqual({ token: 7, title: 'A', lines: [], done: false });
  expect(progress(8, { kind: 'begin', title: 'B', message: 'style: log\n\nfirst\n\nsecond' })?.lines).toEqual(['first']);
  expect(progress(7, { kind: 'end' })).toEqual({ token: 7, title: 'A', lines: [], done: true });
  expect(progress(9, { kind: 'begin', message: 'style: log\n\nx' })?.title).toBe('gopls');

  // Any other progress is not a log, and neither are its later messages.
  for (const message of ['Running go mod tidy', 'style: bar\n\nx', 'style:log', 'note\n\nstyle: log', '', undefined, 7]) {
    expect(progress('plain', { kind: 'begin', title: 'Tidy', message })).toBeUndefined();
    expect(progress('plain', { kind: 'report', message: 'half' })).toBeUndefined();
  }
  // What is no progress at all.
  for (const params of [undefined, null, 7, 'x', [], {}, { token: 't' }, { token: {}, value: { kind: 'begin', message: 'style: log' } }, { token: 't', value: 'begin' }, { token: 8, value: { kind: 'other', message: 'x' } }]) expect(log.read(params)).toBeUndefined();
  expect(progress(8, { kind: 'report', message: 'm'.repeat(9000) })?.lines[0]).toHaveLength(4096);
  expect(progress(10, { kind: 'begin', title: 't'.repeat(900), message: 'style: log' })?.title).toHaveLength(200);
});

test('the progress of the older govulncheck command is followed by its token', () => {
  const log = new GoplsProgressLog();
  const token = goplsProgressToken({ Token: 'vuln-1' });
  expect(token).toBe('vuln-1');
  expect(goplsProgressToken({ Token: 3, Result: {} })).toBe(3);
  for (const result of [undefined, null, 'vuln-1', {}, { Token: {} }, { token: 'lowercase' }, [{ Token: 'x' }]]) expect(goplsProgressToken(result)).toBeUndefined();

  expect(log.read({ token, value: { kind: 'report', message: 'before the command answered' } })).toBeUndefined();
  log.follow(token, 'govulncheck');
  // Its begin has no style header and is not a line; its reports and its end are.
  expect(log.read({ token, value: { kind: 'begin', title: 'govulncheck', message: 'Checking' } })).toBeUndefined();
  expect(log.read({ token, value: { kind: 'report', message: 'Vulnerability #1: GO-2026-0001' } })).toEqual({ token, title: 'govulncheck', lines: ['Vulnerability #1: GO-2026-0001'], done: false });
  expect(log.read({ token, value: { kind: 'end', message: 'completed' } })).toEqual({ token, title: 'govulncheck', lines: ['completed'], done: true });
  expect(govulncheckEnd('completed')).toBeUndefined();
  expect(govulncheckEnd('failed')).toBe('terminated without result: failed');
  expect(govulncheckEnd(undefined)).toBe('terminated without result: undefined');
  expect(govulncheckBusy).toBe('cannot start vulncheck while another vulncheck is in progress');
  // A token that is none is not followed, and no more logs are kept than a person could have going.
  log.follow({}, 'x'); log.follow(undefined, 'x');
  for (let index = 0; index < 500; index++) log.follow(`many-${index}`, 'x');
  expect(log.read({ token: 'many-63', value: { kind: 'report', message: 'kept' } })).toBeDefined();
  expect(log.read({ token: 'many-64', value: { kind: 'report', message: 'not kept' } })).toBeUndefined();
  expect(log.read({ token: 'late', value: { kind: 'begin', message: 'style: log\n\nx' } })).toBeUndefined();
});

test('a log progress is shown as work in progress and as lines of the log', () => {
  const log = new GoplsProgressLog();
  expect(log.signal({ token: 't', value: { kind: 'begin', title: 'Run govulncheck', message: 'style: log\n\nRunning...' } })).toEqual({ progress: { 'gopls log t': 'Run govulncheck' }, log: ['Run govulncheck: Running...'] });
  expect(log.signal({ token: 't', value: { kind: 'report', message: 'two\nlines' } })).toEqual({ progress: { 'gopls log t': 'Run govulncheck' }, log: ['Run govulncheck: two', 'Run govulncheck: lines'] });
  expect(log.signal({ token: 't', value: { kind: 'end' } })).toEqual({ progress: { 'gopls log t': undefined }, log: [] });
  expect(log.signal({ token: 'u', value: { kind: 'begin', title: 'Tidy', message: 'Running go mod tidy' } })).toBeUndefined();
  expect(log.signal(undefined)).toBeUndefined();
});

test('the installed gopls states its version', () => {
  expect(goplsVersionArguments).toEqual(['version', '-json']);
  expect(installedGoplsVersion('{"GoVersion":"go1.25.3","Path":"golang.org/x/tools/gopls","Main":{"Path":"golang.org/x/tools/gopls","Version":"v0.24.0","Sum":"h1:x="},"Deps":[]}')).toBe('v0.24.0');
  expect(installedGoplsVersion('{"Main":{"Version":"(devel)"}}')).toBe('(devel)');
  for (const printed of ['', 'golang.org/x/tools/gopls v0.7.0', '{}', '[]', 'null', '{"Main":null}', '{"Main":{"Version":7}}', '{"Main":{"Version":""}}', '{"Main":']) expect(installedGoplsVersion(printed)).toBeUndefined();
});

test('gopls gets what the person wrote under gopls, and the go settings it has an option for', () => {
  expect(goplsConfiguration({})).toEqual({});
  expect(goplsConfiguration(undefined)).toEqual({});
  // The `gopls` setting as written, whatever spelling a name has.
  const written = { 'ui.semanticTokens': true, 'ui.codelenses': { test: false }, staticcheck: true, 'build.directoryFilters': ['-node_modules'] };
  expect(goplsConfiguration({ gopls: written })).toEqual(written);
  expect(goplsConfiguration({ gopls: written })).not.toBe(written);
  for (const gopls of [null, 'staticcheck', ['staticcheck'], 7]) expect(goplsConfiguration({ gopls })).toEqual({});

  // Build flags and tags.
  expect(goplsConfiguration({ 'go.buildFlags': ['-mod=vendor'] })).toEqual({ 'build.buildFlags': ['-mod=vendor'] });
  expect(goplsConfiguration({ 'go.buildTags': 'integration,linux' })).toEqual({ 'build.buildFlags': ['-tags', 'integration,linux'] });
  expect(goplsConfiguration({ go: { buildFlags: ['-race'], buildTags: 'e2e' } })).toEqual({ 'build.buildFlags': ['-race', '-tags', 'e2e'] });
  // Tags already among the flags are not written twice, and flags the person gave gopls directly are not touched.
  expect(goplsConfiguration({ 'go.buildFlags': ['-tags', 'a'], 'go.buildTags': 'b' })).toEqual({ 'build.buildFlags': ['-tags', 'a'] });
  expect(goplsConfiguration({ gopls: { 'build.buildFlags': ['-x'] }, 'go.buildFlags': ['-race'], 'go.buildTags': 'e2e' })).toEqual({ 'build.buildFlags': ['-x'] });
  expect(goplsConfiguration({ gopls: { 'build.buildFlags': [] }, 'go.buildTags': 'e2e' })).toEqual({ 'build.buildFlags': [] });
  for (const settings of [{ 'go.buildFlags': [] }, { 'go.buildFlags': '-race' }, { 'go.buildFlags': [7, null] }, { 'go.buildTags': '' }, { 'go.buildTags': ['a'] }, { 'go.buildTags': null }]) expect(goplsConfiguration(settings)).toEqual({});

  // Inlay hints: only the ones a person wrote, on or off.
  expect(goplsConfiguration({ 'go.inlayHints.parameterNames': false, 'go.inlayHints.ignoredError': true })).toEqual({ 'ui.inlayhint.hints': { parameterNames: false, ignoredError: true } });
  expect(goplsConfiguration({ go: { inlayHints: { constantValues: true, unknownHint: true, rangeVariableTypes: 'yes' } } })).toEqual({ 'ui.inlayhint.hints': { constantValues: true } });
  expect(goplsConfiguration({ 'go.inlayHints': { assignVariableTypes: true } })).toEqual({ 'ui.inlayhint.hints': { assignVariableTypes: true } });
  expect(goplsConfiguration({ 'go.inlayHints': {} })).toEqual({});
  // As in the extension they take the place of hints written under gopls.
  expect(goplsConfiguration({ gopls: { 'ui.inlayhint.hints': { constantValues: true } }, 'go.inlayHints.parameterNames': true })).toEqual({ 'ui.inlayhint.hints': { parameterNames: true } });

  // Vulnerability scanning.
  for (const mode of goVulncheckModes) expect(goplsConfiguration({ 'go.diagnostic.vulncheck': mode })).toEqual({ 'ui.vulncheck': mode });
  expect(goplsConfiguration({ go: { diagnostic: { vulncheck: 'Imports' } } })).toEqual({ 'ui.vulncheck': 'Imports' });
  for (const vulncheck of ['', 'imports', 'On', true, null, ['Imports']]) expect(goplsConfiguration({ 'go.diagnostic.vulncheck': vulncheck })).toEqual({});

  // Nothing the extension leaves to itself is sent.
  expect(Object.keys(goplsConfiguration({ gopls: {}, 'go.lintTool': 'revive', 'go.toolsEnvVars': { GOOS: 'linux' }, 'go.useLanguageServer': true }))).toEqual([]);
  // A name every object has is no option.
  expect(Object.keys(goplsConfiguration({ gopls: JSON.parse('{"__proto__":{"staticcheck":true},"constructor":1,"staticcheck":false}') }))).toEqual(['staticcheck']);
});

test('an old gopls is not sent options it does not know', () => {
  const settings = { 'go.inlayHints.parameterNames': true, 'go.diagnostic.vulncheck': 'Imports', 'go.buildTags': 'e2e' };
  const sent = (installed?: string) => Object.keys(goplsConfiguration(settings, installed));
  expect(goplsOptionSince).toEqual({ hints: '0.8.4', vulncheck: '0.10.1' });
  expect(sent()).toEqual(['build.buildFlags', 'ui.inlayhint.hints', 'ui.vulncheck']);
  expect(sent('v0.24.0')).toEqual(['build.buildFlags', 'ui.inlayhint.hints', 'ui.vulncheck']);
  expect(sent('v0.10.2')).toEqual(['build.buildFlags', 'ui.inlayhint.hints', 'ui.vulncheck']);
  expect(sent('v0.10.1')).toEqual(['build.buildFlags', 'ui.inlayhint.hints']);
  expect(sent('v0.9.0')).toEqual(['build.buildFlags', 'ui.inlayhint.hints']);
  expect(sent('v0.8.4')).toEqual(['build.buildFlags']);
  expect(sent('0.7.5')).toEqual(['build.buildFlags']);
  // A pre-release of the version itself is older than it; one of the next version is newer.
  expect(sent('v0.10.1-pre.2')).toEqual(['build.buildFlags', 'ui.inlayhint.hints']);
  expect(sent('v0.11.0-pre.1')).toEqual(['build.buildFlags', 'ui.inlayhint.hints', 'ui.vulncheck']);
  // A gopls a person built states no version that can be compared: it counts as new.
  expect(sent('(devel)')).toEqual(['build.buildFlags', 'ui.inlayhint.hints', 'ui.vulncheck']);
  expect(sent('')).toEqual(['build.buildFlags', 'ui.inlayhint.hints', 'ui.vulncheck']);
});

test('options are laid over each other by the name gopls reads', () => {
  expect(goplsOptionName('ui.inlayhint.hints')).toBe('hints');
  expect(goplsOptionName('build.buildFlags')).toBe('buildFlags');
  expect(goplsOptionName('staticcheck')).toBe('staticcheck');

  // Zed's start, then what the person wrote in VS Code's names: one switch changes, the others stay.
  const settings = { gopls: { 'ui.semanticTokens': true, 'ui.completion.usePlaceholders': true, 'ui.codelenses': { vulncheck: true } }, 'go.inlayHints.parameterNames': false, 'go.buildTags': 'e2e' };
  expect(goplsOptions(zedGoplsDefaults(false), goplsConfiguration(settings))).toEqual({
    usePlaceholders: true,
    hints: { assignVariableTypes: true, compositeLiteralFields: true, compositeLiteralTypes: true, constantValues: true, functionTypeParameters: true, parameterNames: false, rangeVariableTypes: true },
    codelenses: { test: true, vulncheck: true },
    semanticTokens: true,
    buildFlags: ['-tags', 'e2e'] });
  // No name is left in two spellings, whichever layer it came from.
  expect(goplsOptions({ 'ui.inlayhint.hints': { a: true } }, { hints: { b: true } }, { 'ui.hints': { a: false } })).toEqual({ hints: { a: false, b: true } });
  // A list is replaced, not joined; nothing given is nothing.
  expect(goplsOptions({ buildFlags: ['-race'] }, { 'build.buildFlags': ['-x'] })).toEqual({ buildFlags: ['-x'] });
  expect(goplsOptions()).toEqual({});
  expect(goplsOptions(undefined, {}, undefined)).toEqual({});
  const defaults = zedGoplsDefaults(true);
  goplsOptions(defaults, { hints: { parameterNames: false } });
  expect(defaults).toEqual(zedGoplsDefaults(true));
});

test('the vulncheck toggle writes the setting', () => {
  expect(vulncheckToggle({})).toEqual({ title: 'Go: Toggle Vulncheck', setting: { name: 'go.diagnostic.vulncheck', value: 'Imports' } });
  expect(vulncheckToggle(undefined)).toMatchObject({ setting: { value: 'Imports' } });
  expect(vulncheckToggle({ 'go.diagnostic.vulncheck': 'Prompt' })).toMatchObject({ setting: { value: 'Imports' } });
  expect(vulncheckToggle({ 'go.diagnostic.vulncheck': 'Off' })).toMatchObject({ setting: { value: 'Imports' } });
  expect(vulncheckToggle({ go: { diagnostic: { vulncheck: 'Imports' } } })).toMatchObject({ setting: { value: 'Off' } });
});

test('a run test lens becomes a go test command for the terminal', () => {
  const lens = (tests: unknown, benchmarks: unknown = null) => [{ URI: uri, Tests: tests, Benchmarks: benchmarks }];
  expect(goplsRunTests).toBe('gopls.run_tests');
  expect(goTestCommand(goplsRunTests, lens(['TestSave']))).toEqual({ cwd: path.dirname(file), program: 'go', file, label: 'go test TestSave',
    args: ['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestSave$', '.'] });
  expect(goTestCommand(goplsRunTests, lens(['TestSave', 'TestLoad']))).toMatchObject({ label: 'go test TestSave, TestLoad', args: ['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^(TestSave|TestLoad)$', '.'] });
  // "run benchmark" and "run file benchmarks": no test runs beside them, and no time limit is set.
  expect(goTestCommand(goplsRunTests, lens(null, ['BenchmarkSave']))).toMatchObject({ label: 'go bench BenchmarkSave', args: ['test', '-test.fullpath=true', '-benchmem', '-run=^$', '-bench', '^BenchmarkSave$', '.'] });
  expect(goTestCommand(goplsRunTests, lens([], ['BenchmarkSave', 'BenchmarkLoad']))?.args).toEqual(['test', '-test.fullpath=true', '-benchmem', '-run=^$', '-bench', '^(BenchmarkSave|BenchmarkLoad)$', '.']);
  expect(goTestCommand(goplsRunTests, lens(['TestSave'], ['BenchmarkSave']))?.args).toEqual(['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestSave$', '-bench', '^BenchmarkSave$', '.']);
  // The form the extension's own rewrite expects: file, tests, benchmarks.
  expect(goTestCommand(goplsRunTests, [uri, ['TestSave'], []])).toMatchObject({ cwd: path.dirname(file), args: ['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestSave$', '.'] });
  expect(goTestCommand(goplsRunTests, [uri, [], ['BenchmarkSave']])?.label).toBe('go bench BenchmarkSave');
  // Names beyond ASCII are Go names too.
  expect(goTestCommand(goplsRunTests, lens(['Test저장_2']))?.args).toContain('^Test저장_2$');
});

test('the go test settings are the extension\'s', () => {
  const run = (settings: Record<string, unknown>, tests: unknown = ['TestSave'], benchmarks: unknown = null) => goTestCommand(goplsRunTests, [{ URI: uri, Tests: tests, Benchmarks: benchmarks }], settings, { workspace, home })?.args;
  expect(goTestTimeoutDefault).toBe('30s');
  expect(run({ 'go.testTimeout': '2m' })).toEqual(['test', '-test.fullpath=true', '-timeout', '2m', '-run', '^TestSave$', '.']);
  for (const testTimeout of ['', null, 30, ['1m']]) expect(run({ 'go.testTimeout': testTimeout })?.slice(2, 4)).toEqual(['-timeout', '30s']);
  // Tags: the test's own, or the build's when none are written for tests.
  expect(run({ 'go.buildTags': 'e2e' })).toEqual(['test', '-test.fullpath=true', '-timeout', '30s', '-tags', 'e2e', '-run', '^TestSave$', '.']);
  expect(run({ 'go.buildTags': 'e2e', 'go.testTags': 'unit' })).toContain('unit');
  expect(run({ 'go.buildTags': 'e2e', 'go.testTags': null })).toContain('e2e');
  expect(run({ 'go.buildTags': 'e2e', 'go.testTags': '' })).not.toContain('-tags');
  expect(run({ 'go.testTags': 'unit' }, null, ['BenchmarkSave'])).toEqual(['test', '-test.fullpath=true', '-benchmem', '-run=^$', '-tags', 'unit', '-bench', '^BenchmarkSave$', '.']);
  // The person's flags come last; their own -tags wins, their own -run gives way, and what follows -args stays at the very end.
  expect(run({ 'go.testFlags': ['-v', '-count=1'] })).toEqual(['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestSave$', '.', '-v', '-count=1']);
  expect(run({ 'go.testFlags': ['-tags', 'mine'], 'go.buildTags': 'e2e' })).toEqual(['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestSave$', '.', '-tags', 'mine']);
  expect(run({ 'go.testFlags': ['-v', '-run', 'TestOther', '-race', '-args', '-run', 'x', '-update'] })).toEqual(['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestSave$', '.', '-v', '-race', '-args', '-run', 'x', '-update']);
  // A benchmark uses no -run of its own, so the person's stays.
  expect(run({ 'go.testFlags': ['-run', 'TestOther'] }, null, ['BenchmarkSave'])).toEqual(['test', '-test.fullpath=true', '-benchmem', '-run=^$', '-bench', '^BenchmarkSave$', '.', '-run', 'TestOther']);
  // Without test flags the build flags are used, and a path in a flag is resolved.
  expect(run({ 'go.buildFlags': ['-race'] })).toEqual(['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestSave$', '.', '-race']);
  expect(run({ 'go.buildFlags': ['-race'], 'go.testFlags': ['-short'] })?.slice(-1)).toEqual(['-short']);
  expect(run({ 'go.buildFlags': ['-race'], 'go.testFlags': [] })?.slice(-1)).toEqual(['-race']);
  expect(run({ 'go.testFlags': ['-coverprofile=${workspaceFolder}/cover.out', '~/x'] })?.slice(-2)).toEqual([`-coverprofile=${workspace}/cover.out`, path.join(home, 'x')]);
  expect(run({ 'go.testFlags': '-v' })).toEqual(['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^TestSave$', '.']);
});

test('what is no run test lens gives no command', () => {
  const good = [{ URI: uri, Tests: ['TestSave'], Benchmarks: null }];
  expect(goTestCommand('gopls.tidy', good)).toBeUndefined();
  expect(goTestCommand('go.test.cursor', good)).toBeUndefined();
  for (const args of [undefined, null, 'x', {}, [], [null], [7], [{}], [{ URI: uri }], [{ URI: uri, Tests: [], Benchmarks: [] }], [{ URI: uri, Tests: 'TestSave' }], [{ URI: uri, Tests: [7, null] }],
    [{ Tests: ['TestSave'] }], [{ URI: 7, Tests: ['TestSave'] }], [{ URI: 'https://example.com/a_test.go', Tests: ['TestSave'] }], [{ URI: 'untitled:Untitled-1', Tests: ['TestSave'] }],
    [{ URI: 'file://%zz', Tests: ['TestSave'] }], [uri], [uri, 'TestSave'], [uri, [], []]]) expect(goTestCommand(goplsRunTests, args)).toBeUndefined();
  // A name is written into a pattern and a command line: only a Go name passes.
  for (const name of ['', 'Test Save', 'TestSave$|.*', 'Test;rm', '-run', 'Test/sub', '2Test', `Test${'x'.repeat(300)}`, 'Test$(x)', 'Test`x`']) {
    expect(goTestCommand(goplsRunTests, [{ URI: uri, Tests: [name] }])).toBeUndefined();
    expect(goTestCommand(goplsRunTests, [{ URI: uri, Tests: ['TestSave'], Benchmarks: [name] }])).toBeUndefined();
  }
});

test('a test runs with go.testEnvVars over the environment of a Go tool', () => {
  const settings = { 'go.toolsEnvVars': { GOFLAGS: '-mod=mod', SHARED: 'tools' }, 'go.testEnvVars': { SHARED: 'tests', FIXTURES: '${workspaceFolder}/testdata', HOME_DATA: '~/data', RETRIES: 3, VERBOSE: false, SKIPPED: null, 'BAD=NAME': 'x' } };
  expect(goTestEnvironment({ PATH: '/usr/bin' }, settings, { workspace, home })).toEqual({ PATH: '/usr/bin', GOFLAGS: '-mod=mod', SHARED: 'tests', FIXTURES: `${workspace}/testdata`, HOME_DATA: path.join(home, 'data'), RETRIES: '3', VERBOSE: 'false' });
  expect(goTestEnvironment({ PATH: '/usr/bin' }, {})).toEqual({ PATH: '/usr/bin' });
  for (const testEnvVars of [null, 'A=1', ['A=1'], 7]) expect(goTestEnvironment({ A: '0' }, { 'go.testEnvVars': testEnvVars })).toEqual({ A: '0' });
});

const entry = (menu: string): GoplsCommand => { const found = goplsCommands.find(command => command.menu === menu); if (!found) throw new Error(`no ${menu} in the table`); return found; };
const sent = (menu: string, context: Partial<GoplsCommandContext> = {}) => entry(menu).arguments?.({ uri, range, ...context });

test('the extension\'s own commands send gopls these arguments', () => {
  // Add Import: the package is chosen from what gopls knows for the same document.
  const add = entry('go.import.add');
  expect(add.command).toBe('gopls.add_import');
  expect(sent('go.import.add')).toBeUndefined();
  expect(add.chooser).toMatchObject({ kind: 'pick', from: 'gopls.list_known_packages' });
  if (add.chooser?.kind !== 'pick') throw new Error('Add Import picks from a list');
  expect(add.chooser.arguments({ uri })).toEqual([{ URI: uri }]);
  expect(add.chooser.items({ Packages: ['fmt', 'net/http', 'example.com/app/store'] })).toEqual(['fmt', 'net/http', 'example.com/app/store']);
  expect(sent('go.import.add', { chosen: 'net/http' })).toEqual([{ ImportPath: 'net/http', URI: uri }]);

  // Generate Unit Tests For Function: the selection.
  expect(entry('go.test.generate.function').command).toBe('gopls.add_test');
  expect(sent('go.test.generate.function')).toEqual([{ URI: uri, range }]);
  expect(sent('go.test.generate.function', { range: undefined })).toBeUndefined();
  expect(sent('go.test.generate.function', { uri: uri.replace(/\.go$/, '.md') })).toBeUndefined();

  // Add Tags: the setting's tags, or what the person typed when the setting names none or says to ask.
  expect(entry('go.add.tags').command).toBe('gopls.modify_tags');
  expect(sent('go.add.tags')).toBeUndefined();
  expect(entry('go.add.tags').chooser?.kind).toBe('text');
  expect(sent('go.add.tags', { chosen: 'json,xml' })).toEqual([{ URI: uri, range, modification: 'add', add: 'json,xml', addOptions: undefined, transform: undefined, valueFormat: undefined }]);
  const addTags = { 'go.addTags': { tags: 'json', options: 'json=omitempty', transform: 'camelcase', template: '{field}' } };
  expect(sent('go.add.tags', { settings: addTags })).toEqual([{ URI: uri, range, modification: 'add', add: 'json', addOptions: 'json=omitempty', transform: 'camelcase', valueFormat: '{field}' }]);
  expect(sent('go.add.tags', { settings: { go: { addTags: { options: 'json=omitempty' } } } })).toMatchObject([{ add: undefined, addOptions: 'json=omitempty' }]);
  expect(sent('go.add.tags', { settings: { 'go.addTags': { ...addTags['go.addTags'], promptForTags: true } } })).toBeUndefined();
  expect(sent('go.add.tags', { settings: { 'go.addTags': { ...addTags['go.addTags'], promptForTags: true } }, chosen: 'yaml' })).toEqual([{ URI: uri, range, modification: 'add', add: 'yaml', addOptions: undefined, transform: undefined, valueFormat: undefined }]);
  expect(sent('go.add.tags', { settings: { 'go.addTags': { tags: '', options: '' } } })).toBeUndefined();
  expect(sent('go.add.tags', { settings: { 'go.addTags': 'json' } })).toBeUndefined();
  expect(sent('go.add.tags', { range: undefined, chosen: 'json' })).toBeUndefined();

  // Remove Tags.
  expect(entry('go.remove.tags').command).toBe('gopls.modify_tags');
  expect(sent('go.remove.tags')).toBeUndefined();
  expect(sent('go.remove.tags', { settings: { 'go.removeTags': { tags: 'xml', options: 'json=omitempty' } } })).toEqual([{ URI: uri, range, modification: 'remove', remove: 'xml', removeOptions: 'json=omitempty' }]);
  expect(sent('go.remove.tags', { chosen: 'json' })).toEqual([{ URI: uri, range, modification: 'remove', remove: 'json', removeOptions: undefined }]);

  // Compiler optimization details: the URI itself is the argument.
  expect(sent('go.toggle.gc_details')).toEqual([uri]);
  expect(sent('go.toggle.gc_details', { uri: uri.replace(/_test\.go$/, '.mod') })).toBeUndefined();

  // Package Outline: a Go file on disk.
  expect(sent('go.package.outline')).toEqual([{ URI: uri }]);
  expect(sent('go.package.outline', { uri: 'untitled:Untitled-1.go' })).toBeUndefined();
  expect(goplsCommandFailure('gopls.package_symbols', new Error('no package'))).toBeUndefined();
  expect(goplsCommandFailure('gopls.tidy', new Error('go.mod is broken'))).toBe("Command 'gopls.tidy' failed: Error: go.mod is broken.");
  expect(goplsCommandFailure('gopls.tidy', 'x'.repeat(9000))).toHaveLength(4096);
});

test('the lens commands of gopls are passed on, saved first where the extension saves', () => {
  const lenses = goplsCommands.filter(command => command.origin === 'lens');
  expect(lenses.map(command => command.command)).toEqual(['gopls.tidy', 'gopls.vendor', 'gopls.upgrade_dependency', 'gopls.generate', 'gopls.regenerate_cgo', 'gopls.run_govulncheck', 'gopls.vulncheck', 'gopls.run_tests']);
  // A lens carries its own arguments.
  for (const lens of lenses) { expect(lens.arguments).toBeUndefined(); expect(lens.chooser).toBeUndefined(); expect(lens.lens).toBeTruthy(); }
  expect(goplsCommands.filter(command => command.saveAll).map(command => command.command)).toEqual(['gopls.tidy', 'gopls.run_govulncheck', 'gopls.vulncheck']);
  expect(goplsCommands.filter(command => command.terminal).map(command => command.command)).toEqual(['gopls.run_tests']);
  for (const command of goplsCommands) { expect(command.title).toBeTruthy(); expect(command.result).toMatch(/\.$/); expect(command.origin === 'extension' ? command.menu : command.lens).toBeTruthy(); }

  expect(goplsCommand('gopls.tidy')).toHaveLength(1);
  expect(goplsCommand('gopls.modify_tags').map(command => command.menu)).toEqual(['go.add.tags', 'go.remove.tags']);
  expect(goplsCommand('gopls.check_upgrades')).toEqual([]);
});

test('what gopls answered is read with care', () => {
  expect(knownPackages({ Packages: ['fmt', 7, '', null, 'net/http', 'x'.repeat(2000)] })).toEqual(['fmt', 'net/http']);
  for (const result of [undefined, null, 'fmt', ['fmt'], {}, { Packages: 'fmt' }, { packages: ['fmt'] }]) expect(knownPackages(result)).toEqual([]);
  expect(knownPackages({ Packages: Array.from({ length: 80_000 }, (_, index) => `example.com/p${index}`) })).toHaveLength(50_000);

  const capabilities = { executeCommandProvider: { commands: ['gopls.add_import', 'gopls.list_known_packages', 7] } };
  expect(goplsHasCommand(capabilities, 'gopls.add_import')).toBe(true);
  expect(goplsHasCommand(capabilities, 'gopls.add_test')).toBe(false);
  for (const stated of [undefined, null, {}, { executeCommandProvider: true }, { executeCommandProvider: { commands: 'gopls.add_import' } }]) expect(goplsHasCommand(stated, 'gopls.add_import')).toBe(false);
});

test('the rules of a running gopls', () => {
  const rules = goplsRules({ name: 'gopls', root: workspace, settings: { gopls: { 'ui.semanticTokens': true }, 'go.buildTags': 'e2e', 'go.inlayHints.parameterNames': false } });
  // Under the short names, so that they land on the options Zed sends. The "run test" lens the
  // extension draws itself is gopls' own here, on unless `go.enableCodeLens.runtest` is off.
  expect(rules.initializationOptions).toEqual({ codelenses: { test: true }, semanticTokens: true, buildFlags: ['-tags', 'e2e'], hints: { parameterNames: false } });
  expect(goplsOwnOptions({ 'go.enableCodeLens': { runtest: false }, gopls: { 'ui.codelenses': { tidy: false } } })).toEqual({ codelenses: { test: false, tidy: false } });
  expect(JSON.parse(readFileSync(path.join(vendor, 'vscode-go/extension/package.json'), 'utf8')).contributes.configuration.properties['go.enableCodeLens'].default).toEqual({ runtest: true });
  expect(rules.capabilities?.({}).experimental).toEqual({ progressMessageStyles: ['log'] });
  expect(Object.keys(rules.notifications ?? {})).toEqual(['$/progress']);
  const progress = rules.notifications?.['$/progress'];
  expect(progress?.({ token: 1, value: { kind: 'begin', title: 'Run govulncheck', message: 'style: log\n\nRunning...' } })).toEqual({ progress: { 'gopls log 1': 'Run govulncheck' }, log: ['Run govulncheck: Running...'] });
  expect(progress?.({ nonsense: true })).toBeUndefined();
  // Each session of gopls has its own log.
  const other = goplsRules({ name: 'gopls', root: workspace, settings: {} });
  expect(other.notifications?.['$/progress']?.({ token: 1, value: { kind: 'report', message: 'x' } })).toBeUndefined();
  expect(other.initializationOptions).toEqual({ codelenses: { test: true } });
});

const vendor = fileURLToPath(new URL('../../../../../vendor', import.meta.url)), upstream = path.join(vendor, 'vscode-go', 'extension');
const squash = (value: string) => value.replace(/\s+/g, ' ');

test.skipIf(!existsSync(path.join(upstream, 'package.json')))('the copied rules are the ones vendor/vscode-go states', () => {
  const source = (name: string) => readFileSync(path.join(upstream, 'src', name), 'utf8');
  type Stated = { default?: unknown; enum?: string[]; markdownDescription?: string; properties?: Record<string, Stated> };
  const manifest = JSON.parse(readFileSync(path.join(upstream, 'package.json'), 'utf8')) as { contributes: {
    commands: { command: string; title: string }[]; views: Record<string, { id: string; name: string }[]>; configuration: { properties: Record<string, Stated> } } };
  const properties = manifest.contributes.configuration.properties;
  const server = source('language/goLanguageServer.ts'), flat = squash(server);

  // What is declared: the token modifiers, the log style, and nothing else but the forms that were left out.
  const tokens = source('language/goSemanticTokens.ts');
  expect([.../const GOPLS_CUSTOM_TOKEN_MODIFIERS = \[([^\]]+)\];/.exec(tokens)?.[1].matchAll(/'(\w+)'/g) ?? []].map(match => match[1])).toEqual(goplsTokenModifiers);
  expect(tokens).toContain('const GOPLS_CUSTOM_TOKEN_TYPES: string[] = [];');
  expect(tokens).toContain('const semanticTokens = capabilities.textDocument?.semanticTokens;\n\t\tif (semanticTokens) {');
  expect(tokens).toContain('semanticTokens.tokenModifiers.push(...GOPLS_CUSTOM_TOKEN_MODIFIERS);');
  expect(server).toContain(`experimental.progressMessageStyles = [${goplsProgressStyles.map(style => `'${style}'`).join(', ')}];`);
  const declared = new Set<string>();
  const walk = (folder: string): void => { for (const item of readdirSync(folder, { withFileTypes: true })) {
    if (item.isDirectory()) walk(path.join(folder, item.name));
    else if (item.name.endsWith('.ts')) for (const match of readFileSync(path.join(folder, item.name), 'utf8').matchAll(/\bexperimental\.(\w+) = /g)) declared.add(match[1]);
  } };
  walk(path.join(upstream, 'src'));
  expect([...declared].sort()).toEqual(['interactiveResolve', 'progressMessageStyles']);
  expect(server).toContain('c.registerFeature(new InteractiveFormsFeature(c));\n\tc.registerFeature(new GoSemanticTokensFeature());\n\tc.registerFeature(new GoDiagnosticsFeature(c, goCtx));');

  // Progress as a log.
  expect(server).toContain("const paragraphs = params.message.split('\\n\\n', 2);");
  expect(server).toContain("const metadata = paragraphs[0].trim();\n\t\t\t\t\t\t\t\tif (!metadata.startsWith('style: ')) {");
  expect(server).toContain("const style = metadata.substring('style: '.length);\n\t\t\t\t\t\t\t\tif (style === 'log') {\n\t\t\t\t\t\t\t\t\tconst term = ProgressTerminal.Open(params.title, token);");
  expect(server).toContain('if (paragraphs.length > 1) {\n\t\t\t\t\t\t\t\t\t\tterm.appendLine(paragraphs[1]);');
  expect(server.match(/ActiveProgressTerminals\.get\(token\)\?\.appendLine\(params\.message\);/g)).toHaveLength(2);
  expect(server).toContain('pendingVulncheckProgressToken.set(progressToken, args[0]);');
  expect(server).toContain('govulncheckTerminal?.appendLine(params.message);');
  expect(server).toContain("if (e.message === 'completed') {");
  expect(server).toContain('govulncheckTerminal.appendLine(`terminated without result: ${e.message}`);');
  expect(server).toContain(`'${govulncheckBusy}'`);

  // Settings: where they are sent, in which order they are made, and each rule.
  expect(server).toContain("const goplsWorkspaceConfig = await adjustGoplsWorkspaceConfiguration(cfg, getGoplsConfig(), 'gopls', undefined);");
  expect(server).toContain('initializationOptions: goplsWorkspaceConfig,');
  expect(server).toContain("if (section !== 'gopls') {\n\t\treturn workspaceConfig;");
  const adjust = server.slice(server.indexOf('async function adjustGoplsWorkspaceConfiguration('), server.indexOf('async function passInlayHintConfigToGopls('));
  expect([...adjust.matchAll(/workspaceConfig = (?:await )?(\w+)\(/g)].map(match => match[1])).toEqual(
    ['filterGoplsDefaultConfigValues', 'passGoConfigToGoplsConfigValues', 'passInlayHintConfigToGopls', 'passVulncheckConfigToGopls', 'passLinkifyShowMessageToGopls']);
  expect(server).toContain("if (goWorkspaceConfig?.buildTags && buildFlags.indexOf('-tags') === -1) {\n\t\tbuildFlags.push('-tags', goWorkspaceConfig?.buildTags);");
  expect(server).toContain("if (buildFlags.length > 0 && goplsWorkspaceConfig['build.buildFlags'] === undefined) {\n\t\tgoplsWorkspaceConfig['build.buildFlags'] = buildFlags;");
  expect(server).toContain(`if ((version?.compare('${goplsOptionSince.hints}') ?? 1) > 0) {\n\t\tconst { inlayHints } = goConfig;\n\t\tif (inlayHints) {\n\t\t\tgoplsConfig['ui.inlayhint.hints'] = { ...inlayHints };`);
  expect(server).toContain(`if ((version?.compare('${goplsOptionSince.vulncheck}') ?? 1) > 0) {\n\t\tconst vulncheck = goConfig.get('diagnostic.vulncheck');\n\t\tif (vulncheck) {\n\t\t\tgoplsConfig['ui.vulncheck'] = vulncheck;`);
  // The two that were left out are still the only others.
  expect(server).toContain("goplsConfig['linkifyShowMessage'] = true;");
  expect(server).toContain("workspaceConfig['allExperiments'] = true;");
  expect([...new Set([...server.matchAll(/(?:goplsConfig|goplsWorkspaceConfig|workspaceConfig)\['([\w.]+)'\] = /g)].map(match => match[1]))].sort()).toEqual(['allExperiments', 'build.buildFlags', 'linkifyShowMessage', 'ui.inlayhint.hints', 'ui.vulncheck']);
  expect(server).toContain(`const { stdout } = await execFile(cfg.path, [${goplsVersionArguments.map(argument => `'${argument}'`).join(', ')}], { env, cwd });`);
  expect(server).toContain('if (v?.Main.Version) {');
  expect(Object.keys(properties).filter(name => name.startsWith('go.inlayHints.')).map(name => name.slice('go.inlayHints.'.length))).toEqual(goInlayHints);
  for (const hint of goInlayHints) expect(properties[`go.inlayHints.${hint}`].default).toBe(false);
  expect(properties['go.diagnostic.vulncheck']).toMatchObject({ enum: goVulncheckModes, default: 'Prompt' });
  expect(properties['go.buildFlags'].default).toEqual([]);
  expect(properties['go.buildTags'].default).toBe('');
  expect(Object.keys(properties.gopls.properties ?? {})).toContain('build.buildFlags');

  // Code lenses: what the extension replaces, and that VS Code leaves gopls' test lens off.
  expect(server).toContain("case 'run test': {\n\t\t\t\t\t\t\t\treturn [...lenses, ...createTestCodeLens(lens)];");
  expect(server).toContain("case 'run benchmark': {\n\t\t\t\t\t\t\t\treturn [...lenses, ...createBenchmarkCodeLens(lens)];");
  expect(server).toContain("command: 'go.test.cursor',\n\t\t\targuments: [{ functionName: lens.command?.arguments?.[1][0] }]");
  expect(server).toContain("command: 'go.benchmark.cursor',\n\t\t\targuments: [{ functionName: lens.command?.arguments?.[2][0] }]");
  expect(server).toContain("title: 'debug test',\n\t\t\tcommand: 'go.debug.cursor',");
  const lensSwitches = properties.gopls.properties?.['ui.codelenses'].properties ?? {};
  for (const command of goplsCommands.filter(command => command.origin === 'lens')) {
    const stated = lensSwitches[command.lens ?? ''];
    // The first line of what the extension says about the lens ends with the title used here.
    expect(squash((stated.markdownDescription ?? '').split('\n')[0].replaceAll('`', ''))).toMatch(new RegExp(`^(\\(Experimental\\) )?"${command.lens}": ${command.title.replace(/[()]/g, '\\$&')}$`));
  }
  expect(Object.keys(lensSwitches).sort()).toEqual(goplsCommands.filter(command => command.origin === 'lens').map(command => command.lens).sort());
  expect(Object.entries(lensSwitches).filter(([, value]) => value.default === false).map(([name]) => name).sort()).toEqual(['test', 'vulncheck']);

  // The commands of the extension: the title of each, and the arguments it sends.
  for (const command of goplsCommands.filter(command => command.origin === 'extension')) {
    const title = manifest.contributes.commands.find(stated => stated.command === command.menu)?.title ?? manifest.contributes.views.explorer.find(view => view.id === command.menu)?.name;
    expect(title).toBe(command.title);
  }
  const imports = source('goImport.ts'), flatImports = squash(imports);
  expect(imports).toContain("const COMMAND = 'gopls.list_known_packages';");
  expect(imports).toContain("const COMMAND = 'gopls.add_import';");
  expect(imports.match(/languageClient && serverInfo\?\.Commands\?\.includes\(COMMAND\)/g)).toHaveLength(2);
  expect(flatImports).toContain('arguments: [ { URI: uri } ]');
  expect(flatImports).toContain('arguments: [ { ImportPath: imp, URI: uri } ]');
  expect(imports).toContain('return resp.Packages;');
  expect(imports).toContain('return vscode.window.showQuickPick(packages);');
  const generate = source('goGenerateTests.ts');
  expect(generate).toContain("export const GOPLS_ADD_TEST_COMMAND = 'gopls.add_test';");
  expect(squash(generate)).toContain('await vscode.commands.executeCommand(GOPLS_ADD_TEST_COMMAND, { URI: editor.document.uri.toString(), range: editor.selection });');
  expect(generate).toContain('if (!goCtx.serverInfo?.Commands?.includes(GOPLS_ADD_TEST_COMMAND)) {');
  const tags = source('goModifytags.ts');
  expect(tags).toContain("export const GOPLS_MODIFY_TAGS_COMMAND = 'gopls.modify_tags';");
  expect(squash(tags)).toContain('const args: GoModifyTagsArgs = { URI: editor.document.uri.toString(), range: editor.selection };');
  expect([...tags.matchAll(/^\t+args\.(\w+) = ([^;]+);$/gm)].map(match => match.slice(1))).toEqual([
    ['modification', "'add'"], ['add', 'config?.tags'], ['addOptions', 'config?.options'], ['transform', 'config?.transform'], ['valueFormat', 'config?.template'],
    ['modification', "'remove'"], ['remove', 'config?.tags'], ['removeOptions', 'config?.options']]);
  expect(tags.match(/if \(!config\?\.promptForTags\) \{/g)).toHaveLength(2);
  expect(tags).toContain("const config = getGoConfig().get<GoTagsConfig>('addTags');");
  expect(tags).toContain("const config = getGoConfig().get<GoTagsConfig>('removeTags');");
  expect(tags).toContain('await vscode.commands.executeCommand(GOPLS_MODIFY_TAGS_COMMAND, args);');
  const details = source('commands/toggleGCDetails.ts');
  expect(details).toContain('const doc = vscode.window.activeTextEditor?.document.uri.toString();');
  expect(details).toContain("if (!doc || !doc.endsWith('.go')) {");
  expect(details).toContain("await vscode.commands.executeCommand('gopls.gc_details', doc);");
  const outline = source('goPackageOutline.ts');
  expect(squash(outline)).toContain("await vscode.commands.executeCommand('gopls.package_symbols', { URI: e.uri.toString() })");
  expect(outline).toContain("if (e?.languageId !== 'go' || e?.uri?.scheme !== 'file') {");
  expect(outline).toContain('interface PackageSymbolsCommandResult {\n\tPackageName: string;\n\tFiles: string[];\n\tSymbols: PackageSymbolData[];\n}');
  expect(server).toContain('Commands: res.capabilities?.executeCommandProvider?.commands || [],');

  // What is saved first, the answer that names a progress, and what a failure says.
  expect(flat).toContain("if (command === 'gopls.tidy' || command === 'gopls.vulncheck') { await vscode.workspace.saveAll(false); }");
  expect(flat).toContain("if (command === 'gopls.run_govulncheck' && args.length && args[0].URI) {");
  expect(server.match(/await vscode\.workspace\.saveAll\(false\);/g)).toHaveLength(2);
  expect(server).toContain('const progressToken = res?.Token as ProgressToken;');
  expect(server).toContain("`Command '${command}' failed: ${e}.`,");
  expect(flat).toContain("if (command === 'gopls.package_symbols') { return null; }");
  const vulncheck = source('goVulncheck.ts');
  expect(vulncheck).toContain("const goCfgName = 'diagnostic.vulncheck';");
  expect(vulncheck).toContain("const newValue = workspaceFolderValue === 'Imports' ? 'Off' : 'Imports';");
  expect(vulncheck).toContain("cfg.update(goCfgName, 'Imports');");
  expect(manifest.contributes.commands.find(stated => stated.command === 'go.vulncheck.toggle')?.title).toBe(vulncheckToggle({}).title);

  // go test: the command line of the extension's own "run test".
  const tests = source('testUtils.ts');
  expect(tests).toContain("const args: Array<string> = ['test', '-test.fullpath=true'];");
  expect(tests).toContain("if (testconfig.isBenchmark) {\n\t\targs.push('-benchmem', '-run=^$');\n\t} else {\n\t\targs.push('-timeout', testconfig.goConfig['testTimeout']);");
  expect(tests).toContain("if (testTags && userFlags.indexOf('-tags') === -1) {\n\t\targs.push('-tags', testTags);");
  expect(tests).toContain("params = ['-bench', util.format('^%s$', testconfig.functions[0])];");
  expect(tests).toContain("params = ['-bench', util.format('^(%s)$', testconfig.functions.join('|'))];");
  expect(tests).toContain("params = params.concat(['-run', util.format('^%s$', testFunctions[0])]);");
  expect(tests).toContain("params = params.concat(['-run', util.format('^(%s)$', testFunctions.join('|'))]);");
  expect(tests).toContain("let testFlags: string[] = goConfig['testFlags'] || goConfig['buildFlags'] || [];\n\ttestFlags = testFlags.map((x) => resolvePath(x));");
  expect(tests).toContain("return goConfig['testTags'] !== null ? goConfig['testTags'] : goConfig['buildTags'];");
  expect(tests).toContain("const argsFlagIdx = testconfig.flags?.indexOf('-args') ?? -1;");
  expect(tests).toContain("if (args.indexOf('-run') > -1) {\n\t\tremoveRunFlag(userFlags);");
  expect(tests).toContain("const index: number = flags.indexOf('-run');\n\tif (index !== -1) {\n\t\tflags.splice(index, 2);");
  expect(tests).toContain('args.push(...userFlags);');
  expect(tests).toContain("const testEnvConfig = config['testEnvVars'] || {};");
  expect(tests).toContain("typeof testEnvConfig[key] === 'string' ? resolvePath(testEnvConfig[key]) : testEnvConfig[key])");
  const cursor = source('goTest.ts');
  expect(cursor).toContain('dir: path.dirname(editor.document.fileName),');
  expect(cursor).toContain('await editor.document.save();');
  expect([properties['go.testTimeout'].default, properties['go.testTags'].default, properties['go.testFlags'].default, properties['go.testEnvVars'].default]).toEqual([goTestTimeoutDefault, null, null, {}]);
});

test.skipIf(!existsSync(path.join(vendor, 'zed', 'crates', 'languages', 'src', 'go.rs')))('what Zed tells gopls is what vendor/zed states', () => {
  const adapter = readFileSync(path.join(vendor, 'zed', 'crates', 'languages', 'src', 'go.rs'), 'utf8');
  // The options at startup, and that a person's options are merged into them.
  const stated = /let mut default_config = json!\((\{[\s\S]*?\n {8}\})\);/.exec(adapter)?.[1] ?? '';
  expect(JSON.parse(stated.replace('semantic_tokens_enabled', 'true'))).toEqual(zedGoplsDefaults(true));
  expect(zedGoplsDefaults(false).semanticTokens).toBe(false);
  expect(adapter).toContain('merge_json_value_into(override_options, &mut default_config);');
  expect(squash(adapter)).toContain('.and_then(|settings| settings.settings.clone())');
  // An item of workspace/configuration that names a section is answered with that member of `lsp.gopls.settings`.
  expect(squash(readFileSync(path.join(vendor, 'zed', 'crates', 'project', 'src', 'lsp_store.rs'), 'utf8'))).toContain('if let Some(section) = &item.section { Some( workspace_config .get(section) .cloned() .unwrap_or(serde_json::Value::Null), )');

  // gopls.run_tests: one argument with URI, Tests and Benchmarks, and the command made of it.
  expect(adapter).toContain(`if let "${goplsRunTests}" = command_name {\n            let template = go_test_task_template(arguments.first()?, path_style)?;`);
  expect(adapter).toContain('let tests = json_string_array(arg, "Tests");\n    let benchmarks = json_string_array(arg, "Benchmarks");');
  expect(adapter).toContain('.get("URI")');
  expect(adapter).toContain('let mut go_args = vec!["test".to_string(), "-test.fullpath=true".to_string()];');
  expect(adapter).toContain(`go_args.push("${goTestTimeoutDefault}".to_string());`);
  expect(adapter).toContain('go_args.push(".".to_string());');
  expect(adapter).toContain('format!("go test {}", tests.join(", "))');
  expect(adapter).toContain('format!("go bench {}", benchmarks.join(", "))');
  // What Zed makes of a lens is what is made here when no setting is written.
  const lens = [{ URI: uri, Tests: ['TestSave', 'TestLoad'], Benchmarks: ['BenchmarkSave'] }];
  expect(goTestCommand(goplsRunTests, lens)).toMatchObject({ program: 'go', cwd: path.dirname(file), label: 'go test TestSave, TestLoad',
    args: ['test', '-test.fullpath=true', '-timeout', '30s', '-run', '^(TestSave|TestLoad)$', '-bench', '^BenchmarkSave$', '.'] });
});
