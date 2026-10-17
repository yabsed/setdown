import type * as L from 'vscode-languageserver-protocol';
import { noCancellation, type LanguageFeatureContext } from './language-feature-context';

export type DiagnosticCache = Map<string, { identifier?: string; resultId?: string; diagnostics: L.Diagnostic[]; version: number }>;
/** Each registration owns its resultId and markers. Refreshing capabilities
 * retires removed providers without dropping the surviving providers' results. */
export function installPullDiagnostics(c: LanguageFeatureContext, publish: (diagnostics: L.Diagnostic[]) => void, cache: DiagnosticCache = new Map()): void {
  const providers = c.capabilities.diagnosticProviders ?? (c.capabilities.diagnosticProvider
    ? [{ id: 'static', options: c.capabilities.diagnosticProvider }] : []);
  const hadProviders = cache.size > 0;
  for (const [id, previous] of cache) if (!providers.some(provider => provider.id === id && provider.options.identifier === previous.identifier)) cache.delete(id);
  const publishAll = () => publish([...cache.values()].filter(state => state.version === c.model.getVersionId()).flatMap(state => state.diagnostics));
  if (hadProviders) publishAll();
  for (const { id, options } of providers) {
    const state = cache.get(id) ?? { identifier: options.identifier, diagnostics: [], version: -1 };
    cache.set(id, state);
    let disposed = false, running = false, again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (disposed) return;
      if (running) { again = true; return; }
      running = true;
      const version = c.model.getVersionId();
      try {
        const result = await c.request<L.DocumentDiagnosticReport>('textDocument/diagnostic', { identifier: options.identifier, previousResultId: state.resultId }, noCancellation);
        if (result && c.alive(version) && !disposed) {
          if (result.kind === 'full') state.diagnostics = result.items;
          state.resultId = result.resultId; state.version = version;
          publishAll();
        }
      } finally { running = false; if (again) { again = false; schedule(); } }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void run(); }, 250); };
    c.add(c.model.onDidChangeContent(schedule), c.onRefresh('diagnostic', schedule), {
      dispose() { disposed = true; clearTimeout(timer); },
    });
    schedule();
  }
}
