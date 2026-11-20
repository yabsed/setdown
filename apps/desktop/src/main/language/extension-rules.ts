import path from 'node:path';
import { statSync } from 'node:fs';
import type { ClientCapabilities, Diagnostic, PublishDiagnosticsParams } from 'vscode-languageserver-protocol';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import type { LanguageAutoInsert } from '../../protocol/language';
import { clientCommands, toolRequest, type ToolFamily } from '../../protocol/language-tools';
import { mergeLanguageSettings } from './language-settings';

// A tool's own editor extension does more than start it: it tells it things at startup, asks
// it things the protocol has no name for, and restarts it when certain files change. The
// rules in this file are carried over from those extensions. Each one names the file it came
// from, so a newer `vendor/` can be compared against it:
//   vendor/vscode/extensions/html-language-features/client/src/htmlClient.ts     html/autoInsert
//   vendor/vscode/extensions/html-language-features/client/src/autoInsertion.ts  which settings turn it off
//   vendor/svelte-language-tools/packages/svelte-vscode/src/extension.ts         Svelte startup options, restart files, html/tag
//   vendor/svelte-language-tools/packages/svelte-vscode/src/tsplugin.ts          when the Svelte TypeScript plugin is on
//   vendor/vscode/extensions/typescript-language-features/src/configuration/configuration.ts   tsserver memory, type acquisition, npm, locale
//   vendor/vscode-clangd/src/switch-source-header.ts                             textDocument/switchSourceHeader
//   vendor/vscode-clangd/src/inactive-regions.ts                                 inactive regions: the capability and the notification
//   vendor/zed/crates/project/src/lsp_store/clangd_ext.rs, languages/src/c.rs    inactive regions as faded entries beside the tool's own
//   vendor/rust-analyzer/editors/code/src/client.ts, ctx.ts                      server status: the capability and what is shown
//   vendor/rust-analyzer/docs/book/src/contributing/lsp-extensions.md            what a server status means
//   vendor/zed/crates/project/src/lsp_store/rust_analyzer_ext.rs                 server status as the server's health
//   vendor/rust-analyzer/editors/code/src/client.ts `ExperimentalFeatures`       commands the editor runs, hover actions, local docs
//   vendor/vscode-clangd/src/clangd-context.ts                                   edits near the cursor, file status, fallback flags
//   vendor/vscode-clangd/src/file-status.ts                                      what a file status is shown as

type Tool = Pick<LanguageServerDefinition, 'id' | 'launch' | 'provenance'>;
type Settings = Record<string, unknown>;
const record = (value: unknown): Settings | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Settings : undefined;
/** A setting by its VS Code name. People write `{"html": {"autoClosingTags": false}}` and `{"html.autoClosingTags": false}`. */
export function setting(settings: Settings | undefined, name: string): unknown {
  if (!settings) return undefined;
  if (Object.hasOwn(settings, name)) return settings[name];
  const parts = name.split('.');
  // The longest written prefix wins: `{"typescript.tsserver": {"maxTsServerMemory": 1}}` is also a way to write it.
  for (let length = parts.length - 1; length > 0; length--) {
    const head = parts.slice(0, length).join('.');
    if (Object.hasOwn(settings, head)) { const found = setting(record(settings[head]), parts.slice(length).join('.')); if (found !== undefined) return found; }
  }
  return undefined;
}
/** The settings with one more written, by its VS Code name. An exact dotted key the person wrote
 * is replaced; otherwise the value goes into the nested form, which is what a tool is sent when
 * it asks for a section (`configurationSection`). */
export function withSetting(settings: Settings | undefined, name: string, value: unknown): Settings {
  const result: Settings = { ...settings };
  if (Object.hasOwn(result, name)) { result[name] = value; return result; }
  const parts = name.split('.').filter(part => !['__proto__', 'constructor', 'prototype'].includes(part));
  if (!parts.length) return result;
  // The longest written dotted prefix is kept as the person wrote it.
  for (let length = parts.length - 1; length > 0; length--) {
    const head = parts.slice(0, length).join('.');
    if (Object.hasOwn(result, head) && record(result[head])) { result[head] = withSetting(record(result[head]), parts.slice(length).join('.'), value); return result; }
  }
  result[parts[0]] = parts.length === 1 ? value : withSetting(record(result[parts[0]]), parts.slice(1).join('.'), value);
  return result;
}
/** The names a tool goes by: its id here, its name in the catalog it was imported from, and its program. */
function named(tool: Tool, ...names: string[]): boolean {
  const program = tool.launch.kind === 'native' ? path.basename(tool.launch.command).replace(/\.(exe|cmd)$/i, '') : undefined;
  return [tool.id, tool.provenance?.profile, program].some(name => !!name && names.includes(name));
}
export const isHtmlServer = (tool: Tool) => named(tool, 'html-lsp', 'vscode-html-language-server');
export const isSvelteServer = (tool: Tool) => named(tool, 'svelte-language-server', 'svelteserver');
export const isTypeScriptServer = (tool: Tool) => named(tool, 'typescript-language-server');
export const isClangd = (tool: Tool) => named(tool, 'clangd');
export const isJsonServer = (tool: Tool) => named(tool, 'json-lsp', 'vscode-json-language-server', 'json-language-server');
export const isKotlinServer = (tool: Tool) => named(tool, 'kotlin-lsp');
export const isGopls = (tool: Tool) => named(tool, 'gopls');
export const isRustAnalyzer = (tool: Tool) => named(tool, 'rust-analyzer');
const families: readonly [ToolFamily, (tool: Tool) => boolean][] = [
  ['rust-analyzer', isRustAnalyzer], ['clangd', isClangd], ['svelte', isSvelteServer], ['typescript', isTypeScriptServer],
  ['gopls', isGopls], ['jdtls', tool => named(tool, 'jdtls')], ['kotlin', isKotlinServer], ['intelephense', tool => named(tool, 'intelephense')],
  ['pyright', tool => named(tool, 'pyright', 'basedpyright', 'basedpyright-langserver', 'pyright-langserver')], ['json', isJsonServer],
  ['yaml', tool => named(tool, 'yaml-language-server')], ['html', isHtmlServer], ['css', tool => named(tool, 'css-lsp', 'vscode-css-language-server')],
];
/** The extension whose behaviour a tool is given (`protocol/language-tools.ts`), or none. */
export const toolFamily = (tool: Tool | undefined): ToolFamily | undefined => tool && families.find(([, is]) => is(tool))?.[0];

/** What a tool does only for an editor that says it can take it.
 * clangd names the lines the preprocessor leaves out once `inactiveRegionsCapabilities` is
 * declared (inactive-regions.ts `fillClientCapabilities`; Zed declares the same in c.rs), and
 * with `editsNearCursor` it offers completions that also change text beside the cursor, such as
 * `.` to `->` on a pointer (clangd-context.ts `EnableEditsNearCursorFeature`).
 * rust-analyzer reports its standing status once `serverStatusNotification` is declared
 * (client.ts `fillClientCapabilities`; Zed's lsp.rs); without it, it shows a problem once as a
 * passing message (main_loop.rs). It offers run, references and go-to links in code lenses and
 * hovers only for the commands its editor says it can run (`commands`, `hoverActions`), and the
 * documentation built on this computer beside the web one with `localDocs`.
 * Undefined: the tool is told what every tool is told. */
export function toolCapabilities(tool: Tool, general: ClientCapabilities): ClientCapabilities | undefined {
  if (isClangd(tool)) return { ...general, textDocument: { ...general.textDocument, completion: { ...general.textDocument?.completion, editsNearCursor: true },
    inactiveRegionsCapabilities: { inactiveRegions: true } } as ClientCapabilities['textDocument'] };
  if (isRustAnalyzer(tool)) return { ...general, experimental: { ...record(general.experimental), serverStatusNotification: true,
    hoverActions: true, localDocs: true, commands: { commands: [...clientCommands['rust-analyzer'] ?? []] } } };
  return undefined;
}
export const reportsInactiveRegions = (capabilities: ClientCapabilities | undefined) =>
  (capabilities?.textDocument as { inactiveRegionsCapabilities?: { inactiveRegions?: unknown } } | undefined)?.inactiveRegionsCapabilities?.inactiveRegions === true;

export const inactiveRegionsMethod = 'textDocument/inactiveRegions';
/** One entry per region, as Zed makes them (clangd_ext.rs): from clangd, marked unnecessary, so
 * the lines are faded. Zed does not underline them (c.rs `underline_diagnostic`); in this editor
 * that is a hint, the one severity drawn without a line under it. */
export const inactiveRegionMessage = 'Inactive region: the preprocessor leaves these lines out of this build';
const inactiveRegion = (range: Diagnostic['range']): Diagnostic => ({ range, severity: 4, source: 'clangd', message: inactiveRegionMessage, tags: [1] });
const position = (value: unknown): value is Diagnostic['range']['start'] => { const at = record(value); return !!at && Number.isSafeInteger(at.line) && Number.isSafeInteger(at.character) && (at.line as number) >= 0 && (at.character as number) >= 0; };

/** clangd's own diagnostics and its inactive regions come in two notifications, each for one
 * version of the text. What the editor is given holds both for the same version: Zed keeps the
 * regions when the diagnostics are published again (c.rs `retain_old_diagnostic`) and replaces
 * only the regions when they are (clangd_ext.rs `merge_lsp_diagnostics`). Regions of another
 * version than the diagnostics are held back until the diagnostics of that version arrive, so
 * nothing is shown at lines the text no longer has. */
export class InactiveRegions {
  private readonly files = new Map<string, { published?: PublishDiagnosticsParams; regions?: { version?: number; diagnostics: Diagnostic[] } }>();
  private file(uri: string) {
    let file = this.files.get(uri);
    if (!file) { if (this.files.size >= 512) this.files.delete(this.files.keys().next().value!); this.files.set(uri, file = {}); }
    return file;
  }
  private static merged(file: { published?: PublishDiagnosticsParams; regions?: { version?: number; diagnostics: Diagnostic[] } }): PublishDiagnosticsParams | undefined {
    const { published, regions } = file;
    if (!published) return undefined;
    const same = !regions || published.version === undefined || regions.version === undefined || published.version === regions.version;
    return same && regions?.diagnostics.length ? { ...published, diagnostics: [...published.diagnostics, ...regions.diagnostics] } : published;
  }
  /** The tool published its diagnostics: what the editor is given in their place. */
  published(params: PublishDiagnosticsParams): PublishDiagnosticsParams {
    const file = this.file(params.uri); file.published = params;
    return InactiveRegions.merged(file) ?? params;
  }
  /** The tool named its inactive regions: what the editor is given, or nothing while the diagnostics of that version are still to come. */
  inactive(params: unknown): PublishDiagnosticsParams | undefined {
    const document = record(record(params)?.textDocument), regions = record(params)?.regions;
    if (typeof document?.uri !== 'string' || !Array.isArray(regions)) return undefined;
    const file = this.file(document.uri), version = typeof document.version === 'number' ? document.version : undefined;
    file.regions = { version, diagnostics: regions.slice(0, 2000).flatMap(range => position(record(range)?.start) && position(record(range)?.end) ? [inactiveRegion(range as Diagnostic['range'])] : []) };
    const { published } = file;
    return published && (published.version === undefined || version === undefined || published.version === version) ? InactiveRegions.merged(file) : undefined;
  }
  closed(uri: string): void { this.files.delete(uri); }
}

export const serverStatusMethod = 'experimental/serverStatus';
/** rust-analyzer's standing status (lsp-extensions.md, "Server Status"). */
export type ToolStatus = { health: 'ok' | 'warning' | 'error'; quiescent: boolean; message?: string };
export function toolStatus(params: unknown): ToolStatus | undefined {
  const status = record(params), health = status?.health;
  if (health !== 'ok' && health !== 'warning' && health !== 'error') return undefined;
  const message = typeof status!.message === 'string' && status!.message.trim() ? status!.message.trim().slice(0, 4096) : undefined;
  // A status that does not say is taken as settled, as Zed takes it (rust_analyzer_ext.rs reads only health and message).
  return { health, quiescent: status!.quiescent !== false, ...(message ? { message } : {}) };
}
/** What a status means for the answers, in the specification's own terms: `warning`, "some
 * results might be wrong"; `error`, "most results will be incomplete or wrong"; not quiescent,
 * "pending background work which might change the status". The extension shows the first two
 * as the colour of its status bar item with the message on hover, and the third as a spinner
 * (ctx.ts `updateStatusBarItem`). */
export function statusMeaning(status: ToolStatus, name: string): { line?: string; notice?: { severity: 'warning' | 'error'; message: string }; working?: string } {
  const meaning = status.health === 'warning' ? `${name} is only partly working: some results may be wrong.`
    : status.health === 'error' ? `${name} is not working: most results will be incomplete or wrong.` : undefined;
  return {
    line: meaning ? [meaning, status.message].filter(Boolean).join(' ') : status.message,
    notice: meaning && status.health !== 'ok' ? { severity: status.health, message: [meaning, status.message].filter(Boolean).join('\n\n') } : undefined,
    working: status.quiescent ? undefined : `${name} is still working: results may change`,
  };
}

/** What the tool writes after a keystroke, and which kinds the person left on.
 * HTML (`htmlClient.ts`, `autoInsertion.ts`): `html/autoInsert` closes a tag after `>` or `/`
 * unless `html.autoClosingTags` is off, and writes the quotes of an attribute after `=` unless
 * `html.autoCreateQuotes` is off. Both are on unless written otherwise, as in the extension's
 * `package.json`. Svelte (`extension.ts`, `html/autoClose.ts`): `html/tag` closes a tag, under
 * the same `html.autoClosingTags`. */
export function autoInsertion(tool: Tool, settings: Settings | undefined): LanguageAutoInsert | undefined {
  const on = (name: string) => setting(settings, name) !== false;
  if (isHtmlServer(tool)) return { method: 'html/autoInsert', close: on('html.autoClosingTags'), quote: on('html.autoCreateQuotes') };
  if (isSvelteServer(tool)) return { method: 'html/tag', close: on('html.autoClosingTags'), quote: false };
  return undefined;
}

/** A request outside the protocol goes only to the tool whose extension makes it. */
export function answersRequest(tool: Tool | undefined, method: string): boolean {
  const row = toolRequest(method);
  return !row || toolFamily(tool) === row.tool;
}

/** clangd-context.ts, `clientOptions.initializationOptions`: clangd reports what it is doing with
 * each file once `clangdFileStatus` is on, and compiles a file no compilation database covers
 * with `clangd.fallbackFlags`. What the person wrote in the options wins. */
export function clangdOptions(settings: Settings | undefined, written: Settings | undefined): Settings {
  const flags = setting(settings, 'clangd.fallbackFlags');
  return mergeLanguageSettings({ clangdFileStatus: true, ...(Array.isArray(flags) && flags.every(flag => typeof flag === 'string') ? { fallbackFlags: flags } : {}) }, written);
}
export const clangdFileStatusMethod = 'textDocument/clangd.fileStatus';
/** file-status.ts: the extension shows `clangd: <state>` for the file in front. Here the state
 * of each file clangd is working on is a line of work in progress, gone when the file is idle. */
export function clangdFileStatus(params: unknown): { uri: string; line?: string } | undefined {
  const status = record(params);
  if (typeof status?.uri !== 'string' || typeof status.state !== 'string') return undefined;
  const state = status.state.trim().slice(0, 200);
  let name = status.uri; try { name = path.basename(decodeURIComponent(new URL(status.uri).pathname)); } catch { /* Shown as sent. */ }
  return { uri: status.uri, line: !state || state === 'idle' ? undefined : `${name.slice(0, 120)}: ${state}` };
}

/** `extension.ts`, `clientOptions.synchronize.configurationSection`: the settings the Svelte
 * extension hands its server, at startup and again whenever one of them changes. */
export const svelteConfigurationSections = ['svelte', 'prettier', 'emmet', 'javascript', 'typescript', 'js/ts', 'css', 'less', 'scss', 'html'] as const;
/** `extension.ts`, `clientOptions.initializationOptions`. The server reads its settings from
 * `configuration` before it answers anything, so a setting written for the tool takes effect
 * from the first answer and not from the first settings notification.
 * `isTrusted` is `workspace.isTrusted` there. Setdown has no untrusted mode: opening a folder
 * is the consent, as it is for every other tool Setdown starts in that folder. It is said
 * outright so that a later trust decision has one place to change. */
export function svelteOptions(settings: Settings | undefined, written: Settings | undefined): Settings {
  const configuration: Settings = {};
  for (const section of svelteConfigurationSections) { const value = record(settings?.[section]); if (value) configuration[section] = value; }
  return mergeLanguageSettings({ configuration, dontFilterIncompleteCompletions: true, isTrusted: true }, written);
}
/** `extension.ts`, `workspace.onDidSaveTextDocument`: saving one of these restarts the server,
 * because it read the file once when it started. The commented-out tsconfig/jsconfig lines
 * there stay left out here. */
export const svelteRestartFiles: readonly RegExp[] = [
  /^svelte\.config\.(js|ts|cjs|mjs|mts)$/,
  /^vite\.config\.(js|cjs|mjs|ts|mts)$/,
  /^\.prettierrc$/,
  /^\.prettierrc\.(json|yml|yaml|json5|toml)$/,
  /^\.prettierrc\.(js|cjs)$/,
  /^prettier\.config\.(js|cjs)$/,
];
/** `extension.ts`, `addRenameFileListener`: after a file or folder was renamed the Svelte tool
 * is asked which imports now point at the wrong place. A folder is asked about, and of files
 * only these kinds. */
export const svelteRenameEdits = '$/getEditsForFileRename';
export function svelteAsksAboutRename(oldUri: string): boolean {
  const last = oldUri.split(/\/|\\/).at(-1) ?? '';
  return !last.includes('.') || ['.ts', '.js', '.json', '.svelte'].some(ending => last.endsWith(ending));
}
/** The same listener: which of the edits the tool proposes are applied. Edits of a TypeScript or
 * JavaScript file belong to the TypeScript tool, except the ones that update an import of a
 * Svelte file, and with the Svelte TypeScript plugin on (`tsPlugin`) the others of such a file too. */
export function svelteRenameChanges(answer: unknown, tsPlugin: boolean): { uri: string; edits: { range: Diagnostic['range']; newText: string }[] }[] {
  const changes = Array.isArray(record(answer)?.documentChanges) ? record(answer)!.documentChanges as unknown[] : [];
  return changes.slice(0, 200).flatMap(change => {
    const document = record(record(change)?.textDocument), edits = record(change)?.edits;
    if (typeof document?.uri !== 'string' || !Array.isArray(edits)) return [];
    const valid = edits.flatMap(edit => { const item = record(edit), range = record(item?.range);
      return item && typeof item.newText === 'string' && position(range?.start) && position(range?.end) ? [{ range: range as unknown as Diagnostic['range'], newText: item.newText }] : []; });
    const script = document.uri.endsWith('.ts') || document.uri.endsWith('.js');
    if (script && !valid.some(edit => edit.newText.endsWith('.svelte'))) return [];
    const kept = valid.filter(edit => !script || tsPlugin || edit.newText.endsWith('.svelte'));
    return kept.length ? [{ uri: document.uri, edits: kept }] : [];
  });
}
/** The files whose change starts the tool again with what they now say. */
export function restartsTool(tool: Tool, file: string): boolean {
  return isSvelteServer(tool) && svelteRestartFiles.some(pattern => pattern.test(path.basename(file)));
}
/** `extension.ts`, `addDidChangeTextDocumentListener`: the Svelte server is told about unsaved
 * changes of TypeScript and JavaScript files, which it otherwise reads from disk. Exactly these
 * two languages, as there: not TSX or JSX. */
export const svelteScriptLanguages: readonly string[] = ['typescript', 'javascript'];
export const svelteScriptChanged = '$/onDidChangeTsOrJsFile';

/** `vendor/vscode/extensions/json-language-features/client/src/jsonClient.ts`, `initializationOptions`:
 * the JSON server reads files itself and asks its editor for every other schema (`vscode/content`).
 * The editor then decides whether an address may be downloaded and keeps the schema on disk
 * (`json-schema-content.ts`). Without this the server downloads any address a file names. */
export const jsonHandledSchemaProtocols: readonly string[] = ['file'];
export function jsonOptions(written: Settings | undefined): Settings {
  return mergeLanguageSettings({ handledSchemaProtocols: [...jsonHandledSchemaProtocols] }, written);
}
/** The request the JSON extension shows a file's schemas with (`languageStatus.ts`): the
 * document's address is the whole parameter. */
export const jsonLanguageStatus = 'json/languageStatus';
/** What the document panel says about a JSON file's schemas, from the server's answer. */
export function schemaLines(answer: unknown): string[] {
  const schemas = Array.isArray(record(answer)?.schemas) ? (record(answer)!.schemas as unknown[]).filter((schema): schema is string => typeof schema === 'string') : [];
  return schemas.length ? schemas.slice(0, 8).map(schema => `Schema: ${schema}`) : ['Schema: none configured for this file'];
}

/** `configuration.ts`, `readMaxTsServerMemory`. */
export const tsserverMemory = { default: 3072, minimum: 128 } as const;
/** `svelte-vscode/package.json`, `contributes.typescriptServerPlugins`. */
export const sveltePlugin = 'typescript-svelte-plugin';
export type TsserverPlugin = { name: string; location: string; languages?: string[] };
/** The nearest folder, from `start` upwards, whose `node_modules` holds the package. */
export function packageFolder(start: string, name: string): string | undefined {
  for (let directory = start, depth = 0; depth < 64; depth++, directory = path.dirname(directory)) {
    try { if (statSync(path.join(directory, 'node_modules', name, 'package.json')).isFile()) return directory; } catch { /* Not installed here. */ }
    if (path.dirname(directory) === directory) break;
  }
  return undefined;
}
/** What the TypeScript extension tells tsserver at startup, in typescript-language-server's
 * names for it (`lib/cli.mjs`, `TypeScriptInitializationOptions`).
 *  - `maxTsServerMemory`: 3072 MB unless `typescript.tsserver.maxTsServerMemory` says otherwise, never under 128.
 *  - `npmLocation`: `typescript.npm`. `locale`: `typescript.locale` unless it is `auto`.
 *  - `disableAutomaticTypingAcquisition`: the extension lets tsserver download type packages
 *    with npm unless `typescript.disableAutomaticTypeAcquisition` is on, which is how a plain
 *    JavaScript project gets the types of its packages. Here the setting decides when it is
 *    written; otherwise tsserver downloads types where Setdown may download tools for this
 *    project (`downloads`), and nowhere else. Without a decision about downloads it stays off.
 *  - `plugins`: the extension forwards the tsserver plugins other extensions contribute. The one
 *    Setdown's languages have is the Svelte plugin, which the Svelte extension leaves off until
 *    `svelte.enable-ts-plugin` is on (`tsplugin.ts`). `svelte` is the Svelte tool's settings and
 *    `places` are the folders it may be installed in: the project first, then the tool's own.
 * `written` is what the person or the tool's profile already put in the options; it wins, except
 * that a decision about downloads replaces what an earlier pass of this function put there. */
export function typescriptOptions(settings: Settings | undefined, written: Settings | undefined, plugin?: { svelte?: Settings; places: string[]; downloads?: boolean }): Settings {
  const memory = setting(settings, 'typescript.tsserver.maxTsServerMemory'), acquisition = setting(settings, 'typescript.disableAutomaticTypeAcquisition');
  const disable = typeof acquisition === 'boolean' ? acquisition : !(plugin?.downloads ?? false);
  const options: Settings = {
    maxTsServerMemory: typeof memory === 'number' && Number.isSafeInteger(memory) ? Math.max(memory, tsserverMemory.minimum) : tsserverMemory.default,
    disableAutomaticTypingAcquisition: disable,
  };
  const npm = setting(settings, 'typescript.npm'), locale = setting(settings, 'typescript.locale');
  if (typeof npm === 'string' && npm) options.npmLocation = npm;
  if (typeof locale === 'string' && locale && locale !== 'auto') options.locale = locale;
  const plugins = Array.isArray(written?.plugins) ? [...written.plugins as TsserverPlugin[]] : [];
  const enabled = setting(plugin?.svelte, 'svelte.enable-ts-plugin') ?? setting(settings, 'svelte.enable-ts-plugin');
  if (enabled === true && !plugins.some(item => item?.name === sveltePlugin)) {
    const location = plugin?.places.map(place => packageFolder(place, sveltePlugin)).find(Boolean);
    if (location) plugins.push({ name: sveltePlugin, location });
  }
  return { ...mergeLanguageSettings(options, written), ...(plugin?.downloads !== undefined ? { disableAutomaticTypingAcquisition: disable } : {}), ...(plugins.length ? { plugins } : {}) };
}
