import type { AnalysisObservation, AnalysisSelection, DocumentAnalysis } from '../core/document/analysis-context';
import type { LanguageRefresh } from './language-features';
import type { Diagnostic, DiagnosticOptions, ServerCapabilities, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';
import type { LanguageRoute } from '../core/document/language-support';
import { toolMethods, type ToolFamily, type ToolMethod } from './language-tools';

export type LanguageServerOptions = { automaticInstall?: boolean; role?: 'primary' | 'supplementary'; formatting?: boolean; scope?: string; args: string[]; settings: Record<string, unknown>; initializationOptions: Record<string, unknown>; root?: string };
/** Local bridge metadata, never sent as an LSP ServerCapabilities object. */
export type LanguageCapabilities = ServerCapabilities & { diagnosticProviders?: { id: string; options: DiagnosticOptions }[] };
export type LanguageServerCandidate = { id: string; path: string; source: 'explicit' | 'path' | 'user' | 'python' | 'npm' };
export type LanguageCatalogEntry = {
  id: string; name: string; description: string; homepage: string; languages: string[];
  notebook?: boolean; role?: 'primary' | 'supplementary'; projectRoot?: string; globalOptions?: LanguageServerOptions;
  configured: boolean; bundled: boolean; custom: boolean; enabled: boolean; selected: string[];
  /** A user-owned connection or override, retained in management even when missing. */
  managed?: boolean;
  /** `available`: the program was found when this tool's own page asked. `chosen`: a person named its path. */
  executable?: string; available?: boolean; chosen?: boolean; options?: LanguageServerOptions;
  automatic?: boolean; canDetect?: boolean;
  profileSource?: string; setupNote?: string;
  /** `asks`: outside the supported languages, so it is downloaded only after the person says so. */
  preparation?: { state: 'available' | 'preparing' | 'ready' | 'failed'; source?: 'managed' | 'external'; message?: string; executable?: string; downloadsAllowed?: boolean; asks?: boolean };
  sessions: { root: string; rootReason?: string; context?: string[]; state: 'starting' | 'ready' | 'failed'; message?: string; issue?: LanguageIssue; features?: string[]; logs?: string[]; progress?: string[] }[];
};
export type LanguageDefault = { id: string; name: string; selection: import('../core/document/analysis-context').AnalysisPolicy; servers: string[]; defaultServer?: string };
export type LanguageCatalog = { release: string; profileSource?: string; profiles?: number; entries: LanguageCatalogEntry[]; automaticInstall?: boolean; languages?: LanguageDefault[] };

export function textSynchronization(capabilities: ServerCapabilities): { change: number; openClose: boolean; save: false | { includeText?: boolean } } {
  const sync = capabilities.textDocumentSync;
  // The legacy numeric form includes didSave (without text) for Full/Incremental,
  // matching vscode-languageclient. fortls still uses this representation.
  return typeof sync === 'number' ? { change: sync, openClose: sync !== 0, save: sync === 0 ? false : { includeText: false } }
    : { change: sync?.change ?? 0, openClose: sync?.openClose ?? false,
      save: typeof sync?.save === 'object' ? sync.save : sync?.save === true ? {} : false };
}

/** The requests of the protocol itself. */
const protocolMethods = [
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
/** Only listed methods cross this port: the protocol's, and what one tool's own editor extension
 * asks it (`language-tools.ts`), each sent only to the tool it belongs to. Notebook Python paths
 * are explicitly selected environments, never server commands. */
export const languageMethods: readonly LanguageMethod[] = [...protocolMethods, ...toolMethods];
export type LanguageMethod = typeof protocolMethods[number] | ToolMethod;
export type LanguageCell = { id: string; version: number; text: string };
export type LanguageDocument = { server?: string; languageId?: string; notebook?: 'python'; cells?: LanguageCell[]; python?: string; id: string; generation: string; path: string; text: string; version: number };
/** What a tool tells the person: a question with its answers, or a notice (`severity`, no actions) that stays until dismissed. */
export type LanguageServerMessage = { id: string; message: string; actions: string[]; severity?: 'error' | 'warning' | 'info' };
export type LanguageRecovery = { retrying: boolean; attempt?: number };
/** Why a tool is not working, as a fact the main process observed. The renderer
 * turns one issue into one sentence and one action; `help` means a page can be opened. */
export type LanguageIssue =
  | { kind: 'download-failed'; detail?: string }
  /** `optional`: downloads are on, but this tool is outside the supported languages and waits to be asked for. */
  | { kind: 'downloads-off'; optional?: boolean }
  | { kind: 'no-installer'; help?: boolean }
  | { kind: 'executable'; path: string; missing?: boolean; automatic?: boolean }
  | { kind: 'runtime'; runtime: string; required: string; found?: string }
  | { kind: 'startup'; detail?: string }
  | { kind: 'crashed' };
/** Text a markup tool writes after a keystroke: a closing tag after `>` or `/`, and with
 * `html/autoInsert` the quotes of an attribute after `=`. The main process names the request
 * of the document's tool and whether the person left each kind on. */
export type LanguageAutoInsert = { method: 'html/autoInsert' | 'html/tag'; close: boolean; quote: boolean };
export type LanguageConnection = { autoInsert?: LanguageAutoInsert; /** The tool answers `textDocument/switchSourceHeader` (clangd). */ companion?: boolean;
  /** The extension whose commands and requests this tool is offered with. */ tool?: ToolFamily; messages?: LanguageServerMessage[]; analysis?: AnalysisObservation; name?: string; context?: string[]; uri: string; cells?: Record<string, string>; capabilities: LanguageCapabilities; server?: string };
export type LanguageUnavailable = { unavailable: 'missing'; message?: string; issue?: LanguageIssue; server?: { id: string; name: string } };
export type LanguageEvent =
  | { type: 'configuration'; roots?: string[]; servers?: string[]; documents?: { id: string; generation: string }[]; retainedDocuments?: { id: string; generation: string }[] }
  | { type: 'discovery' }
  | { type: 'environment'; root: string; language: string }
  | { type: 'diagnostics'; server?: string; id: string; generation: string; version: number; cell?: string; cellVersion?: number; unversioned?: boolean; diagnostics: Diagnostic[] }
  | { type: 'refresh'; documents: { id: string; generation: string }[]; feature: LanguageRefresh }
  | { type: 'capabilities'; id: string; generation: string; capabilities: LanguageCapabilities }
  | { type: 'context'; messages?: LanguageServerMessage[]; analysis?: AnalysisObservation; id: string; generation: string; context: string[] }
  | { type: 'activity' }
  | { type: 'apply-edit'; id: string; generation: string; requestId: string; versions?: { id: string; generation: string; version: number }[]; edit: import('vscode-languageserver-protocol').WorkspaceEdit }
  | { type: 'status'; documents: { id: string; generation: string }[]; state: 'starting' | 'ready' | 'failed'; message?: string; recovery?: LanguageRecovery; issue?: LanguageIssue; preparing?: boolean; server?: { id: string; name: string } };
/** Text a tool made for reading. It becomes a read-only document beside the code (`language-answers.ts`).
 * `image`: an SVG the tool drew. */
export type LanguageAnswer = { title: string; text: string; languageId?: string; image?: boolean };
/** The folder of the app that holds such documents; its name is the mark the editor knows them by. */
export const languageAnswerFolder = 'setdown-language-answers';
export const isLanguageAnswer = (file: string): boolean => file.replaceAll('\\', '/').includes(`/${languageAnswerFolder}/`);
export type LanguageApi = {
  open(document: LanguageDocument): Promise<LanguageConnection | LanguageUnavailable>;
  highlight?(file: string, languageId: string, text: string): Promise<Array<[number, number, string]>>;
  definitions?(file?: string): Promise<import('../core/document/language-catalog').LanguageDefinition[]>;
  change(id: string, version: number, changes: TextDocumentContentChangeEvent[]): Promise<void>;
  changeNotebook(id: string, version: number, cells: LanguageCell[]): Promise<Record<string, string>>;
  close(id: string): void;
  saved(id: string, text?: string): void;
  request(id: string, version: number, requestId: string, method: LanguageMethod, params: unknown): Promise<unknown>;
  releaseItems?(id: string, handles: string[]): void;
  cancel(requestId: string): void;
  editApplied(requestId: string, applied: boolean, failureReason?: string): void;
  restart(file?: string, server?: string): Promise<void>;
  /** Keeps a tool's answer as a document and gives its path. `file` is the document that asked. */
  answer?(file: string, answer: LanguageAnswer): Promise<string>;
  answerMessage(file: string, server: string, request: string, action?: number): Promise<void>;
  environment(file: string, language: string): Promise<DocumentAnalysis>;
  selectEnvironment(file: string, language: string, selection: AnalysisSelection): Promise<DocumentAnalysis>;
  prepareEnvironment(file: string, language: string): Promise<{ output: string }>;
  cancelPreparation(file: string, language: string): Promise<void>;
  configuration(): Promise<LanguageRoute[]>;
  /** `inspect` names the one tool whose program is looked up on this computer. */
  catalog(file?: string, inspect?: string): Promise<LanguageCatalog>;
  rescan(): Promise<void>;
  useAutomatic(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  setAutomaticInstall(enabled: boolean): Promise<void>;
  setLanguageDefault(language: string, value: string): Promise<void>;
  chooseExecutable(id: string): Promise<boolean>;
  configure(id: string, options: LanguageServerOptions): Promise<void>;
  importDefinition(): Promise<boolean>;
  remove(id: string): Promise<void>;
  /** `runtime` opens the installation page of the runtime the tool needs instead of the tool's own page. */
  openHomepage(id: string, runtime?: string): Promise<void>;
  /** Lets this one tool be downloaded while the app default stays as it is. */
  allowDownload(id: string): Promise<void>;
  onEvent(listener: (event: LanguageEvent) => void): () => void;
};
