import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setting } from './extension-rules';

// "Go: Choose Go Environment" of the VS Code Go extension: which Go versions a person can choose
// between, how one that is not installed gets installed, and when the extension refuses to switch.
// The rules are carried over from:
//   vendor/vscode-go/extension/src/goEnvironmentStatus.ts   the list, the download, the refusals, PATH
//   vendor/vscode-go/extension/src/util.ts                  how a Go version is read, written and compared (`GoVersion`)
//   vendor/vscode-go/docs/ui.md                             "$HOME/sdk" and the download site, as the person is told
//
// Nothing in this file asks the network or runs a program. The download list is fetched by whoever
// shows the list; the commands are run by whoever installs.

/** goEnvironmentStatus.ts `getDownloadableGoVersions`: the page that lists the Go releases that can be downloaded. */
export const goDownloadList = 'https://go.dev/dl/?mode=json';
/** The same function: a release `go1.23.4` is the Go program `golang.org/dl/go1.23.4`. */
export const goDownloadImportPath = 'golang.org/dl/';
/** goEnvironmentStatus.ts `chooseGoEnvironment`: the fixed rows and the two group names of the list. */
export const goChoiceText = {
  browse: 'Choose from file browser', browseDetail: 'Select the go binary to use', clear: 'Clear selection',
  local: 'Locally discovered', downloadable: 'Downloadable' } as const;
/** goEnvironmentStatus.ts `canChooseGoEnvironment`: why the extension does not switch, in its words. */
export const goSwitchRefusals = {
  noProject: 'Switching Go version is not yet supported in single-file mode.',
  setting: 'Switching Go version when "go.goroot" is set is unsupported.',
  environment: 'Switching Go version when process.env["GOROOT"] is set is unsupported.' } as const;

/** A Go on this computer: `GoEnvironmentOption` with `available`. `program` is its `go` file. */
export type InstalledGo = { label: string; program: string };
/** A Go release that can be downloaded: `GoEnvironmentOption` without `available`. `version` is the
 * release's name (`go1.23.4`) and `importPath` what `go install` is given. */
export type DownloadableGo = { label: string; version: string; importPath: string; stable: boolean };
export type GoCommand = { program: string; args: string[] };

const programName = (tool: string) => process.platform === 'win32' ? `${tool}.exe` : tool;
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
/** A list longer than this is not a list of Go versions. */
const mostVersions = 500;
/** A release name is put into a command line and a file name, so only what a Go release is named may pass. */
const releaseName = /^go\d[\w.]{0,40}$/;

/** `semver.coerce`, which vscode-go reads every Go version with: the first one to three numbers
 * joined by dots. A number not written is 0 and what follows them (`rc1`) is dropped. */
function coerce(text: string): [number, number, number] | undefined {
  const found = /(?:^|\D)(\d{1,16})(?:\.(\d{1,16}))?(?:\.(\d{1,16}))?(?:$|\D)/.exec(text);
  return found ? [Number(found[1]), Number(found[2] ?? 0), Number(found[3] ?? 0)] : undefined;
}

/** util.ts `GoVersion`, read from what `go env GOVERSION` states, which is what `go version` prints
 * between `go version ` and the platform. A release keeps its text as written (`1.22.3`, `1.24rc1`)
 * and its three numbers; a build of Go's development branch (`devel go1.26-…`) keeps what follows `go`.
 * `go-tools.ts` reads a version the same way and keeps it to itself; see the report for joining the two. */
export type GoVersion = { text?: string; numbers?: [number, number, number]; devel?: string };
export function readGoVersion(stated: string | undefined): GoVersion {
  const text = /^go(\d\.\d+\S*)/.exec(stated ?? '')?.[1];
  if (text) return { text, numbers: coerce(text) };
  return { devel: /^devel go(\d\.\d+\S*)/.exec(stated ?? '')?.[1] };
}
/** `GoVersion.lt`: a development build, and a version that could not be read, count as newer than every release. */
export function goOlder(go: GoVersion, than: string): boolean {
  const limit = coerce(than), numbers = go.numbers;
  return !!numbers && !!limit && (numbers[0] - limit[0] || numbers[1] - limit[1] || numbers[2] - limit[2]) < 0;
}
/** `GoVersion.format()`: the three numbers of a release (`1.24.0` for `go1.24rc1`), `devel …` for a
 * development build and `unknown` for a version that could not be read. */
export const goVersionNumbers = (go: GoVersion) => go.numbers ? go.numbers.join('.') : go.devel ? `devel ${go.devel}` : 'unknown';

/** goEnvironmentStatus.ts `formatGoVersion`: a release as written (`1.22.3`, `1.24rc1`), a
 * development build by what follows `go`, and `(unknown)` for anything else. */
export function goVersionLabel(stated: string | undefined): string {
  const go = readGoVersion(stated);
  return go.numbers ? go.text ?? '(unknown)' : go.devel ?? '(unknown)';
}
/** `getSDKGoOptions` and `getDownloadableGoVersions` label a Go by its folder or release name with the first `go` written `Go `. */
export const goLabel = (name: string) => name.replace('go', 'Go ');

/** goEnvironmentStatus.ts `getSDKGoOptions`: `go<version> download` puts each Go in `$HOME/sdk/go<version>`. */
export const goSdkFolder = (home: string = os.homedir()) => path.join(home, 'sdk');

/** `getSDKGoOptions`, the part that needs no disk: for each name in the listing of the sdk folder,
 * where that Go's `go` would be and what it is called. A name is kept as it is; the extension asks
 * only whether `bin/go` under it is a file, which `installedGoVersions` does. */
export function sdkGoPrograms(sdk: string, names: unknown): InstalledGo[] {
  if (!Array.isArray(names)) return [];
  return names.slice(0, mostVersions)
    .filter((name): name is string => typeof name === 'string' && !!name && name.length <= 255 && name === path.basename(name) && name !== '.' && name !== '..')
    .map(name => ({ label: goLabel(name), program: path.join(sdk, name, 'bin', programName('go')) }));
}

/** What the scan of the sdk folder asks the disk. */
export type GoSdkFiles = { readdir(folder: string): Promise<unknown>; isFile(file: string): Promise<boolean> };
const disk: GoSdkFiles = { readdir: folder => readdir(folder), isFile: async file => (await stat(file)).isFile() };

/** goEnvironmentStatus.ts `getSDKGoOptions`: the Go versions in `$HOME/sdk`, in the order the folder
 * lists them. A folder without `bin/go`, and an sdk folder that is missing or cannot be read, give nothing. */
export async function installedGoVersions(home: string = os.homedir(), files: GoSdkFiles = disk): Promise<InstalledGo[]> {
  const sdk = goSdkFolder(home);
  let names: unknown;
  try { names = await files.readdir(sdk); } catch { return []; }
  const found = await Promise.all(sdkGoPrograms(sdk, names).map(async option => { try { return await files.isFile(option.program) ? option : undefined; } catch { return undefined; } }));
  return found.filter((option): option is InstalledGo => option !== undefined);
}

/** goEnvironmentStatus.ts `getDefaultGoOption`: the Go in use, as the first row of the list.
 * `go` is what `goEnvironment` of `go-tools.ts` answered. Its label has no `Go ` in front, which
 * is how the extension writes it. */
export function currentGoChoice(go: { GOROOT: string; GOVERSION: string } | undefined): InstalledGo | undefined {
  return go?.GOROOT ? { label: goVersionLabel(go.GOVERSION), program: path.join(go.GOROOT, 'bin', programName('go')) } : undefined;
}

/** goEnvironmentStatus.ts `getDownloadableGoVersions`: the answer of `goDownloadList`, an array of
 * `{ version: "go1.23.4", stable: true, … }`, as rows in the order given. An entry that is not a
 * release name is left out, and an answer that is not an array gives nothing, as a failed request does. */
export function downloadableGoVersions(answer: unknown): DownloadableGo[] {
  if (!Array.isArray(answer)) return [];
  const result: DownloadableGo[] = [];
  for (const entry of answer.slice(0, mostVersions)) {
    const version = record(entry)?.version;
    if (typeof version === 'string' && releaseName.test(version)) result.push({ label: goLabel(version), version, importPath: goDownloadImportPath + version, stable: record(entry)?.stable === true });
  }
  return result;
}

/** goEnvironmentStatus.ts `chooseGoEnvironment`, `addOption`: the rows under "Locally discovered"
 * (the Go in use, then the sdk folder's) and under "Downloadable". A row is added only when neither
 * its label nor its description was seen before, across both groups. The description is the `go`
 * file of an installed Go and `download golang.org/dl/go…` otherwise, so a release already in the
 * sdk folder is not offered for download: both are labelled `Go 1.23.4`. */
export function goChoices(current: InstalledGo | undefined, installed: readonly InstalledGo[], downloadable: readonly DownloadableGo[]): { local: InstalledGo[]; downloadable: DownloadableGo[] } {
  const descriptions = new Set<string>(), labels = new Set<string>();
  const fresh = (label: string, description: string) => {
    if (descriptions.has(description) || labels.has(label)) return false;
    descriptions.add(description); labels.add(label);
    return true;
  };
  return {
    local: [...current ? [current] : [], ...installed].filter(option => fresh(option.label, option.program)),
    downloadable: downloadable.filter(option => fresh(option.label, `download ${option.importPath}`)) };
}

/** goEnvironmentStatus.ts `setSelectedGo`: choosing the Go that is already in use changes nothing.
 * It is the same Go when it is the same file, or when the row is labelled `Go ` and the three
 * numbers of the version in use. */
export function isCurrentGo(choice: InstalledGo, go: { executable: string; GOVERSION: string } | undefined): boolean {
  return !!go && (go.executable === choice.program || `Go ${goVersionNumbers(readGoVersion(go.GOVERSION))}` === choice.label);
}

/** goEnvironmentStatus.ts `canChooseGoEnvironment`, in its order: no project folder, then a
 * `go.goroot` setting, then GOROOT in the environment. Either GOROOT already names the Go to use,
 * so a choice would be passed over. `project` is the folder that is open, if any. */
export function canChooseGo(facts: { project?: string; settings?: Record<string, unknown>; env: NodeJS.ProcessEnv }): { ok: true } | { ok: false; reason: string } {
  if (!facts.project) return { ok: false, reason: goSwitchRefusals.noProject };
  if (setting(facts.settings, 'go.goroot')) return { ok: false, reason: goSwitchRefusals.setting };
  if (facts.env.GOROOT) return { ok: false, reason: goSwitchRefusals.environment };
  return { ok: true };
}
/** `chooseGoEnvironment`: what the person is shown in place of the list. `goroot` is the GOROOT in use. */
export const goSwitchRefusedMessage = (goroot: string, reason: string) => `GOROOT: ${goroot}. ${reason}`;

/** goEnvironmentStatus.ts `downloadGo`: what `installGoTool` of `go-tools.ts` is given as `tool` to
 * install the program that downloads this release. The extension names no version, which
 * goTools.ts `getImportPathWithVersion` ends at `@latest`. */
export function goDownloadTool(version: string): { name: string; importPath: string; version: 'latest' } | undefined {
  return releaseName.test(version) ? { name: version, importPath: goDownloadImportPath + version, version: 'latest' } : undefined;
}

/** goEnvironmentStatus.ts `downloadGo`, its three runs in order. `install` builds the small program
 * named after the release, in the environment a Go tool is installed with; `download` makes that
 * program fetch the release into `$HOME/sdk`; `root` asks it where the release is, again in the
 * install environment. `go` is the Go that installs and `wrapper` the installed program's file. */
export function goDownloadCommands(version: string, go = 'go', wrapper: string = programName(version)): { install: GoCommand; download: GoCommand; root: GoCommand } | undefined {
  const tool = goDownloadTool(version);
  return tool && {
    install: { program: go, args: ['install', '-v', `${tool.importPath}@${tool.version}`] },
    download: { program: wrapper, args: ['download'] },
    root: { program: wrapper, args: ['env', 'GOROOT'] } };
}

/** `downloadGo`, its end: what the `root` command printed is the folder of the downloaded Go, and
 * the Go to choose is `bin/go` in it under the label the row had. The extension gives up when that
 * folder does not exist; whoever ran the command checks that. */
export function downloadedGo(version: string, printed: string): InstalledGo | undefined {
  const root = printed.trim();
  return releaseName.test(version) && path.isAbsolute(root) ? { label: goLabel(version), program: path.join(root, 'bin', programName('go')) } : undefined;
}

/** goEnvironmentStatus.ts `addGoRuntimeBaseToPATH`: the environment with `bin` as the first folder
 * of PATH and nowhere else in it. The extension does this with the `bin` folder of the chosen Go,
 * because gopls and cgo run `go` by name (goInstallTools.ts `updateGoVarsFromConfig`). The result is
 * a new object. An environment without PATH gets one, where the extension changes nothing. */
export function withGoFirst(env: NodeJS.ProcessEnv, bin: string): NodeJS.ProcessEnv {
  if (!bin) return { ...env };
  const name = Object.hasOwn(env, 'PATH') ? 'PATH' : process.platform === 'win32' && Object.hasOwn(env, 'Path') ? 'Path' : 'PATH';
  const stated = env[name], folders = stated ? stated.split(path.delimiter).filter(folder => folder !== bin) : [];
  return { ...env, [name]: [bin, ...folders].join(path.delimiter) };
}
