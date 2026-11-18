import { expect, test } from 'vitest';
import type { AnalysisContext } from '../../core/document/analysis-context';
import type { ProviderSupport } from './document-support';
import { analysisResult, presentIssue, presentSupport, problemsEmpty, shortPath } from './document-presentation';
const context: AnalysisContext = { id: 'env', root: '/project', rootReason: 'marker', environment: 'usable', choices: [], evidence: [], issues: [] };
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
  const missingPython = { ...context, environment: 'action-needed' as const, issues: [{ code: 'python-missing', message: 'Missing Python' }] };
  expect(presentSupport([failed], missingPython)).toMatchObject({ title: 'Missing Python', action: { kind: 'environment' } });
  // A tool that stopped may have stopped because of its environment, so the environment still comes first.
  expect(presentSupport([server({ state: 'failed', recovery: { retrying: false }, issue: { kind: 'crashed' } })], missingPython)).toMatchObject({ title: 'Missing Python', action: { kind: 'environment' } });
  // A tool that cannot start at all comes before it: no environment choice can start the wrong program.
  expect(presentSupport([server({ state: 'failed', recovery: { retrying: false }, issue: { kind: 'executable', path: '/usr/bin/java', automatic: true } })], missingPython, 'Python'))
    .toMatchObject({ label: 'Not working', title: "Python support can't start.", action: { kind: 'automatic' } });
  expect(presentSupport([server({ state: 'failed', recovery: { retrying: false }, issue: { kind: 'runtime', runtime: 'Java', required: '21' } })], missingPython, 'Java'))
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
  expect(presentSupport([server()], { ...context, environment: 'partial' }).label).toBe('Limited');
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
  expect(stopped({ kind: 'no-installer' })).toMatchObject({ label: 'Needs setup', title: "Java support isn't installed.", action: { kind: 'locate', label: 'I already have it…' } });
  expect(shortPath('/usr/bin/clangd')).toBe('/usr/bin/clangd');
});

test('a missing tool asks for setup only when the person turned downloads off', () => {
  const missing = (issue: ProviderSupport['issue']) => presentSupport([server({ id: 'nil', name: 'nil', state: 'missing', analysis: undefined, issue })], undefined, 'Nix');
  expect(missing({ kind: 'downloads-off' })).toMatchObject({ label: 'Needs setup', tone: 'warning', title: "Nix support isn't installed.", description: 'Downloads are off.', action: { kind: 'install', label: 'Install Nix support', server: 'nil' } });
  // A file whose tool Setdown cannot install opens quietly; the sentence waits in the status.
  expect(missing({ kind: 'no-installer', help: true })).toMatchObject({ label: '', tone: 'neutral', title: "Nix support isn't installed.", description: "Setdown can't install it by itself.",
    action: { kind: 'help', label: 'How to install ↗' }, secondary: { kind: 'locate', label: 'I already have it…' } });
  expect(presentIssue(undefined, 'Nix support', 'nil', true)).toMatchObject({ title: "Nix support can't start.", action: { kind: 'restart', label: 'Try again' } });
});

test('Setdown says once that it is fetching a tool and stays quiet for an ordinary start', () => {
  expect(presentSupport([server({ state: 'starting', preparing: true, message: 'Downloading jdtls', analysis: undefined })], undefined, 'Java'))
    .toEqual({ label: 'Setting up…', tone: 'busy', title: 'Setting up Java support…', description: 'Downloading jdtls' });
  expect(presentSupport([server({ state: 'starting', analysis: undefined })], undefined, 'Java')).toEqual({ label: '', tone: 'busy', description: 'Starting…' });
  expect(presentSupport([server({ messages: [{ id: 'm', message: 'Import the Gradle project?', actions: ['Yes'] }] })])).toMatchObject({ label: 'Needs answer', action: { kind: 'details', label: 'Answer…' } });
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
