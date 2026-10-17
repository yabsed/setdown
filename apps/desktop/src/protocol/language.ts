import type { LanguageRefresh } from './language-features';
import type { Diagnostic, DiagnosticOptions, ServerCapabilities, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';
import type { LanguageRoute } from '../core/document/language-support';
import type { LanguageServerDefinition } from '../core/document/language-definition';

export type LanguageServerOptions = { role?: 'primary' | 'supplementary'; formatting?: boolean; scope?: string; args: string[]; settings: Record<string, unknown>; initializationOptions: Record<string, unknown>; root?: string };
/** Local bridge metadata, never sent as an LSP ServerCapabilities object. */
export type LanguageCapabilities = ServerCapabilities & { diagnosticProviders?: { id: string; options: DiagnosticOptions }[] };
export type LanguageConnectionDraft = LanguageServerOptions & { id: string; name: string;
  languages: LanguageServerDefinition['languages']; rootMarkers: string[]; candidateId?: string };
export type LanguageServerCandidate = { id: string; path: string; source: 'explicit' | 'path' | 'user' | 'python' | 'npm' };
export type LanguageCatalogEntry = {
  id: string; name: string; description: string; homepage: string; languages: string[];
  notebook?: boolean; role?: 'primary' | 'supplementary'; projectRoot?: string; globalOptions?: LanguageServerOptions;
  configured: boolean; bundled: boolean; custom: boolean; enabled: boolean; selected: string[];
  /** A user-owned connection or override, retained in management even when missing. */
  managed?: boolean;
  /** Executable metadata exists for automatic discovery, even without a connection profile. */
  discoverable?: boolean;
  executable?: string; available?: boolean; options?: LanguageServerOptions;
  automatic?: boolean; canDetect?: boolean; candidates?: LanguageServerCandidate[];
  discoveryMessage?: string; selectionNeeded?: boolean; searched?: string[];
  profileSource?: string; setupNote?: string;
  sessions: { root: string; rootReason?: string; context?: string[]; state: 'starting' | 'ready' | 'failed'; message?: string; features?: string[]; logs?: string[]; progress?: string[] }[];
};
export type LanguageCatalog = { release: string; profileSource?: string; profiles?: number; entries: LanguageCatalogEntry[] };

export function textSynchronization(capabilities: ServerCapabilities): { change: number; openClose: boolean; save: false | { includeText?: boolean } } {
  const sync = capabilities.textDocumentSync;
  // The legacy numeric form includes didSave (without text) for Full/Incremental,
  // matching vscode-languageclient. fortls still uses this representation.
  return typeof sync === 'number' ? { change: sync, openClose: sync !== 0, save: sync === 0 ? false : { includeText: false } }
    : { change: sync?.change ?? 0, openClose: sync?.openClose ?? false,
      save: typeof sync?.save === 'object' ? sync.save : sync?.save === true ? {} : false };
}

/** Only listed LSP methods cross this port. Notebook Python paths are explicitly selected environments, never server commands. */
export const languageMethods = [
  'textDocument/completion', 'completionItem/resolve', 'textDocument/hover',
  'textDocument/signatureHelp', 'textDocument/definition', 'textDocument/references',
  'textDocument/documentSymbol', 'textDocument/rename', 'textDocument/prepareRename',
  'textDocument/declaration', 'textDocument/typeDefinition', 'textDocument/implementation',
  'textDocument/documentHighlight', 'textDocument/selectionRange', 'textDocument/foldingRange',
  'textDocument/documentLink', 'documentLink/resolve', 'textDocument/documentColor', 'textDocument/colorPresentation',
  'textDocument/semanticTokens/full', 'textDocument/semanticTokens/full/delta', 'textDocument/semanticTokens/range',
  'textDocument/inlayHint', 'inlayHint/resolve', 'textDocument/linkedEditingRange',
  'textDocument/codeAction', 'codeAction/resolve', 'textDocument/codeLens', 'codeLens/resolve',
  'textDocument/formatting', 'textDocument/rangeFormatting', 'textDocument/onTypeFormatting',
  'textDocument/willSaveWaitUntil', 'textDocument/diagnostic', 'workspace/symbol', 'workspaceSymbol/resolve', 'workspace/executeCommand',
  'textDocument/prepareCallHierarchy', 'callHierarchy/incomingCalls', 'callHierarchy/outgoingCalls',
  'textDocument/prepareTypeHierarchy', 'typeHierarchy/supertypes', 'typeHierarchy/subtypes',
] as const;
export type LanguageMethod = typeof languageMethods[number];
export type LanguageCell = { id: string; version: number; text: string };
export type LanguageDocument = { server?: string; languageId?: string; notebook?: 'python'; cells?: LanguageCell[]; python?: string; id: string; generation: string; path: string; text: string; version: number };
export type LanguageConnection = { name?: string; context?: string[]; uri: string; cells?: Record<string, string>; capabilities: LanguageCapabilities; server?: string };
export type LanguageUnavailable = { unavailable: 'missing' | 'selection-needed' };
export type LanguageEvent =
  | { type: 'configuration'; servers?: string[] }
  | { type: 'discovery' }
  | { type: 'diagnostics'; server?: string; id: string; generation: string; version: number; cell?: string; cellVersion?: number; unversioned?: boolean; diagnostics: Diagnostic[] }
  | { type: 'refresh'; documents: { id: string; generation: string }[]; feature: LanguageRefresh }
  | { type: 'capabilities'; id: string; generation: string; capabilities: LanguageCapabilities }
  | { type: 'context'; id: string; generation: string; context: string[] }
  | { type: 'activity' }
  | { type: 'apply-edit'; id: string; generation: string; requestId: string; versions?: { id: string; generation: string; version: number }[]; edit: import('vscode-languageserver-protocol').WorkspaceEdit }
  | { type: 'status'; documents: { id: string; generation: string }[]; state: 'starting' | 'ready' | 'failed'; message?: string };
export type LanguageApi = {
  open(document: LanguageDocument): Promise<LanguageConnection | LanguageUnavailable>;
  change(id: string, version: number, changes: TextDocumentContentChangeEvent[]): Promise<void>;
  changeNotebook(id: string, version: number, cells: LanguageCell[]): Promise<Record<string, string>>;
  close(id: string): void;
  saved(id: string, text?: string): void;
  request(id: string, version: number, requestId: string, method: LanguageMethod, params: unknown): Promise<unknown>;
  releaseItems?(id: string, handles: string[]): void;
  cancel(requestId: string): void;
  editApplied(requestId: string, applied: boolean, failureReason?: string): void;
  restart(): Promise<void>;
  configuration(): Promise<LanguageRoute[]>;
  catalog(): Promise<LanguageCatalog>;
  rescan(): Promise<void>;
  useAutomatic(id: string): Promise<void>;
  selectCandidate(id: string, candidateId: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  chooseExecutable(id: string): Promise<boolean>;
  configure(id: string, options: LanguageServerOptions): Promise<void>;
  addConnection(draft: LanguageConnectionDraft): Promise<boolean>;
  importDefinition(): Promise<boolean>;
  remove(id: string): Promise<void>;
  openHomepage(id: string): Promise<void>;
  onEvent(listener: (event: LanguageEvent) => void): () => void;
};
