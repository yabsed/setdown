import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

// The rules in this file are carried over from the VS Code Go extension. Zed's Go adapter
// (vendor/zed/crates/languages/src/go.rs) looks for `gopls` on PATH only and otherwise runs
// `go install golang.org/x/tools/gopls@latest` in the environment as it is. vscode-go looks in
// more places, chooses the gopls an old Go can still build, and installs in a cleaned environment.
// Each rule names the file it came from, so a newer `vendor/vscode-go` can be compared against it:
//   vendor/vscode-go/extension/src/utils/pathUtils.ts      where a Go program is looked for, and what counts as one
//   vendor/vscode-go/extension/src/util.ts                 the folders that search is given; how a Go version is read and compared
//   vendor/vscode-go/extension/src/goTools.ts              which gopls an old Go gets
//   vendor/vscode-go/extension/src/goToolsInformation.ts   the gopls entry
//   vendor/vscode-go/extension/src/goEnv.ts                the environment a tool is installed with
//   vendor/vscode-go/extension/src/goInstallTools.ts       the `go env` question, the oldest Go that installs, the install command
//
// Setdown has no `go.*` settings, so every branch that reads one is left out: `go.alternateTools`,
// `go.goroot`, `go.gopath`, `go.inferGopath`, `go.toolsGopath`, `go.toolsEnvVars`, `go.toolsManagement.go`,
// the Go a person picked in VS Code's status bar, and VS Code's own `http.proxy`. A person who wants
// a particular program names its file elsewhere in Setdown. vscode-go also remembers each answer for
// the session (`binPathCache`); nothing is remembered here.

/** The gopls entry of `allToolsInformation` in goToolsInformation.ts: its `importPath`. */
export const goplsImportPath = 'golang.org/x/tools/gopls';
/** The same entry names no `defaultVersion`, so `getImportPathWithVersion` ends at `@latest`. */
export const goplsDefaultVersion = 'latest';
/** goTools.ts `getImportPathWithVersion`, the gopls rows: a Go older than `below` gets `version`,
 * the last gopls that Go can build. The first row that applies is used. */
export const goplsPins = [{ below: '1.19', version: 'v0.14.2' }, { below: '1.21', version: 'v0.15.3' }] as const;
/** goInstallTools.ts `MINIMUM_GO_VERSION`: `installTools` installs nothing with an older Go. */
export const minimumGoForInstall = '1.21.0';
/** goEnv.ts `toolInstallationEnvironment`: a tool is built for this computer with Go's defaults,
 * so what would build it for another system, with other flags or from another Go is taken out. */
export const clearedForInstall = ['GOOS', 'GOARCH', 'GOROOT', 'GOFLAGS', 'GOENV', 'GO111MODULE'] as const;
/** What `go env` is asked: the list of goInstallTools.ts `updateGoVarsFromConfig`, and GOVERSION.
 * vscode-go reads the version from a second run, `go version`, which prints the same text. */
export const goEnvNames = ['GOPATH', 'GOROOT', 'GOPROXY', 'GOBIN', 'GOMODCACHE', 'GOVERSION'] as const;
/** Where the Go installers put `go` when it is not on PATH: `defaultPathsForGo` in pathUtils.ts. */
export const goDefaultPlaces = { win32: ['C:\\Program Files\\Go\\bin\\go.exe', 'C:\\Program Files (x86)\\Go\\bin\\go.exe'], other: ['/usr/local/go/bin/go', '/usr/local/bin/go'] };

/** The step of the search a program was found at. */
export type GoSource = 'GOBIN' | 'GOPATH' | 'GOROOT' | 'PATH';
export type FoundGoProgram<Source = GoSource> = { path: string; source: Source };
/** What `go env` answered, each value without surrounding spaces and empty when Go stated none,
 * and the `go` that answered. `source` tells whether that `go` is on PATH. When it is not, vscode-go
 * puts GOROOT/bin in front of PATH (goInstallTools.ts `updateGoVarsFromConfig`, goEnvironmentStatus.ts
 * `addGoRuntimeBaseToPATH`), because gopls runs `go` by name. That belongs to whoever starts gopls
 * and is not done in this file. */
export type GoEnvironment = Record<typeof goEnvNames[number], string> & { executable: string; source: Exclude<GoSource, 'GOPATH'> | 'default' };
export type RunGo = (file: string, args: string[], options: { env: NodeJS.ProcessEnv; cwd?: string; timeout?: number; signal?: AbortSignal }) => Promise<{ stdout: string }>;

const exec = promisify(execFile);
const execute: RunGo = (file, args, options) => exec(file, args, { ...options, encoding: 'utf8', windowsHide: true });
/** `go env` answers at once, unless the folder it runs in asks for a newer Go that has to be downloaded first. */
const goEnvTimeout = 20_000;
/** An install downloads the tool's source and compiles it. */
const goInstallTimeout = 10 * 60_000;

/** pathUtils.ts `correctBinname`. */
const programName = (tool: string) => process.platform === 'win32' ? `${tool}.exe` : tool;
/** pathUtils.ts `getEnvPath`. */
const searchPath = (env: NodeJS.ProcessEnv) => env.PATH || (process.platform === 'win32' ? env.Path : undefined);

/** pathUtils.ts `executableFileExists`: a file, not a folder, that this user may run. */
async function isProgram(file: string): Promise<boolean> {
  try { if (!(await stat(file)).isFile()) return false; await access(file, constants.F_OK | constants.X_OK); return true; }
  catch { return false; }
}

/** pathUtils.ts `getBinPathFromEnvVar`: `folders` is one folder, or several joined the way PATH is,
 * and `bin` looks in the `bin` folder of each. An entry that is not a full path is passed over.
 * vscode-go would stop at a program found through one and then treat it as missing, because every
 * reader of the answer asks for a full path (`getMissingTools`, `getLanguageServerToolPath`). */
async function programIn(tool: string, folders: string | undefined, bin: boolean): Promise<string | undefined> {
  for (const folder of (folders ?? '').split(path.delimiter).filter(entry => path.isAbsolute(entry))) {
    const file = path.join(folder, bin ? 'bin' : '', programName(tool));
    if (await isProgram(file)) return file;
  }
  return undefined;
}

async function firstProgram<Source extends GoSource>(tool: string, steps: [source: Source, folders: string | undefined, bin: boolean][]): Promise<FoundGoProgram<Source> | undefined> {
  for (const [source, folders, bin] of steps) { const file = await programIn(tool, folders, bin); if (file) return { path: file, source }; }
  return undefined;
}

/** `go` itself, as pathUtils.ts `getBinPathWithPreferredGopathGorootWithExplanation` finds it before
 * any `go` has run: GOBIN, then GOROOT/bin, then PATH, then the installers' folders. util.ts
 * `getBinPathWithExplanation` gives this search no GOPATH. */
export async function findGo(env: NodeJS.ProcessEnv, places: readonly string[] = process.platform === 'win32' ? goDefaultPlaces.win32 : goDefaultPlaces.other): Promise<FoundGoProgram<GoEnvironment['source']> | undefined> {
  const found = await firstProgram('go', [['GOBIN', env.GOBIN, false], ['GOROOT', env.GOROOT, true], ['PATH', searchPath(env), false]]);
  // snapd's `/snap/bin/go` starts Go with a changed environment (golang/vscode-go#166); vscode-go runs the program behind it.
  if (found) return found.source === 'PATH' && found.path === '/snap/bin/go' ? { ...found, path: '/snap/go/current/bin/go' } : found;
  for (const file of places) if (await isProgram(file)) return { path: file, source: 'default' };
  return undefined;
}

/** What Go says about this computer, from one run of `go env -json` (goInstallTools.ts
 * `updateGoVarsFromConfig`), or nothing when there is no `go` or it does not answer.
 *
 * `cwd` is the folder the question is asked in. In a project whose `go.mod` or `go.work` asks for
 * a newer Go, GOVERSION and GOROOT are then that Go's: the Go the project is built with, which
 * util.ts `getGoVersion` reads the same way. `toolchain: 'local'` asks as GOTOOLCHAIN=local, and
 * the answer is the Go that is installed, whatever a project asks for: the Go that installs a tool
 * (goInstallTools.ts `getGoVersionForInstall`). */
export async function goEnvironment(env: NodeJS.ProcessEnv, run: RunGo = execute, options: { cwd?: string; toolchain?: string; places?: readonly string[] } = {}): Promise<GoEnvironment | undefined> {
  const go = await findGo(env, options.places);
  if (!go) return undefined;
  const asked: NodeJS.ProcessEnv = { ...env };
  // goEnv.ts `toolExecutionEnvironment`: a `-json` among GOFLAGS would change what `go` prints.
  if (asked.GOFLAGS?.includes('-json')) asked.GOFLAGS = asked.GOFLAGS.replace(/(^|\s+)-?-json[^\s]*/g, '');
  if (options.toolchain !== undefined) asked.GOTOOLCHAIN = options.toolchain;
  try {
    const answer: unknown = JSON.parse((await run(go.path, ['env', '-json', ...goEnvNames], { env: asked, cwd: options.cwd, timeout: goEnvTimeout })).stdout);
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return undefined;
    const value = (name: string) => { const stated = (answer as Record<string, unknown>)[name]; return typeof stated === 'string' ? stated.trim() : ''; };
    return { executable: go.path, source: go.source, ...Object.fromEntries(goEnvNames.map(name => [name, value(name)])) as Record<typeof goEnvNames[number], string> };
  } catch { return undefined; }
}

/** An installed Go tool other than `go` itself, in the order of pathUtils.ts
 * `getBinPathWithPreferredGopathGorootWithExplanation` with the folders util.ts
 * `getBinPathWithExplanation` gives it: GOBIN, then the `bin` of each GOPATH folder, then GOROOT/bin,
 * then PATH. The first program found is the answer. The `go.alternateTools` and `go.toolsGopath`
 * steps, which come before these, are settings Setdown does not have.
 *
 * vscode-go writes what `go env` answered into its own environment where the environment was silent
 * (goInstallTools.ts `updateGoVarsFromConfig`). So GOBIN and GOPATH are the environment's, and Go's
 * answer only when the environment has none; GOROOT is Go's answer before the environment's. */
export async function findGoTool(tool: string, env: NodeJS.ProcessEnv, go?: GoEnvironment): Promise<FoundGoProgram | undefined> {
  return firstProgram(tool, [['GOBIN', env.GOBIN || go?.GOBIN, false], ['GOPATH', env.GOPATH || go?.GOPATH, true], ['GOROOT', go?.GOROOT || env.GOROOT, true], ['PATH', searchPath(env), false]]);
}

/** `semver.coerce`, which vscode-go reads every Go version with: the first one to three numbers
 * joined by dots. A number not written is 0 and what follows them (`rc1`, `-X:nodwarf5`) is dropped. */
function coerce(text: string): number[] | undefined {
  return /(?:^|\D)(\d{1,16})(?:\.(\d{1,16}))?(?:\.(\d{1,16}))?(?:$|\D)/.exec(text)?.slice(1, 4).map(part => Number(part ?? 0));
}
const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** util.ts `GoVersion`, read from `go env GOVERSION`: the text `go version` prints between
 * `go version ` and the platform. A release keeps its text as written (`1.22.3`, `1.24rc1`) and its
 * three numbers; a build of Go's own development branch (`devel go1.26-…`) has neither. */
type GoVersion = { text?: string; numbers?: number[]; devel: boolean };
function readGoVersion(stated: string | undefined): GoVersion {
  const text = /^go(\d\.\d+\S*)/.exec(stated ?? '')?.[1];
  return { text, numbers: text ? coerce(text) : undefined, devel: !text && /^devel go\d\.\d+/.test(stated ?? '') };
}
/** `GoVersion.lt`: a development build, and a version that could not be read, count as newer than every release. */
function older(go: GoVersion, than: string): boolean {
  const limit = coerce(than);
  return !!go.numbers && !!limit && compare(go.numbers, limit) < 0;
}

/** goTools.ts `getImportPathWithVersion` for gopls: what to write after `@` for this Go, given as
 * `go env GOVERSION` states it. A release candidate counts as its release, so `go1.21rc2` gets the newest gopls. */
export function goplsVersion(goVersion: string | undefined): string {
  const go = readGoVersion(goVersion);
  return goplsPins.find(pin => older(go, pin.below))?.version ?? goplsDefaultVersion;
}

/** goEnv.ts `toolInstallationEnvironment`: the environment `go install` runs in. `go` is the Go that
 * installs. The result is a new object.
 *
 * GOPATH, GOPROXY, GOBIN and GOMODCACHE are the environment's, and Go's answer where the environment
 * has none (`updateGoVarsFromConfig`); this keeps them when GOENV, which may be where they were
 * written, is taken out. GOTOOLCHAIN is always `auto`, so a tool that needs a newer Go than the
 * installed one can still be built.
 *
 * `projectGoVersion` is the Go the project is built with, as `go env GOVERSION` states it in the
 * project's folder. When it is a newer release than the Go that installs, the tool is built with at
 * least that release (goInstallTools.ts `installTools`). A development build on either side changes nothing. */
export function toolInstallationEnvironment(env: NodeJS.ProcessEnv, go: GoEnvironment, projectGoVersion?: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };
  for (const name of ['GOPATH', 'GOPROXY', 'GOBIN', 'GOMODCACHE'] as const) if (!result[name] && go[name]) result[name] = go[name];
  result.GOPATH = result.GOPATH ?? '';
  result.GOTOOLCHAIN = 'auto';
  for (const name of clearedForInstall) delete result[name];
  const project = readGoVersion(projectGoVersion), installing = readGoVersion(go.GOVERSION);
  if (project.numbers && installing.numbers && compare(project.numbers, installing.numbers) > 0) result.GOTOOLCHAIN = `go${project.text}+auto`;
  return result;
}

export type GoToolInstall = {
  /** The Go that installs: `goEnvironment(env, run, { toolchain: 'local' })`. */
  go: GoEnvironment;
  env: NodeJS.ProcessEnv;
  /** The folder the program is put in. It is the install's GOBIN, so nothing lands in the person's own Go folders. */
  destination: string;
  /** gopls when not given, at `goplsVersion` of the Go that installs. `version` is what goes after `@`.
   * Only gopls' versions were carried over, so another tool states its own. */
  tool?: { name: string; importPath: string; version: string };
  projectGoVersion?: string;
  /** vscode-go runs the install in the project's folder. `go install path@version` reads no `go.mod` there. */
  cwd?: string;
  run?: RunGo;
  signal?: AbortSignal };

/** goInstallTools.ts `installTools` and `installToolWithGoInstall`: `go install -v <path>@<version>`
 * in the installation environment. Returns the installed program's file.
 *
 * Nothing is installed with a Go older than `minimumGoForInstall`, or with one whose version cannot
 * be read. So the Go that installs never reaches the rows of `goplsPins`; the version they give is
 * what the refusal names for installing by hand, as vscode-go's `promptForMissingTool` does.
 *
 * Left out: the newest pre-release of gopls, which only a preview build of the extension asks for,
 * and the copy through a temporary folder for tools named `-v2` and up, which gopls is not. */
export async function installGoTool(options: GoToolInstall): Promise<string> {
  const { go, destination, signal } = options;
  const tool = options.tool ?? { name: 'gopls', importPath: goplsImportPath, version: goplsVersion(go.GOVERSION) };
  const target = `${tool.importPath}@${tool.version}`, version = readGoVersion(go.GOVERSION);
  if (!version.numbers && !version.devel) throw new Error(`${tool.name} was not installed: Go at ${go.executable} states no version that can be read (${JSON.stringify(go.GOVERSION)}).`);
  if (older(version, minimumGoForInstall)) throw new Error(`${tool.name} was not installed: Go at ${go.executable} is ${version.text}, and Setdown installs a Go tool with Go ${minimumGoForInstall} or newer. `
    + `With this Go it is installed by hand: go install -v ${target}`);
  signal?.throwIfAborted();
  await mkdir(destination, { recursive: true });
  const env = { ...toolInstallationEnvironment(options.env, go, options.projectGoVersion), GOBIN: destination };
  try { await (options.run ?? execute)(go.executable, ['install', '-v', target], { env, cwd: options.cwd, timeout: goInstallTimeout, signal }); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`${tool.name} was not installed: go install -v ${target} failed. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const file = path.join(destination, programName(tool.name));
  if (!await isProgram(file)) throw new Error(`${tool.name} was not installed: go install -v ${target} finished, and ${file} is not there.`);
  return file;
}
