import type * as M from 'monaco-editor';
import type { Diagnostic } from 'vscode-languageserver-protocol';
import { localSupport, replacesLocalChecks, jsonDialect } from '../../core/document/language-policy';
import { diagnosticsFor } from './diagnostic-store';
import { scriptKindForResource } from './typescript-resource';
import { marker } from './language-conversion';
import type { ProviderSupport } from './document-support';

export const hasBuiltinLanguageService = (language: string): boolean => localSupport(language).features.length > 0;
type DiagnosticMessage = { messageText: string; next?: DiagnosticMessage[] };
type LocalState = { state: ProviderSupport; schedule(): void; owners: Set<string> };
const states = new WeakMap<M.editor.ITextModel, LocalState>();
const listeners = new Set<(model: M.editor.ITextModel) => void>();
export const onBuiltinSupport = (listener: (model: M.editor.ITextModel) => void) => {
  listeners.add(listener); return () => { listeners.delete(listener); };
};
export function retargetBuiltin(api: typeof M, model: M.editor.ITextModel, path: string): void {
  diagnosticsFor(api).setResource(model, path); states.get(model)?.schedule();
}
export function builtinSupport(model: M.editor.ITextModel): ProviderSupport {
  const local = localSupport(model.getLanguageId());
  return states.get(model)?.state ?? { id: 'builtin', name: local.name, kind: 'builtin', state: 'ready', features: local.features, checks: local.checks };
}
export function ownLanguageDiagnostics(_api: typeof M, model: M.editor.ITextModel, server = ''): M.IDisposable {
  const local = states.get(model);
  if (!local || !replacesLocalChecks(server, model.getLanguageId())) return { dispose() {} };
  const key = crypto.randomUUID(); local.owners.add(key); local.schedule();
  return { dispose() { if (local.owners.delete(key)) local.schedule(); } };
}

// This pinned Monaco boundary exposes the real CSS worker through its own manager.
// Validation is scheduled here; completion/hover keep their independent adapters.
export type LocalValidator = (model: M.editor.ITextModel) => Promise<Diagnostic[] | M.editor.IMarkerData[]>;
export function installBuiltinDiagnostics(api: typeof M, validator?: LocalValidator): void {
  for (const defaults of [api.typescript.typescriptDefaults, api.typescript.javascriptDefaults]) {
    defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true });
    defaults.setCompilerOptions({ ...defaults.getCompilerOptions(), jsx: api.typescript.JsxEmit.Preserve });
  }
  api.json.jsonDefaults.setModeConfiguration({ ...api.json.jsonDefaults.modeConfiguration, diagnostics: false });
  for (const defaults of [api.css.cssDefaults, api.css.scssDefaults, api.css.lessDefaults])
    defaults.setModeConfiguration({ ...defaults.modeConfiguration, diagnostics: false });
  const cssWorkers = new Map<string, Promise<import('./local-worker-types').LocalWorkerManager>>();
  const validate: LocalValidator = validator ?? (async model => {
    const language = model.getLanguageId();
    if (language === 'json') {
      const worker = await (await api.json.getWorker())(model.uri);
      const resource = diagnosticsFor(api).resource(model), dialect = jsonDialect(resource);
      return (worker as unknown as { validateDocument(uri: string, resource: string, settings: Record<string, unknown>): Promise<Diagnostic[]> }).validateDocument(
        model.uri.toString(), api.Uri.file(resource).toString(), dialect === 'jsonc' ? { comments: 'ignore', trailingCommas: 'ignore' } : dialect === 'jsonl' ? { jsonLines: true } : {});
    }
    if (['css', 'scss', 'less'].includes(language)) {
      let manager = cssWorkers.get(language);
      if (!manager) {
        manager = import('monaco-editor/languages/features/css/workerManager').then(({ WorkerManager }) =>
          new WorkerManager(api.css[`${language}Defaults` as 'cssDefaults']));
        cssWorkers.set(language, manager);
      }
      return (await (await manager).getLanguageServiceWorker(model.uri)).doValidation(model.uri.toString());
    }
    const factory = await (language === 'typescript' ? api.typescript.getTypeScriptWorker() : api.typescript.getJavaScriptWorker());
    const worker = await factory(model.uri);
    const kind = scriptKindForResource(diagnosticsFor(api).resource(model), language === 'javascript');
    await (worker as typeof worker & { setScriptKind(uri: string, kind: number): Promise<void> }).setScriptKind(model.uri.toString(), kind);
    const diagnostics = await worker.getSyntacticDiagnostics(model.uri.toString());
    const flatten = (message: string | DiagnosticMessage): string => typeof message === 'string' ? message
      : [message.messageText, ...(message.next ?? []).map(flatten)].join('\n');
    return diagnostics.map(diagnostic => {
      const start = model.getPositionAt(diagnostic.start ?? 0), end = model.getPositionAt((diagnostic.start ?? 0) + (diagnostic.length ?? 1));
      return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column,
        severity: api.MarkerSeverity.Error, source: 'TypeScript syntax', code: String(diagnostic.code), message: flatten(diagnostic.messageText ?? '') };
    });
  });
  const attach = (model: M.editor.ITextModel) => {
    if (states.has(model)) return;
    let generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const lease = diagnosticsFor(api).lease(model, 'builtin', crypto.randomUUID());
    const changed = () => listeners.forEach(fn => fn(model));
    const local: LocalState = { state: builtinSupport(model), owners: new Set(), schedule: () => {
      clearTimeout(timer); const epoch = ++generation;
      lease.clear();
      const language = model.getLanguageId(), support = localSupport(language);
      if (language === 'json' && jsonDialect(diagnosticsFor(api).resource(model)) === 'jsonl') {
        support.checks = 'syntax'; support.features = ['Syntax']; support.name = 'JSON Lines';
      }
      local.state = { id: 'builtin', name: support.name, kind: 'builtin', state: 'ready', features: local.owners.size ? support.features.filter(feature => !['Syntax', 'Available schemas', 'CSS lint'].includes(feature)) : support.features,
        checks: local.owners.size ? 'none' : support.checks,
        message: local.owners.size ? 'Diagnostics provided by the analysis server.' : support.checks === 'syntax' ? 'Syntax only. Project and import checks require a project service.' : undefined };
      changed();
      if (support.checks === 'none' || local.owners.size) return;
      timer = setTimeout(() => { void (async () => {
        const version = model.getVersionId();
        const current = () => !model.isDisposed() && generation === epoch && model.getVersionId() === version;
        try {
          const result = await validate(model);
          if (!current()) return;
          // JSON's documented schema resolution code describes unavailable validation,
          // not a defect in the user's code. Preserve syntax and actual schema violations.
          const schemaIssues = language === 'json' ? result.filter(item => Number(item.code) === 768) : [];
          const items = result.filter(item => !schemaIssues.includes(item));
          lease.publish('local', items.map(item => 'range' in item ? marker(api, item) : item), version);
          local.state = { ...local.state, state: schemaIssues.length ? 'failed' : 'ready',
            message: schemaIssues.length ? schemaIssues.map(item => typeof item.message === 'string' ? item.message : item.message.value).join('\n')
              : language === 'json' ? 'Syntax and available schemas. No filesystem schema resolver is configured.' : local.state.message };
          changed();
        } catch (error) {
          if (current()) { local.state = { ...local.state, state: 'failed', message: String(error) }; changed(); }
        }
      })(); }, 180);
    } };
    states.set(model, local);
    const content = model.onDidChangeContent(local.schedule);
    const language = api.editor.onDidChangeModelLanguage(event => { if (event.model === model) local.schedule(); });
    const defaults = [api.json.jsonDefaults, api.css.cssDefaults, api.css.scssDefaults, api.css.lessDefaults,
      api.typescript.typescriptDefaults, api.typescript.javascriptDefaults];
    const settings = defaults.map(value => value.onDidChange(() => { if (localSupport(model.getLanguageId()).checks !== 'none') local.schedule(); }));
    model.onWillDispose(() => { ++generation; clearTimeout(timer); lease.dispose(); states.delete(model); content.dispose(); language.dispose(); settings.forEach(d => d.dispose()); });
    local.schedule();
  };
  api.editor.onDidCreateModel(attach);
  api.editor.getModels().forEach(attach);
}
