import type * as L from 'vscode-languageserver-protocol';
import { noCancellation, type LanguageFeatureContext } from './language-feature-context';

/** Debounced, one-document pull diagnostics; no workspace-wide polling on startup. */
export function installPullDiagnostics(c: LanguageFeatureContext, publish: (diagnostics: L.Diagnostic[]) => void): void {
  if (!c.capabilities.diagnosticProvider) return;
  const options = c.capabilities.diagnosticProvider;
  let resultId: string | undefined, diagnostics: L.Diagnostic[] = [], disposed = false, running = false, again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (disposed) return;
    if (running) { again = true; return; }
    running = true;
    const version = c.model.getVersionId();
    try {
      const result = await c.request<L.DocumentDiagnosticReport>('textDocument/diagnostic', { identifier: options.identifier, previousResultId: resultId }, noCancellation);
      if (result && c.alive(version) && !disposed) {
        if (result.kind === 'full') diagnostics = result.items;
        resultId = result.resultId;
        publish(diagnostics);
      }
    } finally { running = false; if (again) { again = false; schedule(); } }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void run(); }, 250); };
  c.add(c.model.onDidChangeContent(schedule), c.onRefresh('diagnostic', schedule), {
    dispose() { disposed = true; clearTimeout(timer); },
  });
  schedule();
}
