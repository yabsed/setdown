import { expect, test } from 'vitest';
import type { AnalysisContext } from '../../core/document/analysis-context';
import type { ProviderSupport } from './document-support';
import { analysisResult, environmentAction, plainReason, presentIssue, presentSupport, problemsEmpty, shortPath } from './document-presentation';
const context: AnalysisContext = { id: 'env', root: '/project', rootReason: 'marker', environment: 'usable', choices: [], evidence: [], issues: [] };
/** A tool that carries what the main process established about the project it runs in. */
const within = (project: Partial<AnalysisContext>, patch: Partial<ProviderSupport> = {}): ProviderSupport => server({ ...patch, analysis: { context: { ...context, ...project }, analysis: 'observed', scope: 'open-files', freshness: 'current', progress: [] } });
const server = (patch: Partial<ProviderSupport> = {}): ProviderSupport => ({ id: 'primary', name: 'Primary', kind: 'server', state: 'ready', features: [], checks: 'Server diagnostics',
  analysis: { context, analysis: 'waiting', scope: 'open-files', freshness: 'none', progress: [] }, ...patch });
test('a connected server is quiet without claiming that checks completed', () => {
  const connected = server();
  expect(presentSupport([connected])).toEqual({ label: '', tone: 'neutral', working: true });
  expect(analysisResult(connected)).toBe('Waiting for analysis results');
  expect(analysisResult(server({ analysis: { ...connected.analysis!, analysis: 'observed', freshness: 'best-effort' } }))).toBe('Results received for this open file');
  expect(analysisResult(server({ analysis: { ...connected.analysis!, analysis: 'working', freshness: 'stale' } }))).toBe('Waiting for results after the latest change');
  expect(presentSupport([server({ analysis: { ...connected.analysis!, analysis: 'working', freshness: 'stale' } })]).label).toBe('');
});
test('known environment repair precedes restart; supplementary failure retains the primary service', () => {
  const failed = server({ id: 'linter', name: 'Linter', role: 'supplementary', state: 'failed' });
  // The language still works, so the tool is named and the status says limited, not broken.
  expect(presentSupport([server(), failed], undefined, 'Python')).toMatchObject({ label: 'Limited', title: "Linter can't start.", description: 'Primary still works.', action: { kind: 'restart', server: 'linter' } });
  // A choice that names a missing Python is a fact the tool's own context carries.
  const missingPython = { kind: 'python' as const, environment: 'action-needed' as const, issues: [{ code: 'python-missing', message: 'Missing Python' }] };
  expect(presentSupport([within(missingPython, { ...failed })])).toMatchObject({ title: 'Missing Python', action: { kind: 'environment', label: 'Choose Python environment…' } });
  // A tool that stopped may have stopped because of its environment, so the environment still comes first.
  expect(presentSupport([within(missingPython, { state: 'failed', recovery: { retrying: false }, issue: { kind: 'crashed' } })])).toMatchObject({ title: 'Missing Python', action: { kind: 'environment' } });
  // A tool that cannot start at all comes before it: no environment choice can start the wrong program.
  expect(presentSupport([within(missingPython, { state: 'failed', recovery: { retrying: false }, issue: { kind: 'executable', path: '/usr/bin/java', automatic: true } })], undefined, 'Python'))
    .toMatchObject({ label: 'Not working', title: "Python support can't start.", action: { kind: 'automatic' } });
  expect(presentSupport([within(missingPython, { state: 'failed', recovery: { retrying: false }, issue: { kind: 'runtime', runtime: 'Java', required: '21' } })], undefined, 'Java'))
    .toMatchObject({ title: 'Java support needs Java 21 or newer.', action: { kind: 'help' } });
});
test('intentional project-off suppresses irrelevant environment repair but preserves local checks', () => {
  const off = { ...context, analysisSelection: { mode: 'off' as const, source: 'project' as const }, environment: 'action-needed' as const, servers: [{ id: 'primary', name: 'Primary', enabled: false, selected: false, role: 'primary' as const }] };
  expect(presentSupport([], off)).toMatchObject({ tone: 'neutral', description: 'Analysis is turned off for this project.' });
  expect(presentSupport([server({ kind: 'builtin', checks: 'syntax', analysis: undefined })], off)).toMatchObject({ tone: 'neutral', description: 'Analysis is turned off for this project. Local checks remain available.' });
});
test('recovery, stopped recovery and partial/local failure remain actionable and distinct', () => {
  expect(presentSupport([server({ state: 'failed', recovery: { retrying: true, attempt: 2 } })])).toMatchObject({ label: 'Reconnecting…', tone: 'busy', description: 'Attempt 2 of 3.' });
  expect(presentSupport([server({ state: 'failed', recovery: { retrying: false } })]).action?.kind).toBe('restart');
  expect(presentSupport([server({ kind: 'builtin', state: 'failed', message: 'Unable to load schema' })])).toMatchObject({ tone: 'warning', title: 'Unable to load schema', action: { kind: 'details' } });
  expect(presentSupport([within({ environment: 'partial' })]).label).toBe('Limited');
});
test('Problems distinguishes unknown coverage, pending results and observed results without claiming full coverage', () => {
  expect(problemsEmpty([])).toContain('Check code support');
  expect(problemsEmpty([server()])).toContain('still pending');
  expect(problemsEmpty([server({ checks: 'none' })])).toContain('still pending');
  expect(problemsEmpty([server({ analysis: { context, analysis: 'observed', scope: 'open-files', freshness: 'best-effort', progress: [] } })])).toContain('does not establish project-wide coverage');
});

test('default-disabled companions are normal editing support, not an explicit project-off choice', () => {
  const grammar = { ...context, servers: [{ id: 'companion', name: 'Companion', enabled: false, selected: false, role: 'supplementary' as const }], analysisSelection: { mode: 'automatic' as const, source: 'default' as const } };
  expect(presentSupport([], grammar)).toMatchObject({ tone: 'neutral', label: '' });
  expect(presentSupport([], grammar).description).toContain('does not include project analysis');
  expect(presentSupport([], { ...grammar, analysisSelection: { mode: 'off', source: 'global' } }).description).toBe('Analysis is turned off by the app default.');
});

test('each cause has one sentence and the one action that addresses it', () => {
  const stopped = (issue: ProviderSupport['issue']) => presentSupport([server({ id: 'java', name: 'java', state: 'failed', recovery: { retrying: false }, issue })], undefined, 'Java');
  // The Java case: Restart would run the same program again; the repair is to stop using it.
  expect(stopped({ kind: 'executable', path: '/usr/lib/jvm/java-17-temurin-jdk/bin/java', automatic: true })).toEqual({ label: 'Not working', tone: 'warning',
    title: "Java support can't start.", description: 'It is set to run …/java-17-temurin-jdk/bin/java, which did not start as a language tool.',
    action: { kind: 'automatic', label: 'Use automatic setup', server: 'java' }, secondary: { kind: 'log', label: 'Show log', server: 'java' } });
  expect(stopped({ kind: 'executable', path: '/opt/tools/missing', missing: true })).toMatchObject({ description: 'It is set to run …/opt/tools/missing, which no longer exists.'.replace('…/opt/tools/missing', '/opt/tools/missing'), action: { kind: 'locate', label: 'Choose program…' } });
  expect(stopped({ kind: 'runtime', runtime: 'Java', required: '21', found: '17' })).toMatchObject({ title: 'Java support needs Java 21 or newer.', description: 'Found Java 17.',
    action: { kind: 'help', label: 'How to install ↗', runtime: 'Java' }, secondary: { kind: 'log' } });
  expect(stopped({ kind: 'runtime', runtime: 'Node.js', required: '' })).toMatchObject({ title: 'Java support needs Node.js.', description: 'Node.js was not found.' });
  expect(stopped({ kind: 'startup', detail: 'error: unknown option --stdio' })).toMatchObject({ title: "Java support can't start.", description: 'error: unknown option --stdio',
    action: { kind: 'log', label: 'Show log' }, secondary: { kind: 'restart', label: 'Try again' } });
  // Restart is offered only for a tool that had been working.
  expect(stopped({ kind: 'crashed' })).toMatchObject({ title: 'Java support stopped unexpectedly.', action: { kind: 'restart', label: 'Restart' }, secondary: { kind: 'log' } });
  expect(stopped({ kind: 'download-failed', detail: 'error sending request: network is unreachable' })).toMatchObject({ title: "Couldn't download Java support.", action: { kind: 'restart', label: 'Try again' } });
  expect(stopped({ kind: 'download-failed', detail: 'extension returned an invalid command' }).title).toBe("Couldn't set up Java support.");
  // An address inside a piece of advice is not a download that failed.
  expect(stopped({ kind: 'download-failed', detail: 'The build of the tool ended early. See https://example.org/tool for what it needs.' }).title).toBe("Couldn't set up Java support.");
  expect(stopped({ kind: 'download-failed', detail: 'HTTP 404 for https://example.org/tool.tar.gz' }).title).toBe("Couldn't download Java support.");
  expect(stopped({ kind: 'no-installer' })).toMatchObject({ label: 'Needs setup', title: "Java support isn't installed.", action: { kind: 'locate', label: 'I already have it…' } });
  expect(shortPath('/usr/bin/clangd')).toBe('/usr/bin/clangd');
});

test('a missing tool asks for setup only when the person turned downloads off', () => {
  const missing = (issue: ProviderSupport['issue']) => presentSupport([server({ id: 'nil', name: 'nil', state: 'missing', analysis: undefined, issue })], undefined, 'Nix');
  expect(missing({ kind: 'downloads-off' })).toMatchObject({ label: 'Needs setup', tone: 'warning', title: "Nix support isn't installed.", description: 'Downloads are off.', action: { kind: 'install', label: 'Install Nix support', server: 'nil' } });
  // A file whose tool Setdown cannot install opens quietly; the sentence waits in the status.
  expect(missing({ kind: 'no-installer', help: true })).toMatchObject({ label: '', tone: 'neutral', title: "Nix support isn't installed.", description: "Setdown can't install it by itself.",
    action: { kind: 'help', label: 'How to install ↗' }, secondary: { kind: 'locate', label: 'I already have it…' } });
  // What the tool's extension said to install takes the place of the general sentence.
  expect(missing({ kind: 'no-installer', help: true, detail: 'nil must be installed manually.' })).toMatchObject({ title: "Nix support isn't installed.", description: 'nil must be installed manually.',
    action: { kind: 'help', label: 'How to install ↗' }, secondary: { kind: 'locate', label: 'I already have it…' } });
  expect(presentIssue(undefined, 'Nix support', 'nil', true)).toMatchObject({ title: "Nix support can't start.", action: { kind: 'restart', label: 'Try again' } });
});

test('Setdown says once that it is fetching a tool and stays quiet for an ordinary start', () => {
  expect(presentSupport([server({ state: 'starting', preparing: true, message: 'Downloading jdtls', analysis: undefined })], undefined, 'Java'))
    .toEqual({ label: 'Setting up…', tone: 'busy', title: 'Setting up Java support…', description: 'Downloading jdtls' });
  expect(presentSupport([server({ state: 'starting', analysis: undefined })], undefined, 'Java')).toEqual({ label: '', tone: 'busy', description: 'Starting…' });
  expect(presentSupport([server({ messages: [{ id: 'm', message: 'Import the Gradle project?', actions: ['Yes'] }] })])).toMatchObject({ label: 'Needs answer', action: { kind: 'details', label: 'Answer…' } });
});

test('a warning the tool sends is announced, and a question comes before it', () => {
  const warning = { id: 'w', message: 'Your licence key has expired.', actions: [], severity: 'warning' as const };
  expect(presentSupport([server({ name: 'intelephense', messages: [warning] })])).toMatchObject({ label: 'Notice', tone: 'warning', title: 'intelephense has a message.', action: { kind: 'details', label: 'Read…' } });
  expect(presentSupport([server({ messages: [warning, { id: 'q', message: 'Reload?', actions: ['Reload'] }] })])).toMatchObject({ label: 'Needs answer' });
  // What a tool merely mentions is read in the panel and changes nothing on the status button.
  const quiet = presentSupport([server({ messages: [{ id: 'i', message: 'Indexing finished.', actions: [], severity: 'info' as const }] })]);
  expect(quiet.label).not.toBe('Notice'); expect(quiet).toEqual(presentSupport([server({})]));
});

test('a tool outside the supported languages waits to be asked for, without a warning', () => {
  const waiting = server({ id: 'zls', name: 'zls', state: 'missing', analysis: undefined, issue: { kind: 'downloads-off', optional: true } });
  expect(presentSupport([waiting], undefined, 'Zig')).toMatchObject({ label: 'Not installed', tone: 'neutral', title: "Zig support isn't installed.",
    description: 'Setdown asks before it downloads a tool for this language.', action: { kind: 'install', label: 'Install Zig support', server: 'zls' } });
  // The app switch being off is a setting the person made; that stays a setup notice.
  expect(presentSupport([{ ...waiting, issue: { kind: 'downloads-off' } }], undefined, 'Zig')).toMatchObject({ label: 'Needs setup', tone: 'warning', description: 'Downloads are off.' });
  // An offer never hides a warning about the file itself.
  expect(presentSupport([waiting, server({ id: 'builtin', kind: 'builtin', state: 'failed', message: 'Unable to load schema' })], undefined, 'Zig'))
    .toMatchObject({ label: 'Limited', tone: 'warning', title: 'Unable to load schema' });
});

test('what Setdown infers about a project is never a status; what the tool reports is', () => {
  // The case of a C++ file whose project has no compilation database: clangd answers, and nothing
  // it reported says anything is wrong. The inference waits; the status is the language's name alone.
  const inferred = { kind: 'compilation' as const, label: 'Build configuration', unselected: 'None · clangd defaults',
    hints: [{ code: 'compilation-unknown', message: 'No build configuration was found in this project, so clangd is using its default flags.' }] };
  expect(presentSupport([within(inferred, { tool: 'clangd' })], undefined, 'C++')).toEqual({ label: '', tone: 'neutral', working: true });
  // clangd itself says an include was not found. Now the status says what was seen, the
  // inference explains it, and the one action opens the choice that addresses it.
  expect(presentSupport([within(inferred, { tool: 'clangd', unresolved: { count: 1, noun: 'include' } })], undefined, 'C++')).toEqual({ label: 'Limited', tone: 'warning',
    title: '1 include was not found, so results here are incomplete.', description: 'No build configuration was found in this project, so clangd is using its default flags.',
    action: { kind: 'environment', label: 'Choose build configuration…' }, secondary: { kind: 'problems', label: 'Show problems' } });
  expect(presentSupport([within({ kind: 'python' }, { tool: 'pyright', unresolved: { count: 3, noun: 'import' } })], undefined, 'Python')).toMatchObject({ label: 'Limited',
    title: '3 imports were not found, so results here are incomplete.', description: undefined, action: { kind: 'environment', label: 'Choose Python environment…' } });
  // A tool with no choice to make still says what it saw, and shows where.
  expect(presentSupport([within({}, { tool: 'typescript', unresolved: { count: 2, noun: 'import' } })])).toMatchObject({ label: 'Limited', action: { kind: 'problems', label: 'Show problems' } });
  expect(presentSupport([within({}, { tool: 'typescript', unresolved: { count: 2, noun: 'import' } })]).secondary).toBeUndefined();
  // A tool that is not answering is the status; its last diagnostics are not.
  expect(presentSupport([within(inferred, { state: 'failed', recovery: { retrying: false }, unresolved: { count: 1, noun: 'include' } })], undefined, 'C++').label).toBe('Not working');
  expect(environmentAction('typescript').label).toBe('Choose TypeScript…');
});

test('the name in the location bar and the panel behind it say the same thing', () => {
  // The panel also knows what a person chose for the project. That never changes a fact a tool
  // reported: the same providers give the same label, sentence and action with and without it.
  const policy = { ...context, environment: 'action-needed' as const, issues: [{ code: 'compilation-missing', message: 'A sentence only the panel was given' }],
    analysisSelection: { mode: 'automatic' as const, source: 'default' as const }, servers: [{ id: 'primary', name: 'Primary', enabled: true, selected: true, role: 'primary' as const }] };
  const cases: ProviderSupport[][] = [
    [server()], [within({ environment: 'action-needed', kind: 'compilation', issues: [{ code: 'compilation-missing', message: 'The chosen build folder is missing.' }] })],
    [within({ kind: 'compilation' }, { unresolved: { count: 2, noun: 'include' }, tool: 'clangd' })], [server({ state: 'failed', recovery: { retrying: false }, message: 'Error: boom' })],
    [server({ state: 'starting' })], [server({ state: 'missing', issue: { kind: 'downloads-off' } })], [within({ environment: 'partial' })]];
  for (const providers of cases) expect(presentSupport(providers, policy, 'C++')).toEqual(presentSupport(providers, undefined, 'C++'));
});

test('a tool that failed without a known cause is explained in its own words', () => {
  const wrapped = "Error: Error invoking remote method 'language:open': Error: spawn /usr/bin/clangd EACCES";
  expect(plainReason(wrapped)).toBe('spawn /usr/bin/clangd EACCES');
  expect(plainReason('TypeError: x is not a function\n    at stack')).toBe('x is not a function');
  expect([plainReason(undefined), plainReason('  \n ')]).toEqual([undefined, undefined]);
  expect(presentSupport([server({ state: 'failed', message: wrapped })], undefined, 'C++')).toMatchObject({ label: 'Not working', title: "C++ support can't start.", description: 'spawn /usr/bin/clangd EACCES', action: { kind: 'restart', label: 'Try again' } });
  // A known cause has its own sentence; the raw message is not repeated beside it.
  expect(presentSupport([server({ state: 'failed', recovery: { retrying: false }, issue: { kind: 'crashed' }, message: wrapped })], undefined, 'C++').description).toBeUndefined();
});

test("a Deno project under TypeScript's own server is Limited, and its one action takes Deno's tool", () => {
  const message = "This is a Deno project (deno.json). TypeScript's own server reports Deno's globals and imports as errors; Deno's tool understands them.";
  expect(presentSupport([within({ environment: 'partial', issues: [{ code: 'deno-project', message }] })]))
    .toMatchObject({ label: 'Limited', tone: 'warning', title: message, action: { kind: 'provider', label: "Use Deno's tool", server: 'deno' } });
  // Any other limitation is still looked at in the environment.
  expect(presentSupport([within({ environment: 'partial', issues: [{ code: 'other', message: 'Something is missing.' }] })]).action).toEqual({ kind: 'details', label: 'Review environment…' });
});
test('a tool that says its own version no longer runs is shown in its words, with the one step that can change the answer', () => {
  const expired = server({ state: 'failed', recovery: { retrying: false }, issue: { kind: 'outdated', detail: 'This build of kotlin-server has expired.' } });
  expect(presentSupport([expired], undefined, 'Kotlin')).toMatchObject({ label: 'Not working', tone: 'warning',
    title: "Kotlin support can't run in the version on this computer.", description: 'This build of kotlin-server has expired.',
    action: { kind: 'restart', label: 'Look for a newer version' }, secondary: { kind: 'log' } });
});
