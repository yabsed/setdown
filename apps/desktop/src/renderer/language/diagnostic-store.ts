import type { Diagnostic } from 'vscode-languageserver-protocol';
import type { AnalysisContext } from '../../core/document/analysis-context';
import type * as M from 'monaco-editor';
import type { LanguageResult } from './language-results';

export type DiagnosticBatch = {
  raw?: Diagnostic[]; context?: AnalysisContext; provider: string; channel: string; epoch: string; version?: number;
  freshness: 'versioned' | 'best-effort'; items: M.editor.IMarkerData[];
};
/** A resource survives editor virtualization. Source revisions belong to the
 * document, not to a mounted Monaco model. */
export type DiagnosticResource = {
  path: string; cellId?: string; label?(): string;
  alive(): boolean; version(): number; line(line: number): string;
  model(): M.editor.ITextModel | undefined;
  open?(range: M.IRange): Promise<void>;
};
export type DiagnosticLease = ReturnType<DiagnosticStore['leaseResource']>;
/** URI/owner store shared by file markers, notebook markers and Problems. */
export class DiagnosticStore {
  private readonly resources = new WeakMap<M.editor.ITextModel, string>();
  resource(model: M.editor.ITextModel): string { return this.resources.get(model) ?? model.uri.fsPath; }
  setResource(model: M.editor.ITextModel, resource: string) { this.resources.set(model, resource); }
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private readonly batches = new Map<string, Map<string, { resource: DiagnosticResource; batch: DiagnosticBatch }>>();
  constructor(private readonly api: typeof M) {}
  lease(model: M.editor.ITextModel, provider: string, epoch: string) {
    return this.leaseResource(model.uri.toString(), provider, epoch, {
      path: this.resource(model), alive: () => !model.isDisposed(), version: () => model.getVersionId(),
      line: line => model.getLineContent(line), model: () => model,
    });
  }
  leaseResource(uri: string, provider: string, epoch: string, resource: DiagnosticResource) {
    const key = `${provider}:${epoch}`, owner = `setdown:${key}`;
    let live = true;
    const channels = new Map<string, DiagnosticBatch>();
    const refresh = () => {
      const model = resource.model();
      if (model && !model.isDisposed()) this.api.editor.setModelMarkers(model, owner, [...channels.values()].flatMap(batch => batch.items));
    };
    const publish = () => {
      const batches = this.batches.get(uri) ?? new Map();
      for (const id of [...batches.keys()]) if (id.startsWith(key + ':')) batches.delete(id);
      for (const [channel, batch] of channels) batches.set(`${key}:${channel}`, { resource, batch });
      if (batches.size) this.batches.set(uri, batches); else this.batches.delete(uri);
      refresh(); this.listeners.forEach(listener => listener());
    };
    return {
      publish: (channel: string, items: M.editor.IMarkerData[], version?: number, metadata?: { diagnostics: Diagnostic[]; context?: AnalysisContext }) => {
        if (!live || !resource.alive() || (version !== undefined && resource.version() !== version)) return;
        channels.set(channel, { raw: metadata?.diagnostics, context: metadata?.context, provider, channel, epoch, version, freshness: version === undefined ? 'best-effort' : 'versioned',
          items: items.map(item => ({ ...item, source: item.source ?? provider })) });
        publish();
      },
      refresh: () => { if (live) refresh(); },
      clear: () => { if (live && channels.size) { channels.clear(); publish(); } },
      dispose: () => { if (live) { live = false; channels.clear(); publish(); } },
    };
  }
  entries() {
    return [...this.batches].flatMap(([uri, batches]) => [...batches.values()].filter(({ resource }) => resource.alive())
      .flatMap(({ resource, batch }) => batch.items.map(item => ({ uri, resource, model: resource.model(), batch, item }))));
  }
  results(openFile: (path: string, range: M.IRange) => Promise<void>): LanguageResult[] {
    return this.entries().map(({ resource, batch, item }) => ({
      label: item.message, detail: `${item.source ?? batch.provider} · ${resource.label?.() ?? resource.path}:${item.startLineNumber}`,
      location: { path: resource.path, cellId: resource.cellId, line: item.startLineNumber, column: item.startColumn,
        endLine: item.endLineNumber, endColumn: item.endColumn, context: resource.line(item.startLineNumber), version: resource.version() },
      open: async () => { if (resource.alive()) await (resource.open ? resource.open(item) : openFile(resource.path, item)); },
    }));
  }
}
const stores = new WeakMap<typeof M, DiagnosticStore>();
export function diagnosticsFor(api: typeof M): DiagnosticStore {
  let store = stores.get(api); if (!store) { store = new DiagnosticStore(api); stores.set(api, store); } return store;
}
