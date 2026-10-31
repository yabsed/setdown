import type { LanguageCatalogEntry, LanguageRecovery, LanguageServerMessage, LanguageServerOptions } from '../../protocol/language';
import type { AnalysisObservation, AnalysisSelection, DocumentAnalysis } from '../../core/document/analysis-context';
/** Small renderer store shared by editor groups. It has no Monaco/runtime imports. */
export type ProviderSupport = {
  id: string; name: string; kind: 'builtin' | 'server';
  state: 'starting' | 'ready' | 'failed' | 'missing' | 'selection-needed' | 'off';
  role?: 'primary' | 'supplementary'; recovery?: LanguageRecovery;
  messages?: LanguageServerMessage[]; analysis?: AnalysisObservation; diagnosticCount?: number; features: string[]; checks: string; message?: string; context?: string[];
};
export type DocumentSupport = {
  id: string; resource: string; language: string; name: string; path: string;
  providers: ProviderSupport[]; choices: { id: string; name: string }[];
  setLanguage(id: string): void; restart(server?: string): Promise<void>; problems(): void;
  answerMessage(server: string, request: string, action?: number): Promise<void>;
  environment(): Promise<DocumentAnalysis>; selectEnvironment(selection: AnalysisSelection): Promise<DocumentAnalysis>;
  prepareEnvironment(): Promise<{ output: string }>; cancelPreparation(): Promise<void>;
  inspectProvider(server: string): Promise<LanguageCatalogEntry | undefined>;
  configureProvider(server: string, options: LanguageServerOptions): Promise<void>;
};
const documents = new Map<string, DocumentSupport>();
const listeners = new Set<() => void>();
export const documentSupport = {
  get: (id: string) => documents.get(id),
  current(target: DocumentSupportTarget): DocumentSupport | undefined {
    const current = documents.get(target.id);
    return current?.resource === target.resource ? current : undefined;
  },
  all: () => [...documents.values()],
  set(value: DocumentSupport) { documents.set(value.id, value); listeners.forEach(fn => fn()); },
  remove(id: string) { if (documents.delete(id)) listeners.forEach(fn => fn()); },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
export type DocumentSupportTarget = Pick<DocumentSupport, 'id' | 'resource'>;
export type AnalysisPage = 'summary' | 'language' | 'environment' | 'provider' | 'details' | 'tool' | 'settings' | 'output';
export type LanguageCatalogRequest = { language?: string; server?: string };
let catalogRequest: LanguageCatalogRequest = {};
const catalogListeners = new Set<() => void>();
export const languageCatalogRequest = {
  get: () => catalogRequest,
  set(value: LanguageCatalogRequest) { catalogRequest = value; catalogListeners.forEach(listener => listener()); },
  subscribe(listener: () => void) { catalogListeners.add(listener); return () => { catalogListeners.delete(listener); }; },
};
/** Document commands are handled only by the owning tab's location bar. */
export function openLanguageSupport(target?: DocumentSupportTarget, page: AnalysisPage = 'details'): void {
  if (!target) { openLanguageCatalog(); return; }
  const event = new CustomEvent('setdown:document-language-support', { cancelable: true, detail: { target: { id: target.id, resource: target.resource }, page } });
  if (window.dispatchEvent(event)) openLanguageCatalog(documentSupport.current(target)?.language);
}
export function openLanguageCatalog(language?: string, server?: string): void {
  languageCatalogRequest.set({ language, server });
  window.dispatchEvent(new CustomEvent('setdown:language-support'));
}
export function featureLabels(features: string[]): string[] {
  const names: Record<string, string> = {
    completion: 'Completion', hover: 'Hover', signatureHelp: 'Parameter hints',
    definition: 'Navigation', declaration: 'Navigation', typeDefinition: 'Navigation', implementation: 'Navigation', references: 'Navigation',
    documentSymbol: 'Symbols', workspaceSymbol: 'Symbols', documentHighlight: 'Symbol highlights',
    selectionRange: 'Smart selection', foldingRange: 'Folding', documentLink: 'Links', semanticTokens: 'Semantic colors',
    inlayHint: 'Inlay hints', color: 'Color picker', rename: 'Rename', codeAction: 'Quick fixes', codeLens: 'Code lenses',
    documentFormatting: 'Formatting', documentRangeFormatting: 'Formatting', documentOnTypeFormatting: 'Format on type',
    linkedEditingRange: 'Linked editing', diagnostic: 'Diagnostics', callHierarchy: 'Call hierarchy', typeHierarchy: 'Type hierarchy',
  };
  return [...new Set(features.map(feature => names[feature] ?? feature))];
}
