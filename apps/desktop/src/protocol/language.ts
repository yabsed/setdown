import type { Diagnostic, ServerCapabilities, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';
import type { LanguageRoute } from '../core/document/language-support';
import type { LanguageServerDefinition } from '../core/document/language-definition';

export type LanguageServerOptions = { args: string[]; settings: Record<string, unknown>; initializationOptions: Record<string, unknown> };
export type LanguageConnectionDraft = LanguageServerOptions & { id: string; name: string;
  languages: LanguageServerDefinition['languages']; rootMarkers: string[]; candidateId?: string };
export type LanguageServerCandidate = { id: string; path: string; source: 'explicit' | 'path' | 'user' | 'python' | 'npm' };
export type LanguageCatalogEntry = {
  id: string; name: string; description: string; homepage: string; languages: string[];
  configured: boolean; bundled: boolean; custom: boolean; enabled: boolean; selected: string[];
  /** A user-owned connection or override, retained in management even when missing. */
  managed?: boolean;
  /** Executable metadata exists for automatic discovery, even without a connection profile. */
  discoverable?: boolean;
  executable?: string; available?: boolean; options?: LanguageServerOptions;
  automatic?: boolean; canDetect?: boolean; candidates?: LanguageServerCandidate[];
  discoveryMessage?: string; selectionNeeded?: boolean; searched?: string[];
  profileSource?: string; setupNote?: string;
  sessions: { root: string; state: 'starting' | 'ready' | 'failed'; message?: string; features?: string[] }[];
};
export type LanguageCatalog = { release: string; profileSource?: string; profiles?: number; entries: LanguageCatalogEntry[] };

export function textSynchronization(capabilities: ServerCapabilities): { change: number; openClose: boolean; save: false | { includeText?: boolean } } {
  const sync = capabilities.textDocumentSync;
  return typeof sync === 'number' ? { change: sync, openClose: sync !== 0, save: false as false | { includeText?: boolean } }
    : { change: sync?.change ?? 0, openClose: sync?.openClose ?? false,
      save: typeof sync?.save === 'object' ? sync.save : sync?.save === true ? {} : false };
}

/** No executable paths, shell commands or arbitrary LSP methods cross this port. */
export const languageMethods = [
  'textDocument/completion', 'completionItem/resolve', 'textDocument/hover',
  'textDocument/signatureHelp', 'textDocument/definition', 'textDocument/references',
  'textDocument/documentSymbol', 'textDocument/rename', 'textDocument/prepareRename',
] as const;
export type LanguageMethod = typeof languageMethods[number];
export type LanguageDocument = { id: string; generation: string; path: string; text: string; version: number };
export type LanguageConnection = { uri: string; capabilities: ServerCapabilities; server?: string };
export type LanguageUnavailable = { unavailable: 'missing' | 'selection-needed' };
export type LanguageEvent =
  | { type: 'configuration'; servers?: string[] }
  | { type: 'discovery' }
  | { type: 'diagnostics'; id: string; generation: string; version: number; diagnostics: Diagnostic[] }
  | { type: 'status'; documents: { id: string; generation: string }[]; state: 'starting' | 'ready' | 'failed'; message?: string };
export type LanguageApi = {
  open(document: LanguageDocument): Promise<LanguageConnection | LanguageUnavailable>;
  change(id: string, version: number, changes: TextDocumentContentChangeEvent[]): Promise<void>;
  close(id: string): void;
  saved(id: string, text?: string): void;
  request(id: string, version: number, requestId: string, method: LanguageMethod, params: unknown): Promise<unknown>;
  cancel(requestId: string): void;
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
