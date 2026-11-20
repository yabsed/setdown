import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientCapabilities, Range } from 'vscode-languageserver-protocol';
import { setting } from './extension-rules';
import { goToolEnvironment, resolveSettingPath } from './go-check';
import { mergeLanguageSettings } from './language-settings';
import type { ToolAction, ToolRulesFactory, ToolSignal } from './tool-signals';

// How the VS Code Go extension drives gopls beyond starting it: what it declares, which settings
// it passes on, what it does with gopls' code lenses, and which gopls commands its own commands
// send. The rules are carried over from:
//   vendor/vscode-go/extension/src/language/goLanguageServer.ts   capabilities, progress written as a log, settings, code lenses, commands
//   vendor/vscode-go/extension/src/language/goSemanticTokens.ts   gopls' own semantic token modifiers
//   vendor/vscode-go/extension/src/language/form.ts               the capability that was left out (`interactiveResolve`)
//   vendor/vscode-go/extension/src/goImport.ts, goGenerateTests.ts, goModifytags.ts, goPackageOutline.ts,
//     commands/toggleGCDetails.ts, goVulncheck.ts                 the gopls commands the extension's own commands send
//   vendor/vscode-go/extension/src/testUtils.ts, goTest.ts        the `go test` command line
//   vendor/vscode-go/extension/package.json                       the settings, their defaults, the command titles
//   vendor/zed/crates/languages/src/go.rs                         what Zed tells gopls at startup, and its `gopls.run_tests`

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown, limit = 4096): string | undefined => typeof value === 'string' ? value.slice(0, limit) : undefined;
const texts = (value: unknown, most: number): string[] => Array.isArray(value) ? value.slice(0, most).filter((item): item is string => typeof item === 'string' && item.length <= 4096) : [];

// ── What the extension declares ─────────────────────────────────────────────────────────────

/** goSemanticTokens.ts `GOPLS_CUSTOM_TOKEN_MODIFIERS`: token modifiers gopls has beyond the
 * protocol's. Since v0.24.0 gopls leaves out every modifier the editor did not declare, so
 * without these a Go token is never marked by what kind of type it has (`struct`, `map`, …),
 * as a `format` directive inside a string, or as a definition `shadowing` another. The editor's
 * half is the ordinary one: the modifiers arrive in the legend gopls states when it starts. */
export const goplsTokenModifiers = ['array', 'bool', 'chan', 'format', 'interface', 'map', 'number', 'pointer', 'signature', 'slice', 'string', 'struct', 'shadowing'] as const;

/** goLanguageServer.ts `fillInitializeParams`: `experimental.progressMessageStyles`. gopls then
 * starts the progress of a command that writes a log with the message `style: log`, an empty
 * line, and the first text. The editor's half is `GoplsProgressLog`. */
export const goplsProgressStyles = ['log'] as const;

/** What the extension adds to the capabilities every tool is told (`GoSemanticTokensFeature`,
 * `fillInitializeParams`). The token modifiers are added only where semantic tokens are declared
 * at all, as the extension does.
 *
 * Left out: `experimental.interactiveResolve` (form.ts `InteractiveFormsFeature`). With it gopls
 * asks its questions through `command/resolve` and `interactive/listEnum` and expects a form with
 * six kinds of fields in the editor; Setdown has no such form, and without the capability gopls
 * does not ask. */
export function goplsCapabilities(general: ClientCapabilities): ClientCapabilities {
  const semanticTokens = general.textDocument?.semanticTokens;
  return {
    ...general,
    ...semanticTokens ? { textDocument: { ...general.textDocument, semanticTokens: { ...semanticTokens, tokenModifiers: [...new Set([...semanticTokens.tokenModifiers ?? [], ...goplsTokenModifiers])] } } } : {},
    experimental: { ...record(general.experimental), progressMessageStyles: [...goplsProgressStyles] },
  };
}

/** One `$/progress` message of a command whose progress is a log. */
export type GoplsProgress = { token: string | number; title: string; lines: string[]; done: boolean };
const mostLogs = 64;

/** goLanguageServer.ts `handleWorkDoneProgress`: the progress of a command that asked for the log
 * style. The extension opens a terminal named after the progress title and writes each message
 * into it as a line. Here the lines are returned.
 *
 * A progress starts as a log when its first message begins with a paragraph `style: log`. The
 * paragraph after it is the first line; the extension reads no further paragraph. Every message
 * of a later `report` and of the `end` is a line. `follow` adds a progress that did not start
 * that way: the one `gopls.run_govulncheck` answers with (`Token`), whose reports are
 * govulncheck's output. */
export class GoplsProgressLog {
  private readonly titles = new Map<string | number, string>();

  /** `token` is what a command answered as `Token`. Its messages are log lines from now on. */
  follow(token: unknown, title: string): void {
    if ((typeof token === 'string' || typeof token === 'number') && this.titles.size < mostLogs) this.titles.set(token, title);
  }

  /** The parameters of `$/progress`. Nothing for a progress that is no log, which is shown as any other. */
  read(params: unknown): GoplsProgress | undefined {
    const token = record(params)?.token, value = record(record(params)?.value);
    if ((typeof token !== 'string' && typeof token !== 'number') || !value) return undefined;
    const message = text(value.message);
    if (value.kind === 'begin') {
      if (message === undefined) return undefined;
      const paragraphs = message.split('\n\n', 2), style = paragraphs[0].trim();
      if (!style.startsWith('style: ') || style.slice('style: '.length) !== 'log' || this.titles.size >= mostLogs) return undefined;
      const title = text(value.title, 200) || 'gopls';
      this.titles.set(token, title);
      return { token, title, lines: paragraphs.length > 1 ? [paragraphs[1]] : [], done: false };
    }
    const title = this.titles.get(token);
    if (title === undefined || (value.kind !== 'report' && value.kind !== 'end')) return undefined;
    if (value.kind === 'end') this.titles.delete(token);
    return { token, title, lines: message ? [message] : [], done: value.kind === 'end' };
  }

  /** The same as what the person is shown: the title as work in progress until the end, and the lines in the tool's log. */
  signal(params: unknown): ToolSignal | undefined {
    const progress = this.read(params);
    return progress && { progress: { [`gopls log ${progress.token}`]: progress.done ? undefined : progress.title }, log: progress.lines.flatMap(line => line.split('\n').slice(0, 500)).map(line => `${progress.title}: ${line}`) };
  }
}

// ── The settings gopls is sent ──────────────────────────────────────────────────────────────

/** package.json `go.inlayHints.*`: the hints the extension has a setting for. */
export const goInlayHints = ['assignVariableTypes', 'compositeLiteralFields', 'compositeLiteralTypes', 'constantValues', 'functionTypeParameters', 'parameterNames', 'rangeVariableTypes', 'ignoredError'] as const;
/** package.json `go.diagnostic.vulncheck`: its values. `Prompt` is what gopls does by itself. */
export const goVulncheckModes = ['Imports', 'Off', 'Prompt'] as const;
/** goLanguageServer.ts `passInlayHintConfigToGopls`, `passVulncheckConfigToGopls`: an older gopls does not know the option. */
export const goplsOptionSince = { hints: '0.8.4', vulncheck: '0.10.1' } as const;

/** goLanguageServer.ts `getLocalGoplsVersion`: what gopls is asked, and its version in the answer
 * (`Main.Version`: `v0.24.0`, or `(devel)` for one a person built). */
export const goplsVersionArguments = ['version', '-json'] as const;
export function installedGoplsVersion(printed: string): string | undefined {
  try { return text(record(record(JSON.parse(printed))?.Main)?.Version, 100) || undefined; } catch { return undefined; }
}
/** `(semver.parse(version)?.compare(limit) ?? 1) > 0`: a version that is no semantic version
 * counts as newer, and a pre-release of the limit itself does not. */
function newerThan(version: string, limit: string): boolean {
  const parsed = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!parsed) return true;
  const wanted = limit.split('.').map(Number);
  return (Number(parsed[1]) - wanted[0] || Number(parsed[2]) - wanted[1] || Number(parsed[3]) - wanted[2]) > 0;
}

/** goLanguageServer.ts `adjustGoplsWorkspaceConfiguration`: what the extension sends gopls as
 * its settings, both as the initialization options (`buildLanguageClient`) and as the answer to
 * `workspace/configuration` for the section `gopls` (any other section is answered unchanged).
 * The names are the extension's dotted ones.
 *
 * - `filterGoplsDefaultConfigValues` keeps only what the person changed. Here the `gopls` setting
 *   holds nothing else, so it is taken as written.
 * - `passGoConfigToGoplsConfigValues`: `go.buildFlags`, and `-tags` with `go.buildTags` unless the
 *   flags already have `-tags`, become `build.buildFlags`, unless the person wrote that option.
 * - `passInlayHintConfigToGopls`: `go.inlayHints.*` become `ui.inlayhint.hints`. The extension
 *   sends all eight, off where nothing is written, because VS Code fills in its defaults. Here
 *   only the hints a person wrote are sent, and the rest is left to what gopls is told otherwise.
 * - `passVulncheckConfigToGopls`: `go.diagnostic.vulncheck` becomes `ui.vulncheck`.
 *
 * `installed` is `installedGoplsVersion` of the gopls that runs; the last two wait for the
 * versions in `goplsOptionSince`. Without it they are sent: every gopls that `go-tools.ts` or
 * Zed installs is newer.
 *
 * Left out: `linkifyShowMessage`, which makes gopls write links into its messages as Markdown,
 * and `allExperiments`, which only a preview build of the extension sets. */
export function goplsConfiguration(settings: Record<string, unknown> | undefined, installed?: string): Record<string, unknown> {
  const result: Record<string, unknown> = Object.fromEntries(Object.entries(record(setting(settings, 'gopls')) ?? {}).filter(([name]) => !['__proto__', 'constructor', 'prototype'].includes(name)));
  const since = (limit: string) => installed === undefined || newerThan(installed, limit);

  const buildFlags = texts(setting(settings, 'go.buildFlags'), 200), buildTags = setting(settings, 'go.buildTags');
  if (typeof buildTags === 'string' && buildTags && !buildFlags.includes('-tags')) buildFlags.push('-tags', buildTags.slice(0, 4096));
  if (buildFlags.length && result['build.buildFlags'] === undefined) result['build.buildFlags'] = buildFlags;

  const hints = Object.fromEntries(goInlayHints.map(name => [name, setting(settings, `go.inlayHints.${name}`)] as const).filter(([, value]) => typeof value === 'boolean'));
  if (Object.keys(hints).length && since(goplsOptionSince.hints)) result['ui.inlayhint.hints'] = hints;

  const vulncheck = setting(settings, 'go.diagnostic.vulncheck');
  if (goVulncheckModes.some(mode => mode === vulncheck) && since(goplsOptionSince.vulncheck)) result['ui.vulncheck'] = vulncheck;
  return result;
}

/** gopls names an option by the last part of a dotted name: `ui.inlayhint.hints` is `hints`. The
 * extension writes the long names and Zed the short ones (`hints`, `codelenses`, `usePlaceholders`). */
export const goplsOptionName = (name: string) => name.slice(name.lastIndexOf('.') + 1);

/** vendor/zed/crates/languages/src/go.rs `initialization_options`: what Zed tells gopls before a
 * person's `lsp.gopls.initialization_options` are laid over it. `semanticTokens` is whether
 * semantic tokens are on for Go in the editor. */
export const zedGoplsDefaults = (semanticTokens: boolean): Record<string, unknown> => ({
  usePlaceholders: false,
  hints: { assignVariableTypes: true, compositeLiteralFields: true, compositeLiteralTypes: true, constantValues: true, functionTypeParameters: true, parameterNames: true, rangeVariableTypes: true },
  codelenses: { test: true },
  semanticTokens });

/** Several sets of gopls options as one, each laid over the ones before it, under the short
 * names. Options are matched by `goplsOptionName`, because gopls reports two spellings of one
 * option in one message as a duplicate; an option that is a list of named switches (`hints`,
 * `codelenses`) is merged switch by switch, as Zed merges a person's options into its own.
 *
 * `goplsOptions(zedGoplsDefaults(…), goplsConfiguration(settings))` is everything gopls should
 * hold. gopls replaces a whole option when it is sent again, so the answer to
 * `workspace/configuration` has to be this whole set as well, not only what the person wrote. */
export function goplsOptions(...layers: (Record<string, unknown> | undefined)[]): Record<string, unknown> {
  return mergeLanguageSettings(...layers.map(layer => layer && Object.fromEntries(Object.entries(layer).map(([name, value]) => [goplsOptionName(name), value] as const))));
}

/** goVulncheck.ts `toggleVulncheckCommand`, the command "Go: Toggle Vulncheck": `Imports` becomes
 * `Off` and anything else `Imports`. gopls reads the setting as it changes. */
export function vulncheckToggle(settings: Record<string, unknown> | undefined): ToolAction {
  return { title: 'Go: Toggle Vulncheck', setting: { name: 'go.diagnostic.vulncheck', value: setting(settings, 'go.diagnostic.vulncheck') === 'Imports' ? 'Off' : 'Imports' } };
}

// ── Code lenses that run tests ──────────────────────────────────────────────────────────────

/** The command of gopls' code lenses "run test", "run benchmark" and "run file benchmarks". Its
 * one argument is `{ URI, Tests, Benchmarks }` (vendor/zed/crates/languages/src/go.rs
 * `go_test_task_template` reads it so). */
export const goplsRunTests = 'gopls.run_tests';
/** package.json `go.testTimeout`. */
export const goTestTimeoutDefault = '30s';
/** A test in a terminal. `file` is the test file: the extension saves it before the test runs (goTest.ts `testAtCursor`). */
export type GoTestRun = { cwd: string; program: 'go'; args: string[]; file: string; label: string };
/** A Go function name, which is all a lens names. It is written into a pattern, so nothing else may pass. */
const functionName = /^[\p{L}_][\p{L}\p{N}_]{0,199}$/u;
const pattern = (names: string[]) => names.length === 1 ? `^${names[0]}$` : `^(${names.join('|')})$`;

/** What a "run test" or "run benchmark" lens of gopls runs in Setdown's terminal.
 *
 * In VS Code the lens is replaced: goLanguageServer.ts `provideCodeLenses` turns "run test" into
 * the extension's `go.test.cursor` and a "debug test" lens (`createTestCodeLens`), because the
 * extension runs tests itself and shows them in its test explorer; `gopls.run_tests` would only
 * report progress. The rewrite reads the arguments as `[file, tests[], benchmarks[]]`. Today's
 * gopls sends one object, which this function reads; the older form is read as well.
 *
 * The command line is the one `go.test.cursor` builds (testUtils.ts `computeTestCommand`,
 * `targetArgs`), in the folder of the test file (goTest.ts `runTestAtCursor`):
 *   go test -test.fullpath=true
 *     -timeout <go.testTimeout>      for tests; `-benchmem -run=^$` when only benchmarks run
 *     -tags <go.testTags, or go.buildTags when that is not written>   unless the person's flags have -tags
 *     -run ^Name$                    `^(A|B)$` for several
 *     -bench ^Name$
 *     .                              this package, as Zed's own handling of the lens writes it
 *     <go.testFlags, or go.buildFlags when there are none>, without a `-run` of their own when -run is used
 *     <what follows -args in those flags>
 *
 * Left out: the import path `go list` gives, which the extension names in place of `.`; `-json`,
 * which the extension adds for `-v` and then reads itself; coverage (`go.coverOnSingleTest`);
 * and testify's suite methods, which gopls' lenses do not name. */
export function goTestCommand(command: string, args: unknown, settings?: Record<string, unknown>, facts: { workspace?: string; home?: string } = {}): GoTestRun | undefined {
  if (command !== goplsRunTests || !Array.isArray(args)) return undefined;
  const given: unknown[] = args, named = record(given[0]);
  const uri = named ? named.URI : given[0], tests = texts(named ? named.Tests : given[1], 500), benchmarks = texts(named ? named.Benchmarks : given[2], 500);
  if (typeof uri !== 'string' || !/^file:/i.test(uri) || (!tests.length && !benchmarks.length) || ![...tests, ...benchmarks].every(name => functionName.test(name))) return undefined;
  let file: string;
  try { file = fileURLToPath(uri); } catch { return undefined; }

  const written = texts(setting(settings, 'go.testFlags'), 200), flags = (written.length ? written : texts(setting(settings, 'go.buildFlags'), 200)).map(flag => resolveSettingPath(flag, facts.workspace, facts.home));
  const split = flags.indexOf('-args'), own = split < 0 ? flags : flags.slice(0, split), passed = split < 0 ? [] : flags.slice(split);
  const result = ['test', '-test.fullpath=true'];
  if (tests.length) { const timeout = setting(settings, 'go.testTimeout'); result.push('-timeout', typeof timeout === 'string' && timeout ? timeout.slice(0, 100) : goTestTimeoutDefault); }
  else result.push('-benchmem', '-run=^$');
  const testTags = setting(settings, 'go.testTags'), tags = testTags !== undefined && testTags !== null ? testTags : setting(settings, 'go.buildTags');
  if (typeof tags === 'string' && tags && !own.includes('-tags')) result.push('-tags', tags.slice(0, 4096));
  if (tests.length) result.push('-run', pattern(tests));
  if (benchmarks.length) result.push('-bench', pattern(benchmarks));
  result.push('.');
  // testUtils.ts `removeRunFlag`: "ignore user provided -run flag if we are already using it".
  if (result.includes('-run') && own.includes('-run')) own.splice(own.indexOf('-run'), 2);
  return { cwd: path.dirname(file), program: 'go', args: [...result, ...own, ...passed], file, label: tests.length ? `go test ${tests.join(', ')}` : `go bench ${benchmarks.join(', ')}` };
}

/** testUtils.ts `getTestEnvVars`: the environment a test runs in. It is the environment of a Go
 * tool (`goToolEnvironment`) with each entry of `go.testEnvVars` added, `${workspaceFolder}` and
 * `~` resolved. Left out: `go.testEnvFile`, a file of further entries read before these. */
export function goTestEnvironment(env: NodeJS.ProcessEnv, settings: Record<string, unknown> | undefined, facts: { workspace?: string; home?: string } = {}): NodeJS.ProcessEnv {
  const result = goToolEnvironment(env, settings, facts);
  for (const [name, value] of Object.entries(record(setting(settings, 'go.testEnvVars')) ?? {})) {
    if (!name || /[=\0]/.test(name)) continue;
    if (typeof value === 'string') result[name] = resolveSettingPath(value, facts.workspace, facts.home);
    else if (typeof value === 'number' || typeof value === 'boolean') result[name] = String(value);
  }
  return result;
}

// ── gopls commands ──────────────────────────────────────────────────────────────────────────

export type GoplsCommandContext = {
  /** The document in the editor, as the URI gopls knows it by. */
  uri: string;
  /** The selection, or the cursor as an empty range. */
  range?: Range;
  /** The Go settings of the project, by their VS Code names. */
  settings?: Record<string, unknown>;
  /** What the person chose or typed, for a command with a `chooser`. */
  chosen?: string;
};

/** What a person is asked before a command can be sent. `pick`: the gopls command `from` is sent
 * first with `arguments`, `items` reads the choices from its answer, and the person picks one.
 * `text`: the person types it. */
export type GoplsChooser = { what: string } & (
  | { kind: 'pick'; from: string; arguments(context: GoplsCommandContext): unknown[]; items(result: unknown): string[] }
  | { kind: 'text' });

export type GoplsCommand = {
  /** The gopls command, sent with `workspace/executeCommand`. */
  command: string;
  /** For a list of commands. */
  title: string;
  /** `extension`: one of the extension's own commands sends it, and `menu` is that command's name in
   * VS Code. `lens`: gopls offers it as a code lens, switched by `lens` in gopls' `codelenses`
   * option, and the extension sends it on with the arguments the lens carries. */
  origin: 'extension' | 'lens';
  menu?: string;
  lens?: string;
  /** The `arguments` of the request, for a command of the extension. Nothing when the document,
   * the selection or a choice the command needs is missing. A lens command has none: its lens carries them. */
  arguments?(context: GoplsCommandContext): unknown[] | undefined;
  /** Asked when `arguments` gives nothing without `chosen`. */
  chooser?: GoplsChooser;
  /** Every changed file is saved before the command is sent (goLanguageServer.ts `executeCommand`). */
  saveAll: boolean;
  /** Not sent to gopls here: `goTestCommand` makes a terminal command of it. */
  terminal?: true;
  /** What gopls answers and what is done with it. */
  result: string;
};

const selection = (context: GoplsCommandContext) => context.uri.endsWith('.go') && context.range ? { URI: context.uri, range: context.range } : undefined;
const tagSettings = (context: GoplsCommandContext, name: string): Record<string, unknown> => { const written = record(setting(context.settings, name)); return !written || written.promptForTags === true ? {} : written; };

/** goImport.ts `golist`: the answer of `gopls.list_known_packages`, `{ Packages: string[] }`. */
export function knownPackages(result: unknown): string[] {
  return texts(record(result)?.Packages, 50_000).filter(name => name.length > 0 && name.length <= 1024);
}

/** The gopls commands the extension sends or passes on, with what happens around each. A command
 * of gopls that is not listed is sent as its lens or code action carries it, nothing is saved
 * first, and its answer is not used. */
export const goplsCommands: readonly GoplsCommand[] = [
  { command: 'gopls.add_import', title: 'Go: Add Import', origin: 'extension', menu: 'go.import.add', saveAll: false,
    // goImport.ts `addImport`: `{ ImportPath, URI }`, the path chosen from `gopls.list_known_packages` of the same document.
    arguments: context => context.chosen ? [{ ImportPath: context.chosen, URI: context.uri }] : undefined,
    chooser: { kind: 'pick', what: 'The package to import', from: 'gopls.list_known_packages', arguments: context => [{ URI: context.uri }], items: knownPackages },
    result: 'Nothing. gopls adds the import to the file itself.' },
  { command: 'gopls.add_test', title: 'Go: Generate Unit Tests For Function', origin: 'extension', menu: 'go.test.generate.function', saveAll: false,
    // goGenerateTests.ts `goplsGenerateTest`: `{ URI, range }`, the selection in the function to test.
    arguments: context => { const at = selection(context); return at && [at]; },
    result: 'Nothing. gopls writes the test into the package\'s test file itself and shows it.' },
  { command: 'gopls.modify_tags', title: 'Go: Add Tags To Struct Fields', origin: 'extension', menu: 'go.add.tags', saveAll: false,
    // goModifytags.ts `addTags`: `go.addTags` unless it says `promptForTags`. With neither tags nor
    // options gopls would ask through its form; here the person types the tags.
    arguments: context => {
      const at = selection(context), written = tagSettings(context, 'go.addTags'), add = context.chosen ?? text(written.tags), addOptions = text(written.options);
      return at && (add || addOptions) ? [{ ...at, modification: 'add', add, addOptions, transform: text(written.transform), valueFormat: text(written.template) }] : undefined;
    },
    chooser: { kind: 'text', what: 'Tags to add, separated by commas, for example json,xml' },
    result: 'Nothing. gopls changes the struct itself.' },
  { command: 'gopls.modify_tags', title: 'Go: Remove Tags From Struct Fields', origin: 'extension', menu: 'go.remove.tags', saveAll: false,
    // goModifytags.ts `removeTags`.
    arguments: context => {
      const at = selection(context), written = tagSettings(context, 'go.removeTags'), remove = context.chosen ?? text(written.tags), removeOptions = text(written.options);
      return at && (remove || removeOptions) ? [{ ...at, modification: 'remove', remove, removeOptions }] : undefined;
    },
    chooser: { kind: 'text', what: 'Tags to remove, separated by commas, for example json,xml' },
    result: 'Nothing. gopls changes the struct itself.' },
  { command: 'gopls.gc_details', title: 'Go: Toggle compiler optimization details', origin: 'extension', menu: 'go.toggle.gc_details', saveAll: false,
    // commands/toggleGCDetails.ts: the one argument is the document's URI itself, not an object, and the document is a Go file.
    arguments: context => context.uri.endsWith('.go') ? [context.uri] : undefined,
    result: 'Nothing. gopls then reports, or no longer reports, the compiler\'s optimization decisions for the package as diagnostics.' },
  { command: 'gopls.package_symbols', title: 'Package Outline', origin: 'extension', menu: 'go.package.outline', saveAll: false,
    // goPackageOutline.ts `reload`: sent for a Go file on disk when it becomes the document in the editor and when it is saved.
    arguments: context => /^file:.*\.go$/i.test(context.uri) ? [{ URI: context.uri }] : undefined,
    result: '{ PackageName, Files: the package\'s files as URIs, Symbols: document symbols, each with `file`, an index into Files }. '
      + 'The extension shows them as a tree, by position or by name. A failure is not shown.' },
  { command: 'gopls.tidy', title: 'Tidy go.mod file', origin: 'lens', lens: 'tidy', saveAll: true,
    result: 'Nothing. gopls runs go mod tidy and reports progress.' },
  { command: 'gopls.vendor', title: 'Update vendor directory', origin: 'lens', lens: 'vendor', saveAll: false,
    result: 'Nothing. gopls runs go mod vendor and reports progress.' },
  { command: 'gopls.upgrade_dependency', title: 'Update dependencies', origin: 'lens', lens: 'upgrade_dependency', saveAll: false,
    result: 'Nothing. gopls runs go get and changes go.mod.' },
  { command: 'gopls.generate', title: 'Run go generate', origin: 'lens', lens: 'generate', saveAll: false,
    result: 'Nothing. gopls runs go generate and reports progress.' },
  { command: 'gopls.regenerate_cgo', title: 'Re-generate cgo declarations', origin: 'lens', lens: 'regenerate_cgo', saveAll: false,
    result: 'Nothing. gopls runs cgo again and reports progress.' },
  { command: 'gopls.run_govulncheck', title: 'Run govulncheck (legacy)', origin: 'lens', lens: 'run_govulncheck', saveAll: true,
    result: '{ Token }, at once. The token is a progress whose reports are govulncheck\'s output: `GoplsProgressLog.follow`. It ends with the message `completed` when there is a result. '
      + 'The extension refuses a second run while one is going.' },
  { command: 'gopls.vulncheck', title: 'Run govulncheck', origin: 'lens', lens: 'vulncheck', saveAll: true,
    result: '{ Result, Token }, when govulncheck has finished. The token is a progress in the log style, which `GoplsProgressLog` reads by itself.' },
  { command: goplsRunTests, title: 'Run tests and benchmarks', origin: 'lens', lens: 'test', saveAll: false, terminal: true,
    result: 'Not sent. `goTestCommand` gives the go test command for the terminal, and the test file is saved first.' },
];

/** The entries for a gopls command: one, or the two that send `gopls.modify_tags`. */
export const goplsCommand = (command: string): GoplsCommand[] => goplsCommands.filter(entry => entry.command === command);

/** goLanguageServer.ts `toServerInfo`: the commands gopls said it has when it started
 * (`capabilities.executeCommandProvider.commands` of its `initialize` answer). The extension
 * sends `gopls.add_import`, `gopls.list_known_packages` and `gopls.add_test` only when they are listed. */
export function goplsHasCommand(capabilities: unknown, command: string): boolean {
  return texts(record(record(capabilities)?.executeCommandProvider)?.commands, 1000).includes(command);
}

/** goLanguageServer.ts `executeCommand`: what the person is told when a command fails. Nothing for
 * `gopls.package_symbols`, which is sent without anyone asking. */
export function goplsCommandFailure(command: string, error: unknown): string | undefined {
  return command === 'gopls.package_symbols' ? undefined : `Command '${command}' failed: ${String(error)}.`.slice(0, 4096);
}

/** goLanguageServer.ts `executeCommand`: "cannot start vulncheck while another vulncheck is in progress". */
export const govulncheckBusy = 'cannot start vulncheck while another vulncheck is in progress';
/** The answer of a command that reports through a progress: its `Token`, for `GoplsProgressLog.follow`. */
export function goplsProgressToken(result: unknown): string | number | undefined {
  const token = record(result)?.Token;
  return typeof token === 'string' || typeof token === 'number' ? token : undefined;
}
/** The end of a followed govulncheck progress (goLanguageServer.ts, the listener of
 * `onDidChangeVulncheckResult`): `completed` means gopls holds a result, and anything else is
 * shown as `terminated without result: …`. */
export const govulncheckEnd = (message: string | undefined): string | undefined => message === 'completed' ? undefined : `terminated without result: ${message}`;

// ── The rules of a running gopls ────────────────────────────────────────────────────────────

/** Everything gopls is told where Setdown's own client runs it: the person's settings, over the
 * one option the extension makes up for by itself. vscode-go shows "run test" above every test
 * with a lens of its own (goRunTestCodelens.ts, `go.enableCodeLens.runtest`, on unless switched
 * off); gopls shows the same lens when its `test` lens is on, as Zed turns it on (`zedGoplsDefaults`). */
export const goplsOwnOptions = (settings: Record<string, unknown> | undefined): Record<string, unknown> =>
  goplsOptions({ codelenses: { test: setting(settings, 'go.enableCodeLens.runtest') !== false } }, goplsConfiguration(settings));

/** What the extension declares and sends when gopls starts, and its log-style progress.
 * `initializationOptions` are under gopls' short names, so that they land on the options Zed
 * sends and not beside them. */
export const goplsRules: ToolRulesFactory = context => {
  const log = new GoplsProgressLog();
  return {
    capabilities: goplsCapabilities,
    initializationOptions: goplsOwnOptions(context.settings),
    notifications: { '$/progress': params => log.signal(params) },
  };
};
