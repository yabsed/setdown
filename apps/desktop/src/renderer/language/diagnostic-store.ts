import type * as M from 'monaco-editor';

export type DiagnosticBatch = {
  provider: string; channel: string; epoch: string; version?: number;
  freshness: 'versioned' | 'best-effort'; items: M.editor.IMarkerData[];
};
/** One store feeds markers and Problems. Each lease owns only its contribution. */
export class DiagnosticStore {
  private readonly resources = new WeakMap<M.editor.ITextModel, string>();
  resource(model: M.editor.ITextModel): string { return this.resources.get(model) ?? model.uri.fsPath; }
  setResource(model: M.editor.ITextModel, resource: string) { this.resources.set(model, resource); }
  private readonly listeners = new Set<() => void>();
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private readonly batches = new Map<M.editor.ITextModel, Map<string, DiagnosticBatch>>();
  constructor(private readonly api: typeof M) {}
  lease(model: M.editor.ITextModel, provider: string, epoch: string) {
    const key = `${provider}:${epoch}`;
    const owner = `setdown:${key}`;
    let live = true;
    const channels = new Map<string, DiagnosticBatch>();
    const publish = () => {
      const batches = this.batches.get(model) ?? new Map();
      for (const id of [...batches.keys()]) if (id.startsWith(key + ':')) batches.delete(id);
      for (const [channel, batch] of channels) batches.set(`${key}:${channel}`, batch);
      if (batches.size) this.batches.set(model, batches); else this.batches.delete(model);
      if (!model.isDisposed()) this.api.editor.setModelMarkers(model, owner, [...channels.values()].flatMap(batch => batch.items));
      this.listeners.forEach(listener => listener());
    };
    return {
      publish: (channel: string, items: M.editor.IMarkerData[], version?: number) => {
        if (!live || model.isDisposed() || (version !== undefined && model.getVersionId() !== version)) return;
        channels.set(channel, { provider, channel, epoch, version, freshness: version === undefined ? 'best-effort' : 'versioned',
          items: items.map(item => ({ ...item, source: item.source ?? provider })) });
        publish();
      },
      clear: () => { if (live && channels.size) { channels.clear(); publish(); } },
      dispose: () => { if (live) { live = false; channels.clear(); publish(); this.batches.get(model)?.size || this.batches.delete(model); } },
    };
  }
  entries() {
    return [...this.batches].filter(([model]) => !model.isDisposed()).flatMap(([model, batches]) =>
      [...batches.values()].flatMap(batch => batch.items.map(item => ({ model, batch, item }))));
  }
}
const stores = new WeakMap<typeof M, DiagnosticStore>();
export function diagnosticsFor(api: typeof M): DiagnosticStore {
  let store = stores.get(api); if (!store) { store = new DiagnosticStore(api); stores.set(api, store); } return store;
}
