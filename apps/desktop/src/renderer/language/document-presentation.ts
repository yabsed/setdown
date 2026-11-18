import type { AnalysisContext, DocumentAnalysis } from '../../core/document/analysis-context';
import type { LanguageIssue } from '../../protocol/language';
import type { ProviderSupport } from './document-support';

export type SupportAction = { kind: 'environment' | 'provider' | 'details' | 'restart' | 'automatic' | 'install' | 'locate' | 'help' | 'log' | 'manage';
  label: string; server?: string; runtime?: string };
/** `label` is the short status beside the language name; `title` is the one sentence
 * that says what is wrong, and `action` the one control that addresses its cause. */
export type SupportPresentation = { label: string; tone: 'neutral' | 'warning' | 'busy'; title?: string; description?: string;
  action?: SupportAction; secondary?: SupportAction; working?: boolean };

/** A path as a person recognizes it: the program and the two folders that hold it. */
export function shortPath(file: string): string {
  const parts = file.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : file;
}

/** One cause, one sentence, one action. `subject` is what the person lost, such as
 * "Java support"; tool names appear only when one of several tools is affected. */
export function presentIssue(issue: LanguageIssue | undefined, subject: string, server: string, unstarted = false): Required<Pick<SupportPresentation, 'title'>> & Pick<SupportPresentation, 'description' | 'action' | 'secondary'> {
  const log: SupportAction = { kind: 'log', label: 'Show log', server };
  const locate: SupportAction = { kind: 'locate', label: 'I already have it…', server };
  switch (issue?.kind) {
    case 'download-failed': return { title: `Couldn't ${/download|network|fetch|connect|resolv|timed out|offline|dns|certificate|http|socket/i.test(issue.detail ?? '') ? 'download' : 'set up'} ${subject}.`,
      description: issue.detail, action: { kind: 'restart', label: 'Try again', server } };
    case 'downloads-off': return { title: `${subject} isn't installed.`, description: 'Downloads are off.', action: { kind: 'install', label: `Install ${subject}`, server } };
    case 'no-installer': return { title: `${subject} isn't installed.`, description: `Setdown can't install it by itself.`,
      ...(issue.help ? { action: { kind: 'help', label: 'How to install ↗', server }, secondary: locate } : { action: locate }) };
    case 'executable': {
      const choose: SupportAction = { kind: 'locate', label: 'Choose program…', server };
      return { title: `${subject} can't start.`,
        description: `It is set to run ${shortPath(issue.path)}, which ${issue.missing ? 'no longer exists' : 'did not start as a language tool'}.`,
        ...(issue.automatic ? { action: { kind: 'automatic', label: 'Use automatic setup', server }, secondary: issue.missing ? choose : log } : { action: choose, ...(issue.missing ? {} : { secondary: log }) }) };
    }
    case 'runtime': return { title: `${subject} needs ${issue.runtime}${issue.required ? ` ${issue.required} or newer` : ''}.`,
      description: issue.found ? `Found ${issue.runtime} ${issue.found}.` : issue.required ? `No suitable ${issue.runtime} was found.` : `${issue.runtime} was not found.`,
      action: { kind: 'help', label: 'How to install ↗', server, runtime: issue.runtime }, secondary: log };
    case 'startup': return { title: `${subject} can't start.`, description: issue.detail, action: log, secondary: { kind: 'restart', label: 'Try again', server } };
    case 'crashed': return { title: `${subject} stopped unexpectedly.`, action: { kind: 'restart', label: 'Restart', server }, secondary: log };
    default: return unstarted ? { title: `${subject} can't start.`, action: { kind: 'restart', label: 'Try again', server } }
      : { title: `${subject} stopped unexpectedly.`, action: { kind: 'restart', label: 'Restart', server }, secondary: log };
  }
}

/** Builder keeps syntax, project configuration and process details at separate UI
 * boundaries. The summary states a cause and its repair; the underlying observations
 * stay intact one step further in. */
export function presentSupport(providers: ProviderSupport[], context?: DocumentAnalysis | AnalysisContext, language = 'Code'): SupportPresentation {
  const servers = providers.filter(p => p.kind === 'server');
  const active = servers.filter(p => p.state === 'ready');
  const policy = context && 'analysisSelection' in context ? context.analysisSelection : undefined;
  const projectOff = policy?.mode === 'off';
  const offDescription = policy?.source === 'project' ? 'Analysis is turned off for this project.' : 'Analysis is turned off by the app default.';
  // What stops is the language's support, unless another tool still serves the document.
  const subject = (provider: ProviderSupport) => active.some(p => p.id !== provider.id) ? provider.name : `${language} support`;
  const remaining = (provider: ProviderSupport) => { const names = active.filter(p => p.id !== provider.id).map(p => p.name); return names.length ? `${names.join(', ')} still works.` : undefined; };
  const failed = servers.find(p => p.state === 'failed' && !p.recovery?.retrying);
  const stopped = () => {
    const partial = remaining(failed!), shown = presentIssue(failed!.issue, subject(failed!), failed!.id, !failed!.recovery);
    return { label: partial ? 'Limited' : failed!.issue?.kind === 'no-installer' || failed!.issue?.kind === 'downloads-off' ? 'Needs setup' : 'Not working', tone: 'warning' as const,
      ...shown, description: [shown.description, partial].filter(Boolean).join(' ') || undefined };
  };
  // A tool that cannot start at all comes first: no environment choice can start it. A tool
  // that stopped, or failed for an unknown reason, may have stopped because of its environment.
  if (failed?.issue && failed.issue.kind !== 'crashed' && failed.issue.kind !== 'startup') return stopped();
  const environment = !projectOff && (context?.environment === 'action-needed' ? context : servers.find(p => p.analysis?.context.environment === 'action-needed')?.analysis?.context);
  if (environment) return { label: 'Needs setup', tone: 'warning', title: environment.issues[0]?.message ?? 'Choose an environment for this project.',
    action: { kind: 'environment', label: environment.kind === 'compilation' ? 'Choose build configuration…' : 'Choose environment…' } };
  const selection = servers.find(p => p.state === 'selection-needed');
  // Several tools are no longer a question: the language's order decides. What remains is
  // several copies of one program, and the tool's own page lists them.
  if (selection) return { label: 'Needs setup', tone: 'warning', title: `Choose which copy of ${selection.name} to use.`, description: 'More than one was found on this computer.',
    action: { kind: 'manage', label: 'Choose…', server: selection.id } };
  if (failed) return stopped();
  const limited = !projectOff && (context?.environment === 'partial' ? context : servers.find(p => p.analysis?.context.environment === 'partial')?.analysis?.context);
  if (limited) return { label: 'Limited', tone: 'warning', title: limited.issues[0]?.message ?? 'The project environment has limitations.', action: { kind: 'details', label: 'Review environment…' } };
  const missing = servers.find(p => p.state === 'missing');
  if (missing && (missing.issue || missing.message)) {
    const partial = remaining(missing);
    const shown = missing.issue ? presentIssue(missing.issue, subject(missing), missing.id, true)
      : { title: `${subject(missing)} isn't available.`, description: missing.message, action: { kind: 'details' as const, label: 'Tool settings…', server: missing.id } };
    // A tool Setdown cannot install is a quiet state: the file still opens and edits as before.
    // The sentence and its action are there when the person opens the status.
    const quiet = missing.issue?.kind === 'no-installer';
    if (!quiet || !active.length) return { label: quiet ? '' : partial ? 'Limited' : 'Needs setup', tone: quiet ? 'neutral' : 'warning', ...shown,
      description: [shown.description, partial].filter(Boolean).join(' ') || undefined };
  }
  const localFailure = providers.find(p => p.kind === 'builtin' && p.state === 'failed');
  if (localFailure) return { label: 'Limited', tone: 'warning', title: localFailure.message ?? `${localFailure.name} checks are limited.`, action: { kind: 'details', label: 'Review checks…', server: localFailure.id } };
  const request = providers.find(p => p.messages?.length);
  if (request) return { label: 'Needs answer', tone: 'warning', title: `${request.name} has a question.`, action: { kind: 'details', label: 'Answer…', server: request.id } };
  const recovery = servers.find(p => p.recovery?.retrying);
  if (recovery) return { label: 'Reconnecting…', tone: 'busy', title: `Reconnecting ${subject(recovery)}…`, description: `Attempt ${recovery.recovery!.attempt} of 3.` };
  const starting = servers.find(p => p.state === 'starting');
  // Setdown says once that it is fetching a tool; an ordinary start stays quiet.
  if (starting?.preparing) return { label: 'Setting up…', tone: 'busy', title: `Setting up ${subject(starting)}…`, description: starting.message };
  if (starting) return { label: '', tone: 'busy', description: 'Starting…' };
  if (active.some(p => p.analysis?.analysis === 'working' && p.analysis.progress.length)) return { label: '', tone: 'busy', working: true };
  if (active.length) return { label: '', tone: 'neutral', working: true };
  const change: SupportAction | undefined = projectOff && context && 'servers' in context && context.servers.some(s => s.role === 'primary') ? { kind: 'provider', label: 'Change…' } : undefined;
  if (providers.some(p => p.state === 'ready' && p.checks !== 'none')) return { label: '', tone: 'neutral', description: projectOff ? `${offDescription} Local checks remain available.` : 'Only local checks are active.', action: change };
  if (!projectOff && context && 'servers' in context && !context.servers.some(s => s.role === 'primary'))
    return { label: '', tone: 'neutral', description: 'Syntax highlighting and editing support are available. The default support for this language does not include project analysis.' };
  return { label: '', tone: 'neutral', description: projectOff ? offDescription : 'No project checks are active for this document.', action: change };
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
  return context.selectionSource === 'notebook' ? 'Notebook environment' : context.selectionSource === 'project' ? 'Project selection' : context.selectionSource === 'connection' ? 'Connection settings' : 'Automatic selection';
}

/** Empty Problems never implies that every open file or the project was checked. */
export function problemsEmpty(providers: ProviderSupport[]): string {
  const checked = providers.filter(p => p.state === 'ready' && p.checks !== 'none');
  if (providers.some(p => (p.state === 'ready' || p.state === 'starting') && p.analysis && (p.analysis.analysis !== 'observed' || p.analysis.freshness === 'stale')))
    return 'No diagnostics reported. Some analysis results are still pending.';
  if (!checked.length) return 'No diagnostics reported. Check code support to see which checks are active.';
  return 'No diagnostics reported by the active checks. This does not establish project-wide coverage.';
}
