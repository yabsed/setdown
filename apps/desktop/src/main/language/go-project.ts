import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Diagnostic, TextDocumentContentChangeEvent } from 'vscode-languageserver-protocol';
import { goCheckPlan, goLintTool, goToolEnvironment, goToolModuleVersion, goToolVersionArguments, runGoCheck } from './go-check';
import { goTestCommand, goTestEnvironment, goplsCommand, goplsConfiguration, goplsOptions, type GoplsCommandContext, type GoTestRun } from './go-gopls-rules';
import { goTool, installTableTool, missingGoTool } from './go-tool-table';
import { findGoTool, goEnvironment, installGoTool } from './go-tools';
import { canChooseGo, currentGoChoice, downloadableGoVersions, downloadedGo, goChoices, goDownloadCommands, goDownloadList, goDownloadTool, goSwitchRefusedMessage, installedGoVersions, isCurrentGo, withGoFirst,
  type DownloadableGo, type InstalledGo } from './go-versions';

// What the Go extension does around gopls, put together for one project: the lint tool it
// runs after a save, the Go it lets a person choose, and the test a code lens starts. The
// rules are in `go-check.ts`, `go-tool-table.ts`, `go-versions.ts` and `go-gopls-rules.ts`;
// this file reads the disk, runs the programs and keeps the one choice.

type Settings = Record<string, unknown> | undefined;
const isFile = (file: string) => stat(file).then(found => found.isFile(), () => false);
const programFile = (name: string) => process.platform === 'win32' ? `${name}.exe` : name;
function run(file: string, args: string[], options: { env: NodeJS.ProcessEnv; cwd?: string; timeout?: number; signal?: AbortSignal }): Promise<string> {
  return new Promise((resolve, reject) => execFile(file, args, { ...options, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    (error, stdout) => error ? reject(error) : resolve(stdout)));
}

/** Where Setdown puts the Go tools it installs itself (`project-languages.ts` `gopls`). */
export const goToolFolder = (directory: string) => path.join(directory, 'go', 'bin');

// ---- The Go a person chose (goEnvironmentStatus.ts `workspaceState.selectedGo`) ----
// The extension keeps the choice for one workspace, where one window runs one gopls. Here the
// project engine starts every gopls with one environment (`project-languages.ts` `gopls`), so
// the choice is one for Setdown: it holds for every project whose own settings leave it open.

const choiceFile = (directory: string) => path.join(directory, 'go', 'selected.json');
async function choice(directory: string): Promise<string | undefined> {
  try {
    const data = JSON.parse(await readFile(choiceFile(directory), 'utf8')) as { program?: unknown } | null;
    return typeof data?.program === 'string' && path.isAbsolute(data.program) && !data.program.includes('\0') ? data.program : undefined;
  } catch { return undefined; }
}
/** The `go` program the person chose, when it is still there and the choice is allowed: a
 * project that sets `go.goroot`, or an environment that sets `GOROOT`, has decided already. */
export async function chosenGo(directory: string, project: string, settings: Settings, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const program = await choice(directory);
  return program && canChooseGo({ project, settings, env }).ok && await isFile(program) ? program : undefined;
}
async function keepChoice(directory: string, program: string | undefined): Promise<void> {
  await mkdir(path.dirname(choiceFile(directory)), { recursive: true });
  await writeFile(`${choiceFile(directory)}.tmp`, `${JSON.stringify(program ? { program } : {}, null, 2)}\n`);
  await rename(`${choiceFile(directory)}.tmp`, choiceFile(directory));
}
/** The environment with the chosen Go first, as the extension puts it there for gopls and the tools. */
export async function goProjectEnvironment(directory: string, project: string, settings: Settings, env: NodeJS.ProcessEnv): Promise<{ env: NodeJS.ProcessEnv; chosen?: string }> {
  const chosen = await chosenGo(directory, project, settings, env);
  return chosen ? { env: withGoFirst(env, path.dirname(chosen)), chosen } : { env };
}

export type GoVersionList = { refusal?: string; current?: string; chosen: boolean; local: InstalledGo[]; downloadable: DownloadableGo[] };
/** "Go: Choose Go Environment": the Go in use, the ones in `~/sdk`, and the releases that can
 * be downloaded. The list of releases is read from go.dev; without an answer only the local ones are listed. */
export async function goVersionList(directory: string, project: string, settings: Settings, base: NodeJS.ProcessEnv, download: typeof fetch = fetch): Promise<GoVersionList> {
  const { env, chosen } = await goProjectEnvironment(directory, project, settings, base);
  const go = await goEnvironment(env, undefined, { cwd: project });
  const allowed = canChooseGo({ project, settings, env: base });
  if (!allowed.ok) return { refusal: goSwitchRefusedMessage(go?.GOROOT ?? '', allowed.reason), current: go && currentGoChoice(go)?.label, chosen: false, local: [], downloadable: [] };
  const releases = await download(goDownloadList, { signal: AbortSignal.timeout(8000) }).then(answer => answer.ok ? answer.json() as Promise<unknown> : undefined, () => undefined);
  const listed = goChoices(go && currentGoChoice(go), await installedGoVersions(), downloadableGoVersions(releases));
  return { current: go && currentGoChoice(go)?.label, chosen: !!chosen, local: listed.local.slice(0, 200), downloadable: listed.downloadable.slice(0, 200) };
}
/** The person's choice from that list: a local row by its program, a release by its name, or
 * `clear` for the Go of the environment. A release is installed as the extension installs it:
 * its `golang.org/dl` wrapper, then `<wrapper> download`. True when the Go of the project changed. */
export async function chooseGoVersion(directory: string, project: string, settings: Settings, base: NodeJS.ProcessEnv,
  picked: { program?: unknown; version?: unknown; clear?: unknown }, report: (message: string) => void = () => {}, download: typeof fetch = fetch): Promise<boolean> {
  if (picked.clear === true) { const had = !!await choice(directory); await keepChoice(directory, undefined); return had; }
  const list = await goVersionList(directory, project, settings, base, download);
  if (list.refusal) throw Error(list.refusal);
  const { env } = await goProjectEnvironment(directory, project, settings, base);
  const go = await goEnvironment(env, undefined, { cwd: project });
  let found = list.local.find(row => row.program === picked.program);
  const release = list.downloadable.find(row => row.version === picked.version);
  if (!found && release) {
    const tool = goDownloadTool(release.version), local = await goEnvironment(base, undefined, { toolchain: 'local' });
    if (!tool || !local) throw Error('A Go release is downloaded with Go itself, and no Go was found on this computer.');
    report(`Downloading ${release.label}…`);
    const wrapper = await installGoTool({ go: local, env: base, destination: goToolFolder(directory), tool, cwd: project });
    const commands = goDownloadCommands(release.version, local.executable, wrapper);
    if (!commands) throw Error(`${release.version} is not the name of a Go release.`);
    await run(commands.download.program, commands.download.args, { env: base, cwd: project, timeout: 20 * 60_000 });
    found = downloadedGo(release.version, await run(commands.root.program, commands.root.args, { env: base, cwd: project, timeout: 60_000 }));
  }
  if (!found || !await isFile(found.program)) throw Error('That Go is not on this computer.');
  if (isCurrentGo(found, go)) return false;
  await keepChoice(directory, found.program);
  return true;
}

// ---- gopls' options from the `go.*` settings (goLanguageServer.ts `adjustGoplsWorkspaceConfiguration`) ----

/** What Setdown adds to gopls' initialization options: the person's `gopls` settings, the build
 * flags and tags, the inlay hints and the vulnerability check, under gopls' own short names. */
export const goplsStartOptions = (settings: Settings): Record<string, unknown> => goplsOptions(goplsConfiguration(settings));

// ---- "Go: Add Tags To Struct Fields" and its counterpart (goModifytags.ts) ----

/** `gopls.modify_tags` for the selection, with what `go.addTags` or `go.removeTags` say. Where
 * the settings name neither tags nor options, gopls would ask through a form of its own; here
 * the answer is `ask`, the editor asks the person, and sends their `tags` with the same request. */
export function goTagsCommand(uri: string, params: Record<string, unknown>, settings: Settings): { ask: string } | { command: string; arguments: unknown[] } | undefined {
  const entry = goplsCommand('gopls.modify_tags').find(row => row.menu === (params.modification === 'remove' ? 'go.remove.tags' : 'go.add.tags'));
  if (!entry?.arguments) return undefined;
  const tags = typeof params.tags === 'string' && /^[\w,\- ]{1,200}$/.test(params.tags.trim()) ? params.tags.trim() : undefined;
  const made = entry.arguments({ uri, range: params.range as GoplsCommandContext['range'], settings, chosen: tags });
  if (made) return { command: entry.command, arguments: made };
  return tags === undefined && entry.chooser ? { ask: entry.chooser.what } : undefined;
}

// ---- The test a code lens starts (goLanguageServer.ts, testUtils.ts) ----

export type GoTestProgram = Pick<GoTestRun, 'cwd' | 'program' | 'args' | 'label'> & { env: Record<string, string> };
/** `gopls.run_tests` as the command the extension runs in a terminal, with what the settings
 * add to the environment. Undefined when the arguments are not those of a test lens. */
export function goTestProgram(args: unknown, settings: Settings, project: string, base: NodeJS.ProcessEnv): GoTestProgram | undefined {
  const test = goTestCommand('gopls.run_tests', args, settings, { workspace: project });
  if (!test) return undefined;
  const env = goTestEnvironment(base, settings, { workspace: project });
  const added = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== base[entry[0]] && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0])));
  return { cwd: test.cwd, program: test.program, args: test.args, label: test.label, env: added };
}

// ---- The lint tool after a save (goCheck.ts, goLint.ts) ----

export type GoLintRun = { diagnostics: Map<string, Diagnostic[]>; notes: string[]; log: string[] };
/** What a save of `file` starts, as the extension with gopls in use: nothing unless
 * `go.lintTool` names a tool and `go.lintOnSave` is not `off`; then that tool, for the file,
 * its package or the project. Undefined when nothing runs. A tool that is not on this computer
 * is installed first where Setdown may download tools (`mayInstall`), since the person asked
 * for it by name; otherwise the extension's own sentence about it is a note. */
export async function goLintOnSave(options: { file: string; project: string; settings: Settings; env: NodeJS.ProcessEnv; directory: string; mayInstall: boolean;
  signal: AbortSignal; report?(message: string): void }): Promise<GoLintRun | undefined> {
  const { file, project, settings, signal } = options, name = goLintTool(settings);
  if (!name || !goCheckPlan(settings, { file, workspace: project }).length) return undefined;
  const env = goToolEnvironment(options.env, settings, { workspace: project });
  const go = await goEnvironment(env, undefined, { cwd: project });
  const own = goToolFolder(options.directory);
  const find = async (program: string) => (await findGoTool(program, env, go))?.path ?? (await isFile(path.join(own, programFile(program))) ? path.join(own, programFile(program)) : undefined);
  const check = async () => {
    // golangci-lint changed its flags with version 2; the program says which it is (goLint.ts `inspectGoToolVersion`).
    const program = name === 'golangci-lint' && go ? await find(name) : undefined;
    const moduleVersion = program && go ? await run(go.executable, goToolVersionArguments(program), { env, timeout: 20_000, signal }).then(goToolModuleVersion, () => undefined) : undefined;
    return runGoCheck(goCheckPlan(settings, { file, workspace: project, moduleVersion }), { env, find, signal });
  };
  let result = await check();
  const row = goTool(name);
  if (result.missing.length && options.mayInstall && row && !row.neverInstalled) {
    const local = await goEnvironment(env, undefined, { toolchain: 'local' });
    if (local) {
      options.report?.(`Installing ${name}…`);
      const installed = await installTableTool({ tool: row, go: local, env, destination: own, projectGoVersion: go?.GOVERSION, cwd: project, signal }).then(() => true, error => { result.log.push(String(error instanceof Error ? error.message : error).slice(0, 2000)); return false; });
      if (installed) result = { ...await check(), log: [...result.log] };
    }
  }
  return { diagnostics: result.diagnostics, log: result.log, notes: result.missing.map(missing => missingGoTool(missing, go?.GOVERSION, env.PATH ?? '').message.slice(0, 1000)) };
}

/** The lint tool spoke of the file as it was saved, and the person goes on typing. What it said
 * about lines above a change stays, what it said below moves with the lines, and what it said
 * about the changed lines themselves is dropped: the next save asks the tool again. */
export function lintAfterChange(diagnostics: readonly Diagnostic[], changes: readonly TextDocumentContentChangeEvent[]): Diagnostic[] {
  let result = [...diagnostics];
  for (const change of changes) {
    if (!('range' in change)) return [];
    const { start, end } = change.range, moved = change.text.split('\n').length - 1 - (end.line - start.line);
    result = result.flatMap(item => item.range.end.line < start.line ? [item] : item.range.start.line <= end.line ? []
      : [{ ...item, range: { start: { ...item.range.start, line: item.range.start.line + moved }, end: { ...item.range.end, line: item.range.end.line + moved } } }]);
  }
  return result;
}
