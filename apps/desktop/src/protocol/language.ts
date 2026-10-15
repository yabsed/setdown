import type { Diagnostic, ServerCapabilities, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';
import type { LanguageRoute } from '../core/document/language-support';
import type { LanguageServerDefinition } from '../core/document/language-definition';

export type LanguageServerOptions = { args: string[]; settings: Record<string, unknown>; initializationOptions: Record<string, unknown> };
export type LanguageConnectionDraft = LanguageServerOptions & { id: string; name: string;
  languages: LanguageServerDefinition['languages']; rootMarkers: string[] };
export type LanguageCatalogEntry = {
  id: string; name: string; description: string; homepage: string; languages: string[];
  configured: boolean; bundled: boolean; custom: boolean; enabled: boolean; selected: string[];
  executable?: string; available?: boolean; options?: LanguageServerOptions;
  sessions: { root: string; state: 'starting' | 'ready' | 'failed'; message?: string; features?: string[] }[];
};
export type LanguageCatalog = { release: string; entries: LanguageCatalogEntry[] };

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
export type LanguageConnection = { uri: string; capabilities: ServerCapabilities };
export type LanguageEvent =
  | { type: 'configuration' }
  | { type: 'diagnostics'; id: string; generation: string; version: number; diagnostics: Diagnostic[] }
  | { type: 'status'; documents: { id: string; generation: string }[]; state: 'starting' | 'ready' | 'failed'; message?: string };
export type LanguageApi = {
  open(document: LanguageDocument): Promise<LanguageConnection>;
  change(id: string, version: number, changes: TextDocumentContentChangeEvent[]): Promise<void>;
  close(id: string): void;
  saved(id: string, text?: string): void;
  request(id: string, version: number, requestId: string, method: LanguageMethod, params: unknown): Promise<unknown>;
  cancel(requestId: string): void;
  restart(): Promise<void>;
  configuration(): Promise<LanguageRoute[]>;
  catalog(): Promise<LanguageCatalog>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  chooseExecutable(id: string): Promise<boolean>;
  configure(id: string, options: LanguageServerOptions): Promise<void>;
  addConnection(draft: LanguageConnectionDraft): Promise<boolean>;
  importDefinition(): Promise<boolean>;
  remove(id: string): Promise<void>;
  openHomepage(id: string): Promise<void>;
  onEvent(listener: (event: LanguageEvent) => void): () => void;
};
