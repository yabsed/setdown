import { languageFeaturePlan } from './language-feature-plan';
import type * as M from 'monaco-editor';
import type { DocumentContent as DocumentTab } from '../../core/workspace/document-store';
import type { LanguageRoute } from '../../core/document/language-support';
import { jsonDialect } from '../../core/document/language-policy';
import { languageSupport, resourceLanguageRoutes } from '../../core/document/language-support';
import { LanguageClient, type LanguageOptions } from './language-client';
import type { ProviderSupport } from './document-support';
import { builtinSupport, onBuiltinSupport } from './builtin-diagnostics';

const primaryChannel = '@primary';

/** Independent provider channels share the live models and diagnostic store.
 * The main process owns discovery/primary selection; explicit companions never
 * change that selection. Destructive features have one selected provider. */
export class LanguageServices {
  private readonly clients = new Map<string, LanguageClient>();
  private readonly models = new Map<M.editor.ITextModel, DocumentTab>();
  private readonly states = new Map<M.editor.ITextModel, Map<string, ProviderSupport>>();
  private readonly offBuiltin: () => void;
  private restarting?: Promise<void>;
  private disposed = false;
  constructor(private readonly api: typeof M, private readonly options: LanguageOptions & { routes(): LanguageRoute[]; changed(): void }) {
    this.offBuiltin = onBuiltinSupport(model => { if (this.models.has(model)) options.changed(); });
    this.client(primaryChannel);
  }
  private matching(model: M.editor.ITextModel, role?: 'primary' | 'supplementary') {
    const file = this.models.get(model)?.document.path ?? '';
    return resourceLanguageRoutes(this.options.routes(), file).filter(route => (model.getLanguageId() !== 'json' || jsonDialect(file) !== 'jsonl' || route.languageId === 'jsonl') && route.enabled !== false && (route.monacoId ?? route.languageId) === model.getLanguageId()
      && (!role || (route.role ?? 'primary') === role));
  }
  private route(file: string, key: string) {
    const model = [...this.models].find(([, tab]) => tab.document.path === file)?.[0];
    if (!model) return null;
    const routes = this.matching(model, key === primaryChannel ? 'primary' : 'supplementary').filter(route => key === primaryChannel || route.server === key);
    return languageSupport(file, routes) ?? (routes[0] ? { server: routes[0].server, languageId: routes[0].languageId } : null);
  }
  private client(key: string) {
    let client = this.clients.get(key);
    if (client) return client;
    client = new LanguageClient(this.api, { ...this.options, provider: key === primaryChannel ? undefined : key,
      route: file => this.route(file, key), languageId: model => {
        const tab = this.models.get(model); return tab && this.route(tab.document.path, key)?.languageId;
      },
      documentStatus: (model, status) => {
        const states = this.states.get(model) ?? new Map();
        if (status) states.set(key, status); else states.delete(key);
        if (states.size) this.states.set(model, states); else this.states.delete(model);
        this.options.changed();
      },
      filterCapabilities: (model, server, original) => languageFeaturePlan(server, key === primaryChannel, this.matching(model), original),
    });
    this.clients.set(key, client); return client;
  }
  bind(tab: DocumentTab, model: M.editor.ITextModel): void {
    this.models.set(model, tab);
    if (this.restarting || this.disposed) return;
    this.client(primaryChannel).bind(tab, model);
    const companions = new Set(this.matching(model, 'supplementary').map(route => route.server));
    for (const server of companions) this.client(server).bind(tab, model);
    for (const [key, client] of this.clients) if (key !== primaryChannel && !companions.has(key)) client.unbind(model);
    this.options.changed();
  }
  unbind(model: M.editor.ITextModel) {
    this.models.delete(model);
    for (const client of this.clients.values()) client.unbind(model);
    this.states.delete(model); this.options.changed();
  }
  supportFor(model: M.editor.ITextModel): ProviderSupport[] {
    const builtin = builtinSupport(model);
    const external = [...this.states.get(model)?.values() ?? []];
    return [...(builtin.features.length ? [builtin] : []), ...external];
  }
  capabilitiesFor(model: M.editor.ITextModel | null) {
    return Object.assign({}, ...[...this.clients.values()].map(client => Object.fromEntries(
      Object.entries(client.capabilitiesFor(model)).filter(([, value]) => !!value))));
  }
  async documentSymbols(model: M.editor.ITextModel) {
    const client = [...this.clients.values()].find(client => client.capabilitiesFor(model).documentSymbolProvider);
    return client ? client.documentSymbols(model) : [];
  }
  async beforeSave(model: M.editor.ITextModel, reason: 1 | 2) {
    // Each provider sees the result of the preceding save participant. Their
    // existing version guards still reject edits if the user types meanwhile.
    for (const client of [...this.clients.values()]) await client.beforeSave(model, reason);
  }
  saved(model: M.editor.ITextModel, text?: string) { for (const client of this.clients.values()) client.saved(model, text); }
  invalidate(servers: string[], documents?: Array<{ id: string; generation: string }>, roots?: string[]) { for (const client of this.clients.values()) client.invalidate(servers, documents, roots); }
  retryUnavailable() { for (const client of this.clients.values()) client.retryUnavailable(); }
  async restart(): Promise<void> {
    if (this.restarting) return this.restarting;
    for (const client of this.clients.values()) client.dispose(); this.clients.clear(); this.states.clear();
    this.restarting = this.options.port.restart().finally(() => { this.restarting = undefined; });
    try { await this.restarting; } finally {
      if (!this.disposed) for (const [model, tab] of this.models) if (!model.isDisposed()) this.bind(tab, model);
    }
  }
  showNavigation(kind: Parameters<LanguageClient['showNavigation']>[0], editor: M.editor.IStandaloneCodeEditor) {
    if (kind === 'problems') return this.client(primaryChannel).showNavigation(kind, editor);
    const capability = ({ symbols: 'workspaceSymbolProvider', incoming: 'callHierarchyProvider', outgoing: 'callHierarchyProvider',
      supertypes: 'typeHierarchyProvider', subtypes: 'typeHierarchyProvider' } as const)[kind];
    // Prefer the primary when it implements the command, otherwise use an
    // applicable companion. The command's enabled state uses this same union.
    return [...this.clients.values()].find(client => client.capabilitiesFor(editor.getModel())[capability])?.showNavigation(kind, editor);
  }
  dispose() { this.disposed = true; this.offBuiltin(); for (const client of this.clients.values()) client.dispose(); this.clients.clear(); this.models.clear(); this.states.clear(); }
}
