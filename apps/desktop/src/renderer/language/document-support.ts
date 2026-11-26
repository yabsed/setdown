import type { LanguageCatalogEntry, LanguageIssue, LanguageRecovery, LanguageServerMessage, LanguageServerOptions } from '../../protocol/language';
import type { AnalysisObservation, AnalysisSelection, DocumentAnalysis } from '../../core/document/analysis-context';
import type { ToolFamily } from '../../protocol/language-tools';
/** Small renderer store shared by editor groups. It has no Monaco/runtime imports. */
export type ProviderSupport = {
  id: string; name: string; kind: 'builtin' | 'server';
  state: 'starting' | 'ready' | 'failed' | 'missing' | 'off';
  role?: 'primary' | 'supplementary'; recovery?: LanguageRecovery;
  /** Why the tool is not working, and whether it is being set up for the first time. */
  issue?: LanguageIssue; preparing?: boolean;
  messages?: LanguageServerMessage[]; analysis?: AnalysisObservation; diagnosticCount?: number; features: string[]; checks: string; message?: string; context?: string[];
  /** The extension whose commands the tool is offered with, once it is ready. */
  tool?: ToolFamily;
  /** What the tool itself reported it could not find in this document: the one sign that results
   * here are incomplete (`protocol/language-tools.ts` `unresolvedSymptoms`). */
  unresolved?: { count: number; noun: 'include' | 'import' };
};
/** One way of choosing what the analysis is based on, whichever language it belongs to: the
 * current one first, the one that is in effect without a choice marked as recommended. */
export type EnvironmentChoice = { id: string; name: string; detail?: string; current?: boolean; recommended?: boolean; unavailable?: boolean };
/** A choice the tool itself keeps (the Go in use, a YAML file's schema), in that same form. */
export type ToolEnvironment = { id: string; label: string; value: string; choices: EnvironmentChoice[]; refusal?: string; note?: string };
/** A command of the tool's own extension that acts on the project or on the tool. */
export type ToolAction = { id: string; server: string; title: string; place: 'project' | 'settings' };
export type DocumentSupport = {
  id: string; resource: string; language: string; name: string; path: string;
  providers: ProviderSupport[]; choices: { id: string; name: string }[];
  /** What this document goes without because of its size, as a sentence. */
  limits?: string;
  setLanguage(id: string): void; restart(server?: string): Promise<void>; problems(): void;
  /** Repairs for a tool's setup. Each reconnects the document when it succeeds. */
  useAutomatic(server: string): Promise<void>; allowDownload(server: string): Promise<void>; chooseExecutable(server: string): Promise<void>;
  openHelp(server: string, runtime?: string): Promise<void>;
  answerMessage(server: string, request: string, action?: number): Promise<void>;
  environment(): Promise<DocumentAnalysis>; selectEnvironment(selection: AnalysisSelection): Promise<DocumentAnalysis>;
  prepareEnvironment(): Promise<{ output: string }>; cancelPreparation(): Promise<void>;
  inspectProvider(server: string): Promise<LanguageCatalogEntry | undefined>;
  configureProvider(server: string, options: LanguageServerOptions): Promise<void>;
  /** The rows of tool-kept choices this document has, known without asking the tool. */
  toolEnvironments: { id: string; label: string }[];
  /** Asks the tool for one of them. */
  toolEnvironment(id: string): Promise<ToolEnvironment>;
  /** Makes the choice. The answer is a sentence to show, when there is one. */
  chooseToolEnvironment(id: string, choice: string): Promise<string | undefined>;
  toolActions: ToolAction[];
  runToolAction(id: string): Promise<void>;
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
export type AnalysisPage = 'summary' | 'language' | 'environment' | 'tool-environment' | 'provider' | 'details' | 'tool' | 'settings' | 'output';
export type LanguageCatalogRequest = { language?: string; server?: string };
let catalogRequest: LanguageCatalogRequest = {};
const catalogListeners = new Set<() => void>();
export const languageCatalogRequest = {
  get: () => catalogRequest,
  set(value: LanguageCatalogRequest) { catalogRequest = value; catalogListeners.forEach(listener => listener()); },
  subscribe(listener: () => void) { catalogListeners.add(listener); return () => { catalogListeners.delete(listener); }; },
};
/** Document commands are handled only by the owning tab's location bar. */
export function openLanguageSupport(target?: DocumentSupportTarget, page: AnalysisPage = 'details', item?: string): void {
  if (!target) { openLanguageCatalog(); return; }
  const event = new CustomEvent('setdown:document-language-support', { cancelable: true, detail: { target: { id: target.id, resource: target.resource }, page, item } });
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
