import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { Diagnostic } from 'vscode-languageserver-protocol';
import { setting } from './extension-rules';

// What the VS Code Go extension checks when a Go file is saved, beside what gopls reports.
// The rules are carried over from:
//   vendor/vscode-go/extension/src/goMain.ts                    when a save starts the checks, and the name lint findings are filed under
//   vendor/vscode-go/extension/src/commands/runBuilds.ts        earlier findings are removed before the checks start
//   vendor/vscode-go/extension/src/diagnostics/goCheck.ts       which of build, vet and lint run (`check`)
//   vendor/vscode-go/extension/src/diagnostics/goLint.ts        the lint command (`goLint`)
//   vendor/vscode-go/extension/src/diagnostics/diagnostics.ts   running it, reading its output, what gopls already reported (`runTool`, `handleErrors`, `filterDiags`)
//   vendor/vscode-go/extension/src/goInstallTools.ts            the version of an installed golangci-lint (`inspectGoToolVersion`)
//   vendor/vscode-go/extension/src/goEnv.ts, util.ts            the environment a tool runs in, `${workspaceFolder}` and `~` in a setting
//   vendor/vscode-go/extension/package.json                     the settings and their defaults

/** goCheck.ts `check`, with gopls in use: what a save of a Go file starts. `go.useLanguageServer`
 * is on unless a person turns it off, and Setdown has no Go support without gopls.
 *
 *   build  never. `disableBuildAndVet` is `go.useLanguageServer`, and `go build` runs only without it.
 *   vet    never, for the same reason. gopls runs the vet analyzers itself.
 *   lint   only when `go.lintTool` names a tool and `go.lintOnSave` is not `off`. `go.lintTool` has no
 *          default, so with the settings as they come nothing at all runs on save: gopls already
 *          holds the staticcheck analyzers.
 *
 * `go.testOnSave` and `go.coverOnSave`, both off unless set, would run `go test`; they are not carried over. */
export const goChecksOnSave = { build: 'never', vet: 'never', lint: 'when go.lintTool is set' } as const;

/** package.json `go.lintTool`: the linters the setting offers. Any other program name is run the same way. */
export const goLintTools = ['staticcheck', 'golint', 'golangci-lint', 'golangci-lint-v2', 'revive'] as const;
/** package.json `go.lintOnSave`: its values and the one used when nothing is written. */
export const goLintScopes = ['file', 'package', 'workspace', 'off'] as const;
export const goLintOnSaveDefault = 'package';
/** diagnostics.ts `handleErrors` gives a lint finding the severity Warning (`goLint` passes `'warning'`): 2 in the protocol. */
export const goLintSeverity = 2;

/** One program to run. `program` is its name (`staticcheck`), which is also the name of the tool in the table of `go-tool-table.ts`. */
export type GoCheckCommand = { program: string; args: string[]; cwd: string };
export type GoCheckFacts = {
  /** The saved file, as a full path. */
  file: string;
  /** The project folder the file is in, when there is one (util.ts `getWorkspaceFolderPath`). */
  workspace?: string;
  /** For `golangci-lint` only: `goToolModuleVersion` of the installed program. Its flags differ between v1 and v2. */
  moduleVersion?: string;
  /** The person's home folder, for a `~` in `go.lintFlags`. */
  home?: string;
};

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const messageLimit = 4096;
/** One run of a linter over a whole project can print far more than a person reads. */
const mostFindings = 2000;
const mostFlags = 200;
/** A program name and nothing more: no folder, no option. */
const programName = /^[\w.+-]+$/;

/** goMain.ts `lintDiagnosticCollectionName`: the name lint findings are filed under, which a person
 * sees as their source. */
export const goLintSource = (tool: string | undefined) => !tool || tool === 'golint' ? 'go-lint' : `go-${tool}`;

/** util.ts `resolvePath`: `${workspaceFolder}` and `${workspaceRoot}` are the project folder,
 * `${workspaceFolderBasename}` its name, and a leading `~` the home folder. Without a project
 * folder its placeholders stay as written. */
export function resolveSettingPath(input: string, workspace: string | undefined, home: string = os.homedir()): string {
  if (!input.trim()) return input;
  const placed = workspace ? input.replace(/\${workspaceFolder}|\${workspaceRoot}/g, () => workspace).replace(/\${workspaceFolderBasename}/g, () => path.basename(workspace)) : input;
  return placed.startsWith('~') ? path.join(home, placed.slice(1)) : placed;
}

/** goEnv.ts `toolExecutionEnvironment`: the environment a Go tool is run in. `env` is the
 * environment tools are started with; each entry of `go.toolsEnvVars` is added, with
 * `${env:NAME}` read from `env` (util.ts `substituteEnv`) and then `${workspaceFolder}` and `~`
 * as in a path. A `-json` among GOFLAGS is taken out, because it changes what a tool prints.
 * The result is a new object.
 *
 * Left out: `go.gopath` and `go.inferGopath` as GOPATH, and VS Code's own `http.proxy`. */
export function goToolEnvironment(env: NodeJS.ProcessEnv, settings: Record<string, unknown> | undefined, facts: { workspace?: string; home?: string } = {}): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };
  for (const [name, value] of Object.entries(record(setting(settings, 'go.toolsEnvVars')) ?? {})) {
    if (!name || /[=\0]/.test(name)) continue;
    if (typeof value === 'string') result[name] = resolveSettingPath(value.replace(/\${env:([^}]+)}/g, (_whole, variable: string) => env[variable.trim()] || ''), facts.workspace, facts.home);
    else if (typeof value === 'number' || typeof value === 'boolean') result[name] = String(value);
  }
  if (result.GOFLAGS?.includes('-json')) result.GOFLAGS = result.GOFLAGS.replace(/(^|\s+)-?-json[^\s]*/g, '');
  return result;
}

/** The linter `go.lintTool` names, or nothing: goLint.ts `goLint` runs none when the setting is
 * unset or empty and leaves linting to gopls. A value that is more than a program's name names none. */
export function goLintTool(settings: Record<string, unknown> | undefined): string | undefined {
  const tool = setting(settings, 'go.lintTool');
  return typeof tool === 'string' && programName.test(tool) && !tool.startsWith('-') ? tool : undefined;
}

/** goInstallTools.ts `inspectGoToolVersion`: what `go version -m <program>` is asked with, and where
 * the module version is in the answer: the fourth field of the third line (`mod  <module>  v1.64.8  h1:…`).
 * Nothing when the answer has no such line, as for a program built without modules. */
export const goToolVersionArguments = (program: string) => ['version', '-m', program];
export function goToolModuleVersion(printed: string): string | undefined {
  return printed.split('\n', 3)[2]?.split(/\s+/)[3] || undefined;
}
/** goLint.ts `goLint`: which flags a golangci-lint understands. `golangci-lint-v2` is 2. For
 * `golangci-lint` the installed program decides: no module version, or one starting `v1`, is 1. */
export const golangciMajor = (tool: string, moduleVersion?: string): 1 | 2 => tool === 'golangci-lint-v2' ? 2 : !moduleVersion || moduleVersion.startsWith('v1') ? 1 : 2;

/** goLint.ts `goLint`: the lint command for one scope, or nothing when `go.lintTool` names no tool.
 *
 * - The folder it runs in is the project folder for `workspace`, and the saved file's folder otherwise.
 * - The arguments start with `go.lintFlags`. `--json` is dropped; a `--config=` or `-config=` flag has
 *   its file resolved (`resolveSettingPath`), and is dropped when it names none. No linter gets arguments
 *   of its own but golangci-lint: `run` in front unless written, `--issues-exit-code=0`, and the flags
 *   that make it print one `file:line:column: message` line per finding, which differ between v1 and v2.
 * - Last comes what to lint: `./...` for `workspace`, the file for `file`, nothing for `package`.
 *   Any other scope is treated as `package`, as the extension does. */
export function goLintCommand(settings: Record<string, unknown> | undefined, facts: GoCheckFacts, scope: string): GoCheckCommand | undefined {
  const linter = goLintTool(settings);
  if (!linter) return undefined;
  const workspace = facts.workspace || undefined;
  const cwd = scope === 'workspace' && workspace ? workspace : path.dirname(facts.file);
  if (!path.isAbsolute(cwd)) return undefined;

  const written = setting(settings, 'go.lintFlags'), args: string[] = [];
  for (const flag of Array.isArray(written) ? written.slice(0, mostFlags) : []) {
    if (typeof flag !== 'string' || flag.length > messageLimit || flag === '--json') continue;
    if (flag.startsWith('--config=') || flag.startsWith('-config=')) {
      const file = flag.slice(flag.indexOf('=') + 1).trim();
      if (file) args.push(flag.slice(0, flag.indexOf('=') + 1) + resolveSettingPath(file, workspace, facts.home));
      continue;
    }
    args.push(flag);
  }
  if (linter.startsWith('golangci-lint')) {
    const add = (flag: string) => { if (!args.includes(flag)) args.push(flag); };
    if (!args.includes('run')) args.unshift('run');
    // "adds an explicit no-error-code return argument" (golang/vscode-go#411): findings are not a failed run.
    add('--issues-exit-code=0');
    if (golangciMajor(linter, facts.moduleVersion) === 1) { add('--print-issued-lines=false'); add('--out-format=line-number'); }
    else {
      add('--output.text.print-issued-lines=false'); add('--show-stats=false'); add('--output.text.path=stdout');
      if (!args.some(flag => flag.startsWith('--path-mode='))) args.push('--path-mode=abs');
    }
  }
  if (scope === 'workspace' && workspace) args.push('./...');
  else if (scope === 'file') args.push(facts.file);
  return { program: linter, args, cwd };
}

/** goCheck.ts `check` with gopls in use: the commands a save of `facts.file` starts. Build and vet
 * are never among them (`goChecksOnSave`). Lint is, in the scope `go.lintOnSave` names (`package`
 * when nothing is written), unless that is `off`. */
export function goCheckPlan(settings: Record<string, unknown> | undefined, facts: GoCheckFacts): GoCheckCommand[] {
  const written = setting(settings, 'go.lintOnSave'), scope = written === undefined ? goLintOnSaveDefault : written;
  if (typeof scope !== 'string' || !scope || scope === 'off') return [];
  const lint = goLintCommand(settings, facts, scope);
  return lint ? [lint] : [];
}

/** diagnostics.ts `runTool`: a line of a tool's output that is a finding. The groups used are the
 * file (2), the line (4), the column (6) and the message (7). */
export const goCheckLine = /^([^:]*: )?((.:)?[^:]*):(\d+)(:(\d+)?)?:(?:\w+:)? (.*)$/;

/** diagnostics.ts `runTool`, the reading of what a linter printed, and `handleErrors`, the making
 * of findings from it, by the full path of the file each is in.
 *
 * A finding is a line `file:line: message` or `file:line:column: message` (`goCheckLine`); a
 * prefix that ends in a colon and a space (`vet: `) is passed over. A line that starts with a tab
 * continues the message before it. Any other line is not a finding. A file under a `vendor`
 * folder, written without a full path, is left out. A file name is completed against `cwd`, the
 * folder the linter ran in.
 *
 * Every finding is a warning under the source `goLintSource(tool)`. Without the text of the line
 * it covers one character, from the column (the first when none was printed). `lineText` gives
 * that text for a file that is open: the finding then reaches to the end of the line, and starts
 * at the first character that is not a space when no column was printed. */
export function parseGoCheckOutput(tool: string, output: string, cwd: string, lineText?: (file: string, line: number) => string | undefined): Map<string, Diagnostic[]> {
  const result = new Map<string, Diagnostic[]>(), source = goLintSource(tool);
  let last: Diagnostic | undefined, count = 0;
  for (const raw of output.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line[0] === '\t' && last) { last.message = `${last.message}\n${line}`.slice(0, messageLimit); continue; }
    const match = goCheckLine.exec(line);
    if (!match) continue;
    const file = match[2], row = Number(match[4]), column = match[6] ? Number(match[6]) : undefined;
    if (!file || !Number.isSafeInteger(row) || (column !== undefined && !Number.isSafeInteger(column))) continue;
    // "vet and lint take in directories and not import paths, so no way to skip them. So prune out the results from vendor folders here."
    if (!path.isAbsolute(file) && (file.startsWith(`vendor${path.sep}`) || file.includes(`${path.sep}vendor${path.sep}`))) continue;
    if (count++ >= mostFindings) break;
    const full = path.resolve(cwd, file), at = Math.max(0, row - 1), text = lineText?.(full, at);
    let start = column ? column - 1 : 0, end = start + 1;
    if (text !== undefined) {
      if (!column) start = /^\s*/.exec(text)?.[0].length ?? 0;
      [start, end] = [Math.min(start, text.length), Math.max(start, text.length)];
    }
    last = { range: { start: { line: at, character: start }, end: { line: at, character: end } }, message: match[7].slice(0, messageLimit), severity: goLintSeverity, source };
    const found = result.get(full);
    if (found) found.push(last); else result.set(full, [last]);
  }
  return result;
}

/** diagnostics.ts `filterDiags`: the lint findings of one file without those gopls already
 * reported. Two reports are the same when they start at the same line and character. The lint
 * finding is then kept only when it is more severe than every report of gopls at that place; one
 * of the same severity is dropped. A report without a severity counts as an error.
 *
 * The extension applies this when lint findings arrive (`handleErrors`) and again each time gopls
 * publishes for the file (`GoDiagnosticsFeature`), where what is dropped stays dropped. */
export function withoutDuplicates(checkDiagnostics: readonly Diagnostic[], goplsDiagnostics: readonly Diagnostic[]): Diagnostic[] {
  const place = (diagnostic: Diagnostic) => `${diagnostic.range.start.line}:${diagnostic.range.start.character}`;
  const severe = new Map<string, number>();
  for (const diagnostic of goplsDiagnostics) {
    const key = place(diagnostic), severity = diagnostic.severity ?? 1, known = severe.get(key);
    // A lower number is more severe: 1 is an error.
    if (known === undefined || severity < known) severe.set(key, severity);
  }
  return checkDiagnostics.filter(diagnostic => { const masked = severe.get(place(diagnostic)); return masked === undefined || (diagnostic.severity ?? 1) < masked; });
}

/** What running a program gave. `error` is set when it could not be started (`ENOENT`) or did not
 * end with status 0 (the status, or the signal that ended it). */
export type CheckRun = { stdout: string; stderr: string; error?: string | number };
export type RunCheck = (file: string, args: string[], options: { env: NodeJS.ProcessEnv; cwd: string; signal?: AbortSignal }) => Promise<CheckRun>;
/** A linter prints one line per finding; over a whole project that is more than Node keeps unless told. */
const mostOutput = 16 * 1024 * 1024;
const execute: RunCheck = (file, args, options) => new Promise(resolve => {
  execFile(file, args, { ...options, encoding: 'utf8', windowsHide: true, maxBuffer: mostOutput },
    (error, stdout, stderr) => resolve({ stdout, stderr, error: error ? error.code ?? error.signal ?? 'failed' : undefined }));
});

export type GoCheckResult = {
  /** The findings by the full path of their file, before `withoutDuplicates`. */
  diagnostics: Map<string, Diagnostic[]>;
  /** Programs of the plan that are not installed. Nothing is installed here: `missingGoTool` of
   * `go-tool-table.ts` says what to offer. */
  missing: string[];
  /** Lines for the tool's log. */
  log: string[] };

/** diagnostics.ts `runTool`: runs each command of a plan and reads its findings.
 *
 * `find` gives the file of an installed program by its name; a program it does not know, and one
 * the system cannot start, is reported as `missing` and nothing is shown, as the extension stays
 * silent about a missing linter on every save. Without `find` the name itself is run.
 *
 * A linter that ends with an error and wrote to its error output gave no findings: what it wrote
 * goes to the log. Otherwise its standard output is read, whatever status it ended with, because
 * staticcheck and revive end with a status that is not 0 when they found something.
 *
 * The extension sets no time limit. It stops the run still going when the next one starts
 * (`goLint`): `signal` does that here, and a stopped run throws the signal's reason.
 *
 * `env` is `goToolEnvironment`. `lineText` is passed to `parseGoCheckOutput`. */
export async function runGoCheck(commands: readonly GoCheckCommand[], options: {
  env: NodeJS.ProcessEnv; find?(program: string): string | undefined | Promise<string | undefined>; run?: RunCheck; signal?: AbortSignal;
  lineText?(file: string, line: number): string | undefined }): Promise<GoCheckResult> {
  const result: GoCheckResult = { diagnostics: new Map(), missing: [], log: [] };
  for (const command of commands) {
    options.signal?.throwIfAborted();
    const file = options.find ? await options.find(command.program) : command.program;
    if (!file) { result.missing.push(command.program); continue; }
    let ran: CheckRun;
    try { ran = await (options.run ?? execute)(file, command.args, { env: options.env, cwd: command.cwd, signal: options.signal }); }
    catch (error) { options.signal?.throwIfAborted(); ran = { stdout: '', stderr: error instanceof Error ? error.message : String(error), error: 'failed' }; }
    options.signal?.throwIfAborted();
    const stdout = typeof ran.stdout === 'string' ? ran.stdout : '', stderr = typeof ran.stderr === 'string' ? ran.stderr : '';
    if (ran.error === 'ENOENT') { result.missing.push(command.program); continue; }
    if (ran.error !== undefined && stderr) {
      result.log.push(['Error while running tool:', file, ...command.args].join(' ').slice(0, messageLimit), stderr.slice(0, messageLimit));
      continue;
    }
    result.log.push([`${command.cwd}>Finished running tool:`, file, ...command.args].join(' ').slice(0, messageLimit));
    for (const [found, diagnostics] of parseGoCheckOutput(command.program, stdout, command.cwd, options.lineText)) result.diagnostics.set(found, [...result.diagnostics.get(found) ?? [], ...diagnostics]);
  }
  return result;
}
