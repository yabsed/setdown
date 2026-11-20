import { copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { setting } from './extension-rules';
import { installGoTool, type GoToolInstall } from './go-tools';
import { goOlder, goVersionNumbers, readGoVersion } from './go-versions';

// The Go tools the VS Code Go extension knows besides gopls: what each is for, where its source is,
// which version an old Go still builds, and which of them a configuration needs. gopls itself is in
// `go-tools.ts`. The rules are carried over from:
//   vendor/vscode-go/extension/src/goToolsInformation.ts   the table (`allToolsInformation`)
//   vendor/vscode-go/extension/src/goTools.ts              the version of a tool for a Go (`getImportPathWithVersion`), the tools a configuration needs (`getRequiredTools`)
//   vendor/vscode-go/extension/src/language/legacy/goFormat.ts   which tool `go.formatTool` names (`getFormatTool`)
//   vendor/vscode-go/extension/src/goInstallTools.ts       what a person is told about a missing tool (`promptForMissingTool`), how a `-v2` tool is installed (`installTools`)

export type GoTool = {
  name: string;
  /** What `go install` is given, before `@version`. */
  importPath: string;
  modulePath: string;
  /** What the tool is for, in the extension's words. */
  description: string;
  /** `isImportant`: the extension installs a missing one without asking when it starts
   * (goInstallTools.ts `maybeInstallImportantTools`). Setdown asks first. */
  important: boolean;
  /** gopls does what this tool did, so with gopls in use the extension does not ask for it. */
  replacedByGopls: boolean;
  /** What goes after `@` when no row of `goToolPins` applies. `latest` when not given. */
  defaultVersion?: string;
  /** The oldest Go the tool is offered for, as the table writes it (`1.20`). */
  minimumGo?: string;
  /** Set for a tool Setdown must never install, with the reason. */
  neverInstalled?: string;
};

/** goToolsInformation.ts `allToolsInformation` without its gopls entry, in the table's order. */
export const goToolTable: readonly GoTool[] = [
  { name: 'goplay', importPath: 'github.com/haya14busa/goplay/cmd/goplay', modulePath: 'github.com/haya14busa/goplay', replacedByGopls: false, important: false, description: 'The Go playground', defaultVersion: 'v1.0.0' },
  { name: 'impl', importPath: 'github.com/josharian/impl', modulePath: 'github.com/josharian/impl', replacedByGopls: false, important: false, description: 'Stubs for interfaces', defaultVersion: 'v1.5.0' },
  { name: 'gofumpt', importPath: 'mvdan.cc/gofumpt', modulePath: 'mvdan.cc/gofumpt', replacedByGopls: false, important: false, description: 'Formatter', defaultVersion: 'v0.10.0' },
  { name: 'goimports', importPath: 'golang.org/x/tools/cmd/goimports', modulePath: 'golang.org/x/tools', replacedByGopls: false, important: true, description: 'Formatter' },
  { name: 'gotests', importPath: 'github.com/cweill/gotests/gotests', modulePath: 'github.com/cweill/gotests', replacedByGopls: true, important: false, description: 'Generate unit tests', minimumGo: '1.9', defaultVersion: 'v1.6.0' },
  { name: 'golint', importPath: 'golang.org/x/lint/golint', modulePath: 'golang.org/x/lint', replacedByGopls: false, important: false, description: 'Linter', minimumGo: '1.9' },
  { name: 'staticcheck', importPath: 'honnef.co/go/tools/cmd/staticcheck', modulePath: 'honnef.co/go/tools', replacedByGopls: false, important: true, description: 'Linter' },
  { name: 'golangci-lint', importPath: 'github.com/golangci/golangci-lint/cmd/golangci-lint', modulePath: 'github.com/golangci/golangci-lint', replacedByGopls: false, important: true, description: 'Linter', minimumGo: '1.20' },
  { name: 'golangci-lint-v2', importPath: 'github.com/golangci/golangci-lint/v2/cmd/golangci-lint', modulePath: 'github.com/golangci/golangci-lint/v2', replacedByGopls: false, important: true, description: 'Linter', minimumGo: '1.26', defaultVersion: 'v2.15.0' },
  { name: 'revive', importPath: 'github.com/mgechev/revive', modulePath: 'github.com/mgechev/revive', replacedByGopls: false, important: true, description: 'Linter', defaultVersion: 'v1.15.0' },
  // Delve is what the extension debugs with, and nothing else in the extension runs it. Setdown has
  // no debugger, so an installed dlv would never be started.
  { name: 'dlv', importPath: 'github.com/go-delve/delve/cmd/dlv', modulePath: 'github.com/go-delve/delve', replacedByGopls: false, important: false, description: 'Go debugger (Delve)', minimumGo: '1.18',
    neverInstalled: 'Delve is the Go debugger, and Setdown has no debugger.' },
  // vscgo is the extension's own helper. The extension builds it into its own folder, at the
  // extension's own version, and uses it to count telemetry for the Go team (goInstallTools.ts
  // `maybeInstallVSCGO`, goTelemetry.ts). Setdown is not that extension and counts nothing for it.
  { name: 'vscgo', importPath: 'github.com/golang/vscode-go/vscgo', modulePath: 'github.com/golang/vscode-go/vscgo', replacedByGopls: false, important: false, description: 'VS Code Go helper program', minimumGo: '1.18',
    neverInstalled: 'vscgo is the telemetry helper of the VS Code Go extension, which Setdown is not.' },
];

/** A table row by the tool's name. goTools.ts `getTool` reads `staticcheck@v0.4.7` as `staticcheck`. */
export const goTool = (name: string): GoTool | undefined => goToolTable.find(tool => tool.name === name.split('@')[0]);

/** goTools.ts `getImportPathWithVersion`, the rows of every tool but gopls (those are `goplsPins`
 * in `go-tools.ts`): a Go older than `below` gets `version`, the last one that Go can build. The
 * first row that applies is used. */
export const goToolPins: Readonly<Record<string, readonly { below: string; version: string }[]>> = {
  dlv: [{ below: '1.19', version: 'v1.20.2' }, { below: '1.21', version: 'v1.22.1' }],
  staticcheck: [{ below: '1.19', version: 'v0.3.3' }, { below: '1.21', version: 'v0.4.7' }],
  gofumpt: [{ below: '1.19', version: 'v0.4.0' }, { below: '1.20', version: 'v0.5.0' }, { below: '1.22', version: 'v0.6.0' }, { below: '1.23', version: 'v0.7.0' }, { below: '1.24', version: 'v0.8.0' }, { below: '1.25', version: 'v0.9.0' }],
  'golangci-lint': [{ below: '1.20', version: 'v1.53.3' }, { below: '1.21', version: 'v1.55.2' }],
  'golangci-lint-v2': [{ below: '1.26', version: 'v2.12.2' }],
};

/** goTools.ts `getImportPathWithVersion`: what to write after `@` for this Go, given as
 * `go env GOVERSION` states it. A pinned row first, then the table's `defaultVersion`, then `latest`.
 * An install is given the Go that installs; the text for installing by hand, the project's Go. */
export function goToolVersion(tool: GoTool, goVersion: string | undefined): string {
  const go = readGoVersion(goVersion);
  return (Object.hasOwn(goToolPins, tool.name) ? goToolPins[tool.name] : []).find(pin => goOlder(go, pin.below))?.version ?? tool.defaultVersion ?? 'latest';
}

/** The processors goTools.ts `getRequiredTools` asks for Delve on. */
export const delveProcessors = /^(mips|mipsel|ppc64|s390|s390x|x64|arm64)$/;

/** language/legacy/goFormat.ts `getFormatTool`: the tool `go.formatTool` names. Nothing when it is
 * unset or `default`, because gopls then formats; `custom` names the `customFormatter` a person
 * states the file of. */
export function goFormatTool(settings: Record<string, unknown> | undefined): string {
  const tool = setting(settings, 'go.formatTool');
  if (typeof tool !== 'string' || tool === 'default') return '';
  return tool === 'custom' ? 'customFormatter' : tool;
}

/** goTools.ts `getRequiredTools` with gopls in use: the tools this configuration needs, gopls
 * itself aside. Always `impl` and `goplay`; Delve on the processors it supports; the formatter of
 * `go.formatTool` and the linter of `go.lintTool` when they name a table row. `gotests` is in the
 * extension's first list and falls out again because gopls replaces it. A name the table does not
 * have (`gofmt`, a person's own linter) is passed over, as the extension does.
 *
 * The answer is the extension's, so it can hold a row marked `neverInstalled`; whoever installs
 * leaves those out. */
export function requiredGoTools(settings: Record<string, unknown> | undefined, processor: string = process.arch): GoTool[] {
  const lint = setting(settings, 'go.lintTool');
  const names = new Set<string>(['gotests', 'impl', 'goplay', ...delveProcessors.test(processor) ? ['dlv'] : [], goFormatTool(settings), ...typeof lint === 'string' && lint ? [lint] : []]);
  return [...names].map(name => goToolTable.find(tool => tool.name === name)).filter((tool): tool is GoTool => !!tool && !tool.replacedByGopls);
}

/** What a person is told about a tool that was asked for and is not installed, and whether
 * installing it can be offered. `command` is what the offer runs, written out. */
export type MissingGoTool = { name: string; tool?: GoTool; message: string; command?: string };

/** goInstallTools.ts `promptForMissingTool`, up to the question. `projectGoVersion` is the Go the
 * project is built with, as `go env GOVERSION` states it in the project's folder; `searched` is the
 * PATH that was looked in.
 *
 * A tool the table does not know is only reported. A project whose Go is older than the tool's
 * `minimumGo` is told so and offered nothing. Otherwise the message names the command, and the
 * extension shows it with an "Install" button. A row marked `neverInstalled` is reported with
 * Setdown's reason. */
export function missingGoTool(name: string, projectGoVersion: string | undefined, searched = ''): MissingGoTool {
  const tool = goTool(name);
  if (!tool) return { name, message: `${name} is not found. Please make sure it is installed and available in the PATH ${searched}`.trim() };
  if (tool.neverInstalled) return { name: tool.name, tool, message: `${tool.name} is not installed by Setdown. ${tool.neverInstalled}` };
  const go = readGoVersion(projectGoVersion);
  if (tool.minimumGo && goOlder(go, tool.minimumGo)) {
    return { name: tool.name, tool, message: `You are using go${goVersionNumbers(go)}, but ${tool.name} requires at least go${goVersionNumbers(readGoVersion(`go${tool.minimumGo}`))}.` };
  }
  const command = `go install -v ${tool.importPath}@${goToolVersion(tool, projectGoVersion)}`;
  return { name: tool.name, tool, command, message: `The "${tool.name}" command is not available. Run "${command}" to install.` };
}

/** The name `go install` gives the program of a tool whose table name ends in `-v2`, `-v3`, …:
 * goInstallTools.ts `installTools` reads it with `^(?<tool>.+)-v\d+$`. Nothing for any other tool. */
export const sharedProgramName = (tool: string): string | undefined => /^(.+)-v\d+$/.exec(tool)?.[1];

/** Installs one table tool into `destination` with `installGoTool` of `go-tools.ts`, at
 * `goToolVersion` of the Go that installs, and returns the program's file. The same refusals apply:
 * no install with a Go older than `minimumGoForInstall`.
 *
 * goInstallTools.ts `installTools`: `go install` names the program after the last part of the import
 * path, so `golangci-lint-v2` would be written over `golangci-lint`. The extension installs such a
 * tool into `tmp` under the destination, copies the program out under the table's name and removes
 * `tmp`. Two of these at once would share that folder; install one after the other.
 *
 * A row marked `neverInstalled` is refused. */
export async function installTableTool(options: Omit<GoToolInstall, 'tool'> & { tool: GoTool }): Promise<string> {
  const { tool, destination } = options;
  if (tool.neverInstalled) throw new Error(`${tool.name} was not installed: ${tool.neverInstalled}`);
  const version = goToolVersion(tool, options.go.GOVERSION), shared = sharedProgramName(tool.name);
  if (!shared) return installGoTool({ ...options, tool: { name: tool.name, importPath: tool.importPath, version } });
  const temporary = path.join(destination, 'tmp');
  try {
    const built = await installGoTool({ ...options, destination: temporary, tool: { name: shared, importPath: tool.importPath, version } });
    const file = path.join(destination, tool.name + path.extname(built));
    await copyFile(built, file);
    return file;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
