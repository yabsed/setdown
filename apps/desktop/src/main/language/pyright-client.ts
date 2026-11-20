import { fileURLToPath } from 'node:url';
import type { Position, TextEdit } from 'vscode-languageserver-protocol';
import { setting } from './extension-rules';

// What Pyright's own VS Code client does besides starting the server and cancelling through
// files (`python-cancellation.ts`). The rules in this file are carried over from:
//   vendor/pyright/packages/vscode-pyright/src/extension.ts                    heap size, initialization options, the three commands
//   vendor/pyright/packages/vscode-pyright/package.json                        the defaults of the settings it reads
//   vendor/pyright/packages/pyright-internal/src/commands/commands.ts          the command names
//   vendor/pyright/packages/pyright-internal/src/commands/quickActionCommand.ts  what `pyright.organizeimports` answers
//   vendor/pyright/packages/pyright-internal/src/commands/createTypeStub.ts    the arguments of `pyright.createtypestub`
//   vendor/pyright/packages/pyright-internal/src/languageServerBase.ts         `onExecuteCommand`: the server applies an edit itself
//   vendor/basedpyright/packages/…                                             the same client under other names
//
// The client starts `dist/server.js` over Node IPC (`TransportKind.ipc`). Setdown starts the
// package's `langserver.index.js --stdio` with Electron as Node. The two entry points differ in one
// number: `vscode-pyright/src/server.ts` calls `main(1)` and `pyright/src/langserver.ts` calls
// `main(0)`. That number only sizes the buffer through which the threads tell each other how
// much memory they hold (`analyzer/cacheManager.ts`). Whether there is a background analysis thread
// at all is decided by the cancellation argument (`python-cancellation.ts`).

type Settings = Record<string, unknown>;
const record = (value: unknown): Settings | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Settings : undefined;

export type PyrightTool = 'pyright' | 'basedpyright';

/** extension.ts `defaultHeapSize`: "Request a heap size of 3GB." */
export const pyrightHeapSize = 3072;
/** extension.ts `runOptions.execArgv`. Arguments for Node, so they stand before the server's script:
 * Electron started as Node reads them there, as `node` does. After the script they would be the
 * server's own arguments and do nothing. */
export const pyrightNodeArguments: readonly string[] = [`--max-old-space-size=${pyrightHeapSize}`];

/** `commands.ts`, `Commands`. basedpyright renamed them, and its server knows one more. */
export const pyrightCommands = {
  pyright: { organizeImports: 'pyright.organizeimports', createTypeStub: 'pyright.createtypestub', restartServer: 'pyright.restartserver' },
  basedpyright: { organizeImports: 'basedpyright.organizeimports', createTypeStub: 'basedpyright.createtypestub', restartServer: 'basedpyright.restartserver',
    writeBaseline: 'basedpyright.writeBaseline' },
} as const;

/** extension.ts `clientOptions.initializationOptions`: two settings as they are when the server
 * starts, with the defaults of the extension's `package.json` where the person wrote nothing.
 * basedpyright reads `basedpyright.analysis.diagnosticMode` and `basedpyright.disablePullDiagnostics`.
 *
 * Pyright's server declares both (`types.ts` `InitializationOptions`) and reads
 * `disablePullDiagnostics` (`languageServerBase.ts` `initialize`). `diagnosticMode` it takes from
 * the `python.analysis` settings it asks for (`pyrightServer.ts` `getSettings`). */
export function pyrightInitializationOptions(settings: Settings | undefined, tool: PyrightTool = 'pyright'): { diagnosticMode: string; disablePullDiagnostics: boolean } {
  const mode = setting(settings, `${tool === 'pyright' ? 'python' : 'basedpyright'}.analysis.diagnosticMode`);
  const pull = setting(settings, `${tool}.disablePullDiagnostics`);
  return { diagnosticMode: typeof mode === 'string' && mode ? mode.slice(0, 64) : 'openFilesOnly', disablePullDiagnostics: typeof pull === 'boolean' ? pull : false };
}

/** What `workspace/executeCommand` is sent for "Organize Imports" (extension.ts,
 * `registerTextEditorCommand`): the document's address is the first argument. The server works on
 * a document only while it is open (`quickActions.ts` `performQuickAction`). */
export function organizeImportsCommand(uri: string, tool: PyrightTool = 'pyright'): { command: string; arguments: unknown[] } {
  return { command: pyrightCommands[tool].organizeImports, arguments: [uri] };
}
/** "Restart Server" (extension.ts, `genericCommands`): no arguments. The process stays. Every
 * project in it gets a new import resolver, which forgets what the old one remembered of the
 * interpreter and of the files it found, and its background analysis starts again (`service.ts` `restart`). */
export function restartServerCommand(tool: PyrightTool = 'pyright'): { command: string; arguments: unknown[] } {
  return { command: pyrightCommands[tool].restartServer, arguments: [] };
}
/** "Create Type Stub" comes from the server as the command of a code action, with these
 * arguments (`codeActionProvider.ts`); the client passes them back as they are (extension.ts,
 * `genericCommands`). The server reads them in `createTypeStub.ts` `execute`. */
export function createTypeStubCommand(workspaceRoot: string, importName: string, callingFile?: string, tool: PyrightTool = 'pyright'): { command: string; arguments: unknown[] } {
  return { command: pyrightCommands[tool].createTypeStub, arguments: callingFile ? [workspaceRoot, importName, callingFile] : [workspaceRoot, importName] };
}

const position = (value: unknown): Position | undefined => {
  const at = record(value);
  return at && Number.isSafeInteger(at.line) && Number.isSafeInteger(at.character) && (at.line as number) >= 0 && (at.character as number) >= 0
    ? { line: at.line as number, character: at.character as number } : undefined;
};
const textEdit = (value: unknown): TextEdit | undefined => {
  const edit = record(value), range = record(edit?.range), start = position(range?.start), end = position(range?.end);
  return start && end && typeof edit!.newText === 'string' ? { range: { start, end }, newText: edit!.newText } : undefined;
};
/** Two addresses of one document. The server writes the address its own way, which need not be the spelling it was sent. */
function sameDocument(a: string, b: string): boolean {
  if (a === b) return true;
  try { return fileURLToPath(a) === fileURLToPath(b); } catch { return false; }
}
const mostEdits = 10_000;

/** The edits of `uri` in what the server answered to `organizeImportsCommand`.
 *
 * The client reads the answer as `TextEdit[]` and replaces each range in the editor
 * (extension.ts, `client.sendRequest<TextEdit[] | undefined>('workspace/executeCommand', cmd)`).
 * The server of this version answers a `WorkspaceEdit` whose `changes` name the one document
 * (`quickActionCommand.ts`: `convertToWorkspaceEdit(…, convertToFileTextEdits(docUri, …))`). Both are read.
 *
 * All the edits or none: an answer with an edit that cannot be read, or with more than 10,000,
 * gives none, because half of a reordering would lose imports.
 *
 * A server that answers a `WorkspaceEdit` with changes has also asked the editor to apply it,
 * with `workspace/applyEdit` (`languageServerBase.ts` `onExecuteCommand`). The edits are applied
 * once: from that request, or from this function when the request was refused. */
export function organizeImportsEdits(answer: unknown, uri: string): TextEdit[] {
  const lists: unknown[][] = [];
  if (Array.isArray(answer)) lists.push(answer);
  else for (const [document, edits] of Object.entries(record(record(answer)?.changes) ?? {})) if (sameDocument(document, uri) && Array.isArray(edits)) lists.push(edits);
  const result: TextEdit[] = [];
  for (const list of lists) for (const item of list) {
    const edit = textEdit(item);
    if (!edit || result.length >= mostEdits) return [];
    result.push(edit);
  }
  return result;
}
