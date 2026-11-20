import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LSPErrorCodes, type ClientCapabilities } from 'vscode-languageserver-protocol';
import { kotlinInitializationOptions, kotlinOptionSettings, kotlinProjectTypes } from './kotlin-options';
import type { ToolAction, ToolAnswer, ToolNotice, ToolRules, ToolSignal } from './tool-signals';

// The rules in this file are carried over from the VS Code Kotlin extension ("Kotlin by JetBrains")
// and from the server sources it is checked out with. Each one names the file it came from, so a
// newer `vendor/kotlin-lsp` can be compared against it:
//   vendor/kotlin-lsp/vscode-extension-core/src/lspClient.ts               import log, import status, settings changes, start limit, failed starts, index directory
//   vendor/kotlin-lsp/vscode-extension-core/src/statusBarModel.ts          what counts as blocked (`buildToolConflictState`), which status wins (`createLatestSnapshotTracker`)
//   vendor/kotlin-lsp/vscode-extension-core/src/statusBar.ts               the standing build error (`setBuildError`)
//   vendor/kotlin-lsp/vscode-extension-core/src/workspaceImport.ts         the phases of an import
//   vendor/kotlin-lsp/vscode-extension-core/src/extension.ts               `intellij/reloadWorkspace` (`reloadWorkspace`), `exportWorkspace`
//   vendor/kotlin-lsp/vscode-extension-core/src/launchedServerStartup.ts   exit code 7, the words of a failed start
//   vendor/kotlin-lsp/vscode-extension-core/src/intellijExtensions.ts      `intellij/chooseAction`, `intellij/showConflicts`
//   vendor/kotlin-lsp/vscode-extension-core/src/showConflictsModel.ts      `conflictMessage`
//   vendor/kotlin-lsp/vscode-extension-core/src/intellijExtensionsClientFeature.ts   the experimental capabilities
//   vendor/kotlin-lsp/vscode-extension-core/src/buildTaskModel.ts          `intellij.build`, `intellij/buildOutput`
//   vendor/kotlin-lsp/features-impl/common/src/com/jetbrains/ls/api/features/impl/common/modcommands/ModCommandData.kt
//                                                                          what the server sends, and what it does for an editor without a capability

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Text a tool sent, cut to what is shown. Nothing for a value that is not text, or is blank. */
const words = (value: unknown, limit = 4096): string | undefined => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined;
/** The lines of one message for the tool's log. */
const logLines = (message: unknown): string[] => typeof message === 'string' ? message.slice(0, 4096).split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean).slice(0, 80) : [];
/** The name of the file or folder a URI ends in, as intellijExtensions.ts `conflictLocationLabel` shows a file. */
function lastSegment(uri: string): string {
  let name = uri;
  try { name = decodeURIComponent(new URL(uri).pathname); } catch { /* Not a URI: shown as it was sent. */ }
  name = name.replace(/\/+$/, '');
  return name.slice(name.lastIndexOf('/') + 1).slice(0, 200);
}

/** The server's own notifications and requests, and the one request of the editor that re-imports.
 * `importStatus` and `importState` are each both a notification of the server and a request the
 * editor may send with `{}` (lspClient.ts `workspaceImportStatusRequest`, workspaceImport.ts). */
export const kotlinMethods = {
  importLog: 'intellij/importLog',
  importStatus: 'intellij/workspaceImportStatus',
  importState: 'intellij/workspaceImportState',
  buildOutput: 'intellij/buildOutput',
  chooseAction: 'intellij/chooseAction',
  showConflicts: 'intellij/showConflicts',
  reloadWorkspace: 'intellij/reloadWorkspace',
} as const;

/** intellijExtensionsClientFeature.ts `fillClientCapabilities` declares five experimental
 * capabilities. These are the ones whose editor half the rules below implement:
 * `conflictView` (the `intellij/showConflicts` request) and `actionChooser` (the
 * `intellij/chooseAction` notification). */
export const kotlinDeclaredCapabilities = ['conflictView', 'actionChooser'] as const;
/** The other three, which are not declared. `copyToClipboard` needs the clipboard,
 * `runEditorCommand` runs an editor command such as an inline rename, and `editOptions` needs a
 * form with fields. The server has a way without each of them (ModCommandData.kt `from`). */
export const kotlinUndeclaredCapabilities = ['copyToClipboard', 'runEditorCommand', 'editOptions'] as const;

/** The names under which the rules show things: one context line, one progress entry, and the notices. */
export const kotlinSignalKeys = {
  context: 'Project import',
  progress: 'kotlin.import',
  buildTool: 'kotlin.buildTool',
  buildError: 'kotlin.buildError',
  settings: 'kotlin.settings',
  settingsChange: 'kotlin.settingsChange',
  chooser: 'kotlin.choose',
} as const;

/** A notice in the document panel has at most this many buttons (`server-session.ts` `notice`),
 * so a menu of the server with more entries shows the first ones and says how many there are. */
export const kotlinChooserLimit = 6;
/** How many conflicts of one fix are listed in the question about them. */
export const kotlinConflictRows = 50;

/** lspClient.ts `registerWorkspaceImportStatusHandler` `refresh`: once the server has started
 * the extension asks for the import status, with an empty object and not without parameters. */
export const kotlinStatusQuery: { method: string; params: Record<string, never> } = { method: kotlinMethods.importStatus, params: {} };

/** Whether a button of a notice is the re-import. Its parameters are not in the action: they are
 * the initialization options as they are at the click (extension.ts `reloadWorkspace`: "Re-read
 * settings now"), which `kotlinReloadParams` makes. */
export const isKotlinReload = (action: ToolAction): boolean => 'request' in action && action.request.method === kotlinMethods.reloadWorkspace;

/** showConflictsModel.ts `conflictMessage`: the messages of one conflict as one line. Each is a
 * statement of its own, so it gets a period when it has no end mark; a line break inside a
 * message becomes a space. Empty when no message holds text. */
export function conflictMessage(messages: string[]): string {
  return messages
    .map(message => message.split('\n').map(line => line.trim()).filter(line => line !== '').join(' '))
    .filter(message => message !== '')
    .map(message => /[.!?;:]$/.test(message) ? message : `${message}.`)
    .join(' ');
}

type Phase = 'running' | 'finished' | 'cancelled' | 'failed';
/** workspaceImport.ts `WorkspaceImportPhase`. */
const phases: Record<string, Phase> = { IN_PROGRESS: 'running', FINISHED: 'finished', CANCELLED: 'cancelled', FAILED: 'failed' };
const phaseWords: Record<Phase, string> = { running: 'Importing', finished: 'Imported', cancelled: 'Cancelled', failed: 'Failed' };

type Blocked = { folderUri: string; reason: string; candidates: string[]; dismissed: boolean };
/** statusBarModel.ts `WorkspaceImportStatus`, read from what the server sent. */
function blockedFolders(status: unknown): Blocked[] | undefined {
  if (!isRecord(status) || !Array.isArray(status.blockedFolders)) return undefined;
  return status.blockedFolders.slice(0, 64).flatMap((folder): Blocked[] => !isRecord(folder) || typeof folder.reason !== 'string' ? [] : [{
    folderUri: typeof folder.folderUri === 'string' ? folder.folderUri : '', reason: folder.reason, dismissed: folder.dismissed === true,
    candidates: (Array.isArray(folder.candidates) ? folder.candidates : []).filter((candidate): candidate is string => typeof candidate === 'string' && !!candidate.trim()).slice(0, 16).map(candidate => candidate.slice(0, 80)),
  }]);
}

/** lspClient.ts `registerWorkspaceImportStatusHandler`: the warning after the person closed the
 * server's own question, and its one button, which imports again so that the server asks again.
 * The buttons after it are Setdown's: a build tool that every blocked folder has, written as
 * `intellij.buildTool` (kotlin-vscode/README.md: "e.g., `maven` or `gradle`"). */
function buildToolNotice(conflicts: Blocked[]): ToolNotice {
  const found = conflicts.filter(folder => folder.candidates.length).slice(0, 8)
    .map(folder => `${folder.folderUri ? `Found in ${lastSegment(folder.folderUri)}` : 'Found'}: ${folder.candidates.join(', ')}`);
  const shared = conflicts[0].candidates.filter((candidate, index, all) => all.indexOf(candidate) === index
    && kotlinProjectTypes.includes(candidate) && candidate !== 'subproject' && conflicts.every(folder => folder.candidates.includes(candidate)));
  return { severity: 'warning', message: ['Choose a build tool to start project import.', ...found].join('\n'), actions: [
    { title: 'Choose Build Tool…', request: { method: kotlinMethods.reloadWorkspace } },
    ...shared.slice(0, kotlinChooserLimit - 1).map((candidate): ToolAction => ({ title: `Use ${candidate}`, setting: { name: kotlinOptionSettings.buildTool, value: candidate } })),
  ] };
}

/** intellijExtensions.ts `conflictRows`: where a conflict is and all of its message, on one line. */
function conflictRow(conflict: unknown): string {
  const messages = isRecord(conflict) && Array.isArray(conflict.messages) ? conflict.messages.filter((message): message is string => typeof message === 'string').slice(0, 16) : [];
  const message = conflictMessage(messages) || '-';
  const location = isRecord(conflict) && isRecord(conflict.location) ? conflict.location : undefined;
  const uri = location?.uri, range = location && isRecord(location.range) ? location.range : undefined;
  const line = range && isRecord(range.start) ? range.start.line : undefined;
  const place = typeof uri === 'string' && typeof line === 'number' && Number.isSafeInteger(line) && line >= 0 ? `${lastSegment(uri)}:${line + 1}` : undefined;
  return (place ? `${place}: ${message}` : message).slice(0, 600);
}

/** The rules of one running kotlin-lsp, with the one thing `ToolRules` has no place for: the
 * request the extension sends after the start, and what its answer means. */
export type KotlinRules = ToolRules & {
  /** Sent once the server has answered `initialize`; each answer goes to `answered`. */
  queries: { method: string; params: Record<string, never> }[];
  /** What the answer to one of `queries` shows. Nothing when the server has said it itself meanwhile. */
  answered(method: string, result: unknown): ToolSignal | undefined;
};

/** What the extension shows of the server's own messages, for one session of kotlin-lsp. */
export function kotlinRules(context: { name: string; root: string; settings: Record<string, unknown> }): KotlinRules {
  let phase: Phase | undefined;
  let blocked = false;
  /** The build tool of the last failed import, until an import succeeds (statusBar.ts `setBuildError`). */
  let buildError: string | undefined;
  let statusSeen = false;
  let choosers = 0;
  // statusBarModel.ts: a blocked import is the status ("Build tool required"); statusBar.ts
  // `setBuildError`: a failed one stays as "<tool>: Build Error" beside it.
  const shown = (): ToolSignal['context'] =>
    ({ [kotlinSignalKeys.context]: blocked ? 'Build tool required' : buildError ? `${buildError}: Build Error` : phase && phaseWords[phase] });

  /** statusBarModel.ts `buildToolConflictState`: only a folder in which several build tools were
   * found blocks the import, and the warning comes when the person closed the server's question. */
  const importStatus = (status: unknown): ToolSignal | undefined => {
    const folders = blockedFolders(status);
    if (!folders) return undefined;
    const conflicts = folders.filter(folder => folder.reason === 'ambiguousBuildSystem');
    blocked = conflicts.length > 0;
    return { context: shown(), notices: { [kotlinSignalKeys.buildTool]: conflicts.some(folder => folder.dismissed) ? buildToolNotice(conflicts) : undefined } };
  };

  /** lspClient.ts `registerImportLogHandler`: every message is a line of the build output; a
   * failed import leaves "<tool>: Build Error" until one succeeds. The extension does not read
   * `started`; here it is the import being in progress. */
  const importLog = (params: unknown): ToolSignal | undefined => {
    if (!isRecord(params)) return undefined;
    const log = logLines(params.message), tool = words(params.tool, 80);
    const signal: ToolSignal = log.length ? { log } : {};
    if (params.started === true) { phase = 'running'; signal.progress = { [kotlinSignalKeys.progress]: tool ? `Importing the ${tool} project` : 'Importing the project' }; }
    if (params.failed === true) {
      phase = 'failed'; buildError = tool ?? 'Build';
      const reason = words(params.message, 1000);
      signal.progress = { [kotlinSignalKeys.progress]: undefined };
      signal.notices = { [kotlinSignalKeys.buildError]: { severity: 'warning', message: [`${buildError}: Build Error`, ...(reason ? [reason] : []), 'The build output is in the log of this tool.'].join('\n') } };
    } else if (params.succeeded === true) {
      phase = 'finished'; buildError = undefined;
      signal.progress = { [kotlinSignalKeys.progress]: undefined };
      signal.notices = { [kotlinSignalKeys.buildError]: undefined };
    }
    if (params.started === true || params.failed === true || params.succeeded === true) signal.context = shown();
    return Object.keys(signal).length ? signal : undefined;
  };

  /** workspaceImport.ts: sent once when an import cycle ends, so never with `IN_PROGRESS`; the
   * extension acts on `FINISHED` only (lspClient.ts `registerWorkspaceImportStateHandler`). */
  const importState = (params: unknown): ToolSignal | undefined => {
    const next = isRecord(params) && typeof params.phase === 'string' && Object.hasOwn(phases, params.phase) ? phases[params.phase] : undefined;
    if (!next) return undefined;
    phase = next;
    return { context: shown(), progress: { [kotlinSignalKeys.progress]: next === 'running' ? 'Importing the project' : undefined } };
  };

  /** buildTaskModel.ts `BuildOutput`: one line of the output of a build started with `intellij.build`. */
  const buildOutput = (params: unknown): ToolSignal | undefined => {
    const log = isRecord(params) ? logLines(params.line) : [];
    return log.length ? { log } : undefined;
  };

  /** intellijExtensions.ts `showChooseActionMenu`: a menu of the entries under the server's title.
   * The entry the person picks is run by sending its command back as `workspace/executeCommand`.
   * Each menu gets a key of its own, so that the same menu can be shown a second time. */
  const chooseAction = (params: unknown): ToolSignal | undefined => {
    if (!isRecord(params) || !Array.isArray(params.entries)) return undefined;
    const entries = params.entries.slice(0, 64).flatMap((entry): ToolAction[] => {
      const name = isRecord(entry) ? words(entry.name, 200) : undefined, command = isRecord(entry) && isRecord(entry.command) ? entry.command : undefined;
      if (!name || !command || typeof command.command !== 'string' || !command.command) return [];
      return [{ title: name, command: { command: command.command, ...(Array.isArray(command.arguments) ? { arguments: command.arguments } : {}) } }];
    });
    if (!entries.length) return undefined;
    const title = words(params.title, 1000) ?? 'Choose an action';
    const notices: Record<string, ToolNotice | undefined> = choosers ? { [`${kotlinSignalKeys.chooser}.${choosers}`]: undefined } : {};
    notices[`${kotlinSignalKeys.chooser}.${++choosers}`] = { severity: 'info', actions: entries.slice(0, kotlinChooserLimit),
      message: entries.length > kotlinChooserLimit ? `${title}\nShowing the first ${kotlinChooserLimit} of ${entries.length} choices.` : title };
    return { notices };
  };

  /** intellijExtensions.ts `showConflicts`: the server holds the edits of a fix and asks whether
   * to apply them although they break something. The answer is always a decision, and anything
   * but the person choosing to continue is `cancel`. */
  const showConflicts = (params: unknown): ToolAnswer => {
    if (!isRecord(params) || !Array.isArray(params.conflicts)) return { result: { decision: 'cancel' } };
    const rows = params.conflicts.slice(0, kotlinConflictRows).map(conflictRow), more = params.conflicts.length - rows.length;
    return {
      question: { message: [words(params.title, 1000) ?? 'Conflicts', ...rows, ...(more > 0 ? [`and ${more} more`] : [])].join('\n').slice(0, 4096),
        answers: [words(params.continueLabel, 200) ?? 'Continue', words(params.cancelLabel, 200) ?? 'Cancel'] },
      result: answer => ({ decision: answer === 0 ? 'continue' : 'cancel' }),
    };
  };

  return {
    capabilities: (general: ClientCapabilities): ClientCapabilities => ({ ...general,
      experimental: { ...(isRecord(general.experimental) ? general.experimental : {}), ...Object.fromEntries(kotlinDeclaredCapabilities.map(name => [name, true])) } }),
    // lspClient.ts `reportSettingsProblems`: a setting the server could not read is not sent, and the person is told which.
    started: () => {
      let folder = 'file:///';
      try { folder = pathToFileURL(context.root).href; } catch { /* The problems are the same without the folder's name. */ }
      const detail = kotlinInitializationOptions(context.settings, [folder]).problems.join('; ').slice(0, 3000);
      return detail ? { log: [`Ignoring invalid settings: ${detail}`], notices: { [kotlinSignalKeys.settings]: { severity: 'warning', message: `${context.name} ignored invalid settings: ${detail}.` } } } : undefined;
    },
    notifications: {
      [kotlinMethods.importLog]: importLog,
      [kotlinMethods.importState]: importState,
      [kotlinMethods.importStatus]: params => { statusSeen = true; return importStatus(params); },
      [kotlinMethods.buildOutput]: buildOutput,
      [kotlinMethods.chooseAction]: chooseAction,
    },
    requests: { [kotlinMethods.showConflicts]: showConflicts },
    queries: [kotlinStatusQuery],
    // statusBarModel.ts `createLatestSnapshotTracker`: the answer counts only when the server has not said it itself.
    answered: (method, result) => method === kotlinMethods.importStatus && !statusSeen ? importStatus(result) : undefined,
  };
}

/** lspClient.ts `INITIALIZATION_OPTION_SETTINGS`: the settings the server reads from the
 * initialization options, which `intellij/reloadWorkspace` sends again to the running server. */
export const kotlinReloadSettings = ['intellij.projects', 'intellij.buildTool', 'intellij.jdkForSymbolResolution', 'intellij.disableRocksDBWriteAheadLog', 'intellij.forkFromWorkspace'] as const;
/** lspClient.ts `LAUNCH_SETTINGS` and `SESSION_SETTINGS`: the settings only a new process
 * applies. The first five become arguments or environment of the process; the server reads
 * `intellij.completion` only for the session that `initialize` starts. */
export const kotlinRestartSettings = ['intellij.additionalJvmArgs', 'intellij.serverPath', 'intellij.dev.serverPort', 'http.proxy', 'http.proxySupport', 'intellij.completion'] as const;

/** Every value written at or under `name`, whether as one dotted key or as nested objects. */
function written(settings: unknown, name: string): string {
  const found = new Map<string, { depth: number; value: string }>();
  const walk = (value: unknown, at: string, depth: number): void => {
    if (isRecord(value) && depth < 8) { for (const [key, entry] of Object.entries(value)) walk(entry, at ? `${at}.${key}` : key, depth + 1); return; }
    if (value === undefined || value === null || isRecord(value) || (at !== name && !at.startsWith(`${name}.`))) return;
    // The dotted key is the one that is read first (kotlin-options.ts `configured`).
    const known = found.get(at);
    if (!known || depth < known.depth) found.set(at, { depth, value: JSON.stringify(value) });
  };
  walk(settings, '', 0);
  return JSON.stringify([...found].map(([at, { value }]) => [at, value]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

/** How a change of the settings reaches a running server: lspClient.ts
 * `registerSettingsChangeWatcher` and initializationSettings.ts `settingsChangeAction`.
 *
 * `restart` when a setting only a new process applies has another value. `reload` when the
 * initialization options made from the settings (`kotlinInitializationOptions`) come out
 * different: a change that leaves them as they were, such as removing an entry that was never
 * sent, is `none`. While the new settings hold a value the server could not read the extension
 * reports that and applies nothing, so that is `none` too. */
export function kotlinSettingsChange(previous: unknown, next: unknown): 'none' | 'reload' | 'restart' {
  const folder = ['file:///'], after = kotlinInitializationOptions(next, folder);
  if (after.problems.length) return 'none';
  if (kotlinRestartSettings.some(name => written(previous, name) !== written(next, name))) return 'restart';
  return JSON.stringify(kotlinInitializationOptions(previous, folder).options) === JSON.stringify(after.options) ? 'none' : 'reload';
}

/** lspClient.ts `registerSettingsChangeWatcher`: applying a change imports and indexes again, so
 * the extension offers it and does not do it by itself. `name` is the tool's name. */
export function kotlinSettingsChangeNotice(name: string, change: 'reload' | 'restart'): ToolNotice {
  const label = change === 'restart' ? 'Restart Language Server' : 'Reload Workspace';
  return { severity: 'warning', message: `${name}: settings changed. ${label} to apply the changes.`,
    actions: [change === 'restart' ? { title: label, restart: true } : { title: label, request: { method: kotlinMethods.reloadWorkspace } }] };
}

/** extension.ts `reloadWorkspace` and lspClient.ts `initializationOptionsPayload`: the parameters
 * of `intellij/reloadWorkspace` are the initialization options made anew from the settings as
 * they are now, the same ones `initialize` gets. `added` is what is sent beside the settings
 * (the extension's contributed options); a value made from the settings wins over it. The server
 * answers `null`. `problems` are the values that were left out (`kotlinInitializationOptions`). */
export function kotlinReloadParams(settings: unknown, folders: string[], added: Record<string, unknown> = {}): { params: { initializationOptions: Record<string, unknown> }; problems: string[] } {
  const { options, problems } = kotlinInitializationOptions(settings, folders);
  return { params: { initializationOptions: { ...added, ...options } }, problems };
}

/** extension.ts `reloadWorkspace`: what the person is told when the re-import failed. A request
 * the server cancelled says nothing: `ServerCancelled` is its quiet refusal without a licence. */
export function kotlinReloadFailure(error: unknown): string | undefined {
  const failure = typeof error === 'object' && error !== null ? error as { code?: unknown; message?: unknown } : undefined;
  if (failure?.code === LSPErrorCodes.RequestCancelled || failure?.code === LSPErrorCodes.ServerCancelled) return undefined;
  return `Failed to reload the workspace: ${(typeof failure?.message === 'string' ? failure.message : String(error)).slice(0, 4000)}`;
}

/** lspClient.ts `LAUNCHED_SERVER_START_TIMEOUT_MS`: a server that has not answered `initialize`
 * after this many milliseconds is stopped, and the start has failed. */
export const kotlinStartLimit = 60_000;
/** launchedServerStartup.ts `LICENSING_EXIT_CODE`: the server leaves with this code over a
 * licensing problem it cannot run with, an expired build or a feature its licence does not cover. */
export const kotlinLicenceExitCode = 7;

export type KotlinStartFailure = {
  kind: 'licence' | 'rejected' | 'timeout' | 'exited';
  message: string;
  /** False when the same start can only fail the same way. The extension starts none of the
   * four again by itself (launchedServerStartup.ts `shouldSuppressRestart`). */
  retry: boolean };

/** Why a start failed, in the order lspClient.ts `startLspClient` decides it: the exit code of a
 * licensing problem, then the server's own answer to `initialize` (its first line,
 * `logInitializationRejection`), then the time limit, then an exit before `initialize`
 * (launchedServerStartup.ts `startupError`). `exitCode` and `signal` are those of an exit the
 * server chose, not of one the editor caused by stopping it. */
export function kotlinStartFailure(name: string, failure: { exitCode?: number | null; signal?: string | null; timedOut?: boolean; rejection?: string }): KotlinStartFailure | undefined {
  if (failure.exitCode === kotlinLicenceExitCode) return { kind: 'licence', retry: false,
    message: `${name} could not start the language server over a licensing problem: this build may have expired, or the license does not cover it. Update ${name} or check the license, then try again.` };
  if (typeof failure.rejection === 'string') return { kind: 'rejected', retry: false, message: (failure.rejection.split('\n')[0].trim() || 'the initialize request was rejected').slice(0, 4096) };
  if (failure.timedOut) return { kind: 'timeout', retry: true, message: `Timed out waiting ${kotlinStartLimit / 1000} seconds for the language server to initialize` };
  if (typeof failure.exitCode === 'number' || typeof failure.signal === 'string')
    return { kind: 'exited', retry: true, message: `Language server process exited before initialization (code=${failure.exitCode ?? null}, signal=${failure.signal ?? null})` };
  return undefined;
}

/** The commands of the server a command list can offer, each sent as `workspace/executeCommand`:
 * `exportWorkspace` with one argument, the path of a folder (not a URI), writes `workspace.json`
 * into it and answers `null` (extension.ts `registerExportWorkspaceToJsonCommand`);
 * `decompile` with one argument, a `jar:` or `jrt:` URI, answers `{ code, language }` or `null`
 * (decompiler.ts); `build` with one argument, `{ buildId, uri?, testScope?, checkoutTools? }`,
 * answers `{ exitCode?, reason?, unsupported? }` and sends its output as `intellij/buildOutput`
 * (buildTaskModel.ts). */
export const kotlinCommands = { exportWorkspace: 'exportWorkspace', decompile: 'decompile', build: 'intellij.build' } as const;

/** lspClient.ts `indexDirFromClient`: the folder of the server's index, which it states in its
 * answer to `initialize` as `capabilities.experimental.indexDir`. "Clear Caches and Restart"
 * stops the server, deletes this folder and starts the server again (`clearCachesAndRestart`).
 * A folder is deleted on this value, so anything but an absolute path below a root is not one. */
export function kotlinIndexDirectory(capabilities: unknown): string | undefined {
  const experimental = isRecord(capabilities) ? capabilities.experimental : undefined;
  const directory = isRecord(experimental) && typeof experimental.indexDir === 'string' ? experimental.indexDir : undefined;
  if (!directory || directory.length > 4096 || !path.isAbsolute(directory)) return undefined;
  const resolved = path.resolve(directory);
  return resolved === path.parse(resolved).root ? undefined : resolved;
}
