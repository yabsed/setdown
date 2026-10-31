import type { AnalysisContext, DocumentAnalysis } from '../../core/document/analysis-context';
import type { ProviderSupport } from './document-support';

export type SupportAction = { kind: 'environment' | 'provider' | 'details' | 'restart'; label: string; server?: string };
export type SupportPresentation = { label: string; tone: 'neutral' | 'warning' | 'busy'; title?: string; description?: string; action?: SupportAction };

/** Builder keeps syntax, project configuration and process details at separate UI
 * boundaries. Summaries express a task; the underlying observations stay intact. */
export function presentSupport(providers: ProviderSupport[], context?: DocumentAnalysis | AnalysisContext): SupportPresentation {
  const servers = providers.filter(p => p.kind === 'server');
  const active = servers.filter(p => p.state === 'ready');
  const projectOff = context && 'servers' in context && context.servers.length > 0 && !context.servers.some(s => s.enabled);
  const environment = !projectOff && (context?.environment === 'action-needed' ? context : servers.find(p => p.analysis?.context.environment === 'action-needed')?.analysis?.context);
  if (environment) return { label: 'Choose environment', tone: 'warning', title: environment.issues[0]?.message ?? 'Choose an analysis environment for this project.',
    description: 'Editing and syntax colors remain available.', action: { kind: 'environment', label: environment.kind === 'compilation' ? 'Choose build configuration…' : 'Choose environment…' } };
  const selection = servers.find(p => p.state === 'selection-needed');
  if (selection) return { label: 'Choose analysis', tone: 'warning', title: 'Choose an analysis tool for this project.', action: { kind: 'provider', label: 'Choose analysis tool…' } };
  const failed = servers.find(p => p.state === 'failed' && !p.recovery?.retrying);
  if (failed) {
    const partial = active.some(p => p.id !== failed.id);
    return { label: partial ? 'Some checks stopped' : 'Analysis stopped', tone: 'warning', title: `${failed.name} stopped.`,
      description: partial ? `${active.map(p => p.name).join(', ')} remains connected.` : failed.recovery?.retrying === false ? 'Automatic recovery paused after repeated failures. Editing remains available.' : 'Editing and syntax colors remain available.',
      action: { kind: 'restart', label: `Restart ${failed.name}`, server: failed.id } };
  }
  const limited = !projectOff && (context?.environment === 'partial' ? context : servers.find(p => p.analysis?.context.environment === 'partial')?.analysis?.context);
  if (limited) return { label: 'Analysis limited', tone: 'warning', title: limited.issues[0]?.message ?? 'The project environment has limitations.', action: { kind: 'details', label: 'Review environment…' } };
  const missing = servers.find(p => p.state === 'missing');
  if (missing && active.length) return { label: 'Some tools unavailable', tone: 'warning', title: `${missing.name} is not available.`, description: `${active.map(p => p.name).join(', ')} remains connected.`, action: { kind: 'provider', label: 'Manage analysis tools…' } };
  const localFailure = providers.find(p => p.kind === 'builtin' && p.state === 'failed');
  if (localFailure) return { label: 'Local checks limited', tone: 'warning', title: localFailure.message ?? `${localFailure.name} checks are limited.`, action: { kind: 'details', label: 'Review checks…', server: localFailure.id } };
  const request = providers.find(p => p.messages?.length);
  if (request) return { label: 'Message from analysis tool', tone: 'warning', title: `${request.name} has a message.`, action: { kind: 'details', label: 'Review message…', server: request.id } };
  const recovery = servers.find(p => p.recovery?.retrying);
  if (recovery) return { label: 'Reconnecting', tone: 'busy', title: `Reconnecting ${recovery.name}…`, description: `Attempt ${recovery.recovery!.attempt} of 3. Editing remains available.` };
  if (servers.some(p => p.state === 'starting')) return { label: 'Starting analysis', tone: 'busy' };
  if (active.some(p => p.analysis?.analysis === 'working' && p.analysis.progress.length)) return { label: 'Analyzing', tone: 'busy' };
  if (active.length) return { label: '', tone: 'neutral' };
  if (providers.some(p => p.state === 'ready' && p.checks !== 'none')) return { label: '', tone: 'neutral', description: projectOff ? 'Project analysis is off. Local checks remain available.' : 'Only local checks are active.' };
  return { label: providers.some(p => p.state === 'ready' && p.features.length) ? 'Editing support' : 'Basic editing', tone: 'neutral',
    description: projectOff ? 'Project analysis is off.' : 'No project checks are active for this document.' };
}

export function providerStatus(provider: ProviderSupport): string {
  if (provider.recovery?.retrying) return 'Reconnecting';
  return ({ ready: provider.kind === 'builtin' ? 'Built in' : 'Connected', starting: 'Starting', failed: 'Stopped', missing: 'Not installed', 'selection-needed': 'Selection needed', off: 'Off' })[provider.state];
}
export function analysisResult(provider: ProviderSupport): string {
  if (provider.state !== 'ready') return providerStatus(provider);
  const observation = provider.analysis;
  if (!observation) return provider.checks === 'syntax' ? 'Syntax only' : provider.checks !== 'none' ? provider.checks : 'Editing support';
  if (observation.progress.length && observation.analysis === 'working') return 'Analyzing…';
  if (observation.freshness === 'stale') return 'Waiting for results after the latest change';
  if (observation.analysis === 'observed') return observation.scope === 'project' ? 'Project results received' : 'Results received for this open file';
  return 'Waiting for analysis results';
}
/** Keep enough parent context to distinguish nested projects. Full paths remain
 * keyboard-accessible in details; this label never determines the actual scope. */
export function projectLabel(root: string): string {
  return root.replaceAll('\\', '/').split('/').filter(Boolean).slice(-2).join(' / ') || root;
}
export function selectionSource(context: AnalysisContext): string {
  return context.selectionSource === 'project' ? 'Project selection' : context.selectionSource === 'connection' ? 'Connection settings' : 'Automatic selection';
}

/** Empty Problems never implies that every open file or the project was checked. */
export function problemsEmpty(providers: ProviderSupport[]): string {
  const checked = providers.filter(p => p.state === 'ready' && p.checks !== 'none');
  if (providers.some(p => (p.state === 'ready' || p.state === 'starting') && p.analysis && (p.analysis.analysis !== 'observed' || p.analysis.freshness === 'stale')))
    return 'No diagnostics reported. Some analysis results are still pending.';
  if (!checked.length) return 'No diagnostics reported. Check code support to see which checks are active.';
  return 'No diagnostics reported by the active checks. This does not establish project-wide coverage.';
}
