import path from 'node:path';
import { statSync } from 'node:fs';
import type { ClientCapabilities, Diagnostic, PublishDiagnosticsParams } from 'vscode-languageserver-protocol';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import type { LanguageAutoInsert } from '../../protocol/language';
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

/** What a tool reports only to an editor that says it can take it. clangd names the lines the
 * preprocessor leaves out once `inactiveRegionsCapabilities` is declared (inactive-regions.ts
 * `fillClientCapabilities`; Zed declares the same in c.rs). rust-analyzer reports its standing
 * status once `serverStatusNotification` is declared (client.ts `fillClientCapabilities`; Zed's
 * lsp.rs); without it, it shows a problem once as a passing message (main_loop.rs). Undefined:
 * the tool is told what every tool is told. */
export function toolCapabilities(tool: Tool, general: ClientCapabilities): ClientCapabilities | undefined {
  if (isClangd(tool)) return { ...general, textDocument: { ...general.textDocument, inactiveRegionsCapabilities: { inactiveRegions: true } } as ClientCapabilities['textDocument'] };
  if (isRustAnalyzer(tool)) return { ...general, experimental: { ...record(general.experimental), serverStatusNotification: true } };
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
  if (method === 'html/autoInsert') return !!tool && isHtmlServer(tool);
  if (method === 'html/tag') return !!tool && isSvelteServer(tool);
  if (method === 'textDocument/switchSourceHeader') return !!tool && isClangd(tool);
  return true;
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
 *    with npm unless `typescript.disableAutomaticTypeAcquisition` is on. Setdown downloads
 *    nothing a person did not ask for, so here it stays off until that setting is written `false`.
 *  - `plugins`: the extension forwards the tsserver plugins other extensions contribute. The one
 *    Setdown's languages have is the Svelte plugin, which the Svelte extension leaves off until
 *    `svelte.enable-ts-plugin` is on (`tsplugin.ts`). `svelte` is the Svelte tool's settings and
 *    `places` are the folders it may be installed in: the project first, then the tool's own.
 * `written` is what the person or the tool's profile already put in the options; it wins. */
export function typescriptOptions(settings: Settings | undefined, written: Settings | undefined, plugin?: { svelte?: Settings; places: string[] }): Settings {
  const memory = setting(settings, 'typescript.tsserver.maxTsServerMemory');
  const options: Settings = {
    maxTsServerMemory: typeof memory === 'number' && Number.isSafeInteger(memory) ? Math.max(memory, tsserverMemory.minimum) : tsserverMemory.default,
    disableAutomaticTypingAcquisition: setting(settings, 'typescript.disableAutomaticTypeAcquisition') !== false,
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
  return { ...mergeLanguageSettings(options, written), ...(plugins.length ? { plugins } : {}) };
}
