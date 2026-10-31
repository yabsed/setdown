import { expect, test } from 'vitest';
import type { AnalysisContext } from '../../core/document/analysis-context';
import type { ProviderSupport } from './document-support';
import { analysisResult, presentSupport, problemsEmpty } from './document-presentation';
const context: AnalysisContext = { id: 'env', root: '/project', rootReason: 'marker', environment: 'usable', choices: [], evidence: [], issues: [] };
const server = (patch: Partial<ProviderSupport> = {}): ProviderSupport => ({ id: 'primary', name: 'Primary', kind: 'server', state: 'ready', features: [], checks: 'Server diagnostics',
  analysis: { context, analysis: 'waiting', scope: 'open-files', freshness: 'none', progress: [] }, ...patch });
test('a connected server is quiet without claiming that checks completed', () => {
  const connected = server();
  expect(presentSupport([connected])).toEqual({ label: '', tone: 'neutral' });
  expect(analysisResult(connected)).toBe('Waiting for analysis results');
  expect(analysisResult(server({ analysis: { ...connected.analysis!, analysis: 'observed', freshness: 'best-effort' } }))).toBe('Results received for this open file');
  expect(analysisResult(server({ analysis: { ...connected.analysis!, analysis: 'working', freshness: 'stale' } }))).toBe('Waiting for results after the latest change');
  expect(presentSupport([server({ analysis: { ...connected.analysis!, analysis: 'working', freshness: 'stale' } })]).label).toBe('');
});
test('known environment repair precedes restart; supplementary failure retains the primary service', () => {
  const failed = server({ id: 'linter', name: 'Linter', role: 'supplementary', state: 'failed' });
  expect(presentSupport([server(), failed])).toMatchObject({ label: 'Some checks stopped', description: 'Primary remains connected.', action: { kind: 'restart', server: 'linter' } });
  expect(presentSupport([failed], { ...context, environment: 'action-needed', issues: [{ code: 'python-missing', message: 'Missing Python' }] })).toMatchObject({ title: 'Missing Python', action: { kind: 'environment' } });
});
test('intentional project-off suppresses irrelevant environment repair but preserves local checks', () => {
  const off = { ...context, environment: 'action-needed' as const, servers: [{ id: 'primary', name: 'Primary', enabled: false, selected: false, role: 'primary' as const }] };
  expect(presentSupport([], off)).toMatchObject({ tone: 'neutral', description: 'Project analysis is off.' });
  expect(presentSupport([server({ kind: 'builtin', checks: 'syntax', analysis: undefined })], off)).toMatchObject({ tone: 'neutral', description: 'Project analysis is off. Local checks remain available.' });
});
test('recovery, stopped recovery and partial/local failure remain actionable and distinct', () => {
  expect(presentSupport([server({ state: 'failed', recovery: { retrying: true, attempt: 2 } })])).toMatchObject({ label: 'Reconnecting', tone: 'busy' });
  expect(presentSupport([server({ state: 'failed', recovery: { retrying: false } })]).action?.kind).toBe('restart');
  expect(presentSupport([server({ kind: 'builtin', state: 'failed', message: 'Unable to load schema' })])).toMatchObject({ tone: 'warning', title: 'Unable to load schema', action: { kind: 'details' } });
  expect(presentSupport([server()], { ...context, environment: 'partial' }).label).toBe('Analysis limited');
});
test('Problems distinguishes unknown coverage, pending results and observed results without claiming full coverage', () => {
  expect(problemsEmpty([])).toContain('Check code support');
  expect(problemsEmpty([server()])).toContain('still pending');
  expect(problemsEmpty([server({ checks: 'none' })])).toContain('still pending');
  expect(problemsEmpty([server({ analysis: { context, analysis: 'observed', scope: 'open-files', freshness: 'best-effort', progress: [] } })])).toContain('does not establish project-wide coverage');
});
