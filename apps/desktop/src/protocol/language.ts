import type { Diagnostic, ServerCapabilities, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';

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
  | { type: 'diagnostics'; id: string; generation: string; version: number; diagnostics: Diagnostic[] }
  | { type: 'status'; documents: { id: string; generation: string }[]; state: 'starting' | 'ready' | 'failed'; message?: string };
export type LanguageApi = {
  open(document: LanguageDocument): Promise<LanguageConnection>;
  change(id: string, version: number, changes: TextDocumentContentChangeEvent[]): Promise<void>;
  close(id: string): void;
  saved(id: string): void;
  request(id: string, version: number, requestId: string, method: LanguageMethod, params: unknown): Promise<unknown>;
  cancel(requestId: string): void;
  restart(): Promise<void>;
  onEvent(listener: (event: LanguageEvent) => void): () => void;
};
