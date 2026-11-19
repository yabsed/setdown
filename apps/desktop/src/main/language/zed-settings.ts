import path from 'node:path';
import { supportedLanguages } from '../../core/document/supported-languages';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import type { ServerRegistry } from './server-registry';
import { hasRepositoryMarker, languageRoot } from './language-root';
import { isInside } from '../documents/file-system';

/** The tools whose ordinary files Zed's project engine serves: Zed chooses the servers of a
 * file, starts them and keeps them informed of the text. A tool is added here once
 * `apps/lsp-benchmark` answers the same or better for its languages on this path. The other
 * tools still run through Setdown's own client, and notebooks always do. */
export const projectEngineTools: ReadonlySet<string> = new Set(['gopls', 'json-lsp', 'yaml-language-server', 'dockerfile-language-server', 'css-lsp', 'html-lsp']);

/** Zed's name for each language Setdown supports: the key under `languages` in Zed settings. */
const zedLanguages: Record<string, string> = {
  python: 'Python', javascript: 'JavaScript', javascriptreact: 'JavaScript', typescript: 'TypeScript', typescriptreact: 'TSX',
  svelte: 'Svelte', c: 'C', cpp: 'C++', rust: 'Rust', go: 'Go', gomod: 'Go Mod', gowork: 'Go Work', php: 'PHP', kotlin: 'Kotlin',
  json: 'JSON', jsonc: 'JSONC', yaml: 'YAML', dockerfile: 'Dockerfile', dockercompose: 'Docker Compose', css: 'CSS', scss: 'SCSS', less: 'LESS', html: 'HTML',
};
/** Dialects Setdown tells apart and Zed does not. To Zed each is its base language; a dialect
 * that is not written in its tool's base language (a Go template is not Go) is not listed. */
const zedDialects: Record<string, string> = { 'json-ld': 'JSON', 'github-action': 'YAML', 'gitlab-ci': 'YAML', 'woodpecker-ci': 'YAML' };
/** Zed's name for a document's language as Setdown sees it; none when Zed has no such language. */
export function zedLanguage(languageId: string): string | undefined { return zedLanguages[languageId] ?? zedDialects[languageId]; }
/** The files whose schema Zed's JSON server has from Zed itself. */
const zedSchemaFiles: ReadonlySet<string> = new Set(['package.json', 'tsconfig.json']);
/** Tools that Zed knows under a name none of Setdown's profile fields carry. */
const serverAliases: Record<string, string> = { 'json-lsp': 'json-language-server' };

export type ZedSettings = Record<string, unknown>;
export type BundledProgram = { path: string; arguments: string[]; env?: Record<string, string> };
export type ZedNames = {
  /** Zed's name for the server of a Setdown tool, when Zed has an adapter for it. */
  server(definition: LanguageServerDefinition): string | undefined;
  /** Whether the tool's server comes from a Zed extension and not from Zed itself. */
  fromExtension(definition: LanguageServerDefinition): boolean;
};

/** `known`: the adapters Zed has loaded. `extensionServer`: the server a Zed extension provides for the tool. */
export function zedNames(known: readonly string[], extensionServer: (id: string) => string | undefined): ZedNames {
  return { server(definition) {
    const names = [serverAliases[definition.id], definition.id, definition.provenance?.profile, definition.launch.kind === 'native' ? definition.launch.command : undefined];
    return extensionServer(definition.id) ?? names.find((name): name is string => !!name && known.includes(name));
  }, fromExtension: definition => !!extensionServer(definition.id) };
}

export type PlainLanguage = { name: string; suffixes: string[] };
/** Languages Zed has only through an extension that Setdown does not install, because their
 * tool here is a server Zed ships: SCSS and Less with the CSS server, Docker Compose with the
 * YAML server. The host is told their names and file names, which is all a server needs.
 * `known`: the languages Zed has. `extension`: the Zed extension a tool comes from. */
export function plainLanguages(known: readonly string[], definition: (id: string) => LanguageServerDefinition | undefined, extension: (tool: string) => string | undefined): PlainLanguage[] {
  const found = new Map<string, Set<string>>();
  for (const entry of supportedLanguages) for (const language of entry.languages) {
    const name = zedLanguages[language];
    // The extension of the language's own tool brings the language with it.
    if (!name || known.includes(name) || extension(entry.tool)) continue;
    const declared = definition(entry.tool)?.languages.find(candidate => candidate.languageId === language);
    const suffixes = found.get(name) ?? new Set<string>(); found.set(name, suffixes);
    for (const suffix of [...declared?.extensions ?? [], ...declared?.filenames ?? []]) suffixes.add(suffix.replace(/^\./, ''));
  }
  return [...found].filter(([, suffixes]) => suffixes.size).map(([name, suffixes]) => ({ name, suffixes: [...suffixes] }));
}

/** What Setdown ships, in Zed's settings format. It sits below the person's own Zed settings. */
export function setdownDefaults(names: ZedNames, definition: (id: string) => LanguageServerDefinition | undefined, bundled: Record<string, BundledProgram>): ZedSettings {
  const languages: Record<string, { language_servers: string[] }> = {};
  for (const entry of supportedLanguages) {
    const tool = definition(entry.tool), server = tool && names.server(tool);
    // One tool answers for a language. Zed's own lists also start linters and helpers that
    // it downloads without asking; a person adds those in Language Support or in Zed settings.
    if (server) for (const language of entry.languages) if (zedLanguages[language]) languages[zedLanguages[language]] ??= { language_servers: [server] };
  }
  const lsp: Record<string, Record<string, unknown>> = {};
  for (const [id, program] of Object.entries(bundled)) {
    const tool = definition(id), server = tool && names.server(tool);
    if (server) lsp[server] = { binary: program };
  }
  // A server Zed ships is given settings by Zed. A server from an extension is told only what
  // `lsp.<server>.settings` holds, and Zed answers "null" where nothing is set. The HTML
  // server's CSS checker fails on that answer and marks nothing in a page's <style>, so
  // Setdown's own settings for such a tool are its settings here too.
  for (const entry of supportedLanguages) {
    const tool = definition(entry.tool), server = tool && names.server(tool);
    if (server && names.fromExtension(tool) && Object.keys(tool.settings).length) lsp[server] = { ...lsp[server], settings: tool.settings };
  }
  // Zed gives its JSON server the schemas of the files in `zedSchemaFiles` and adds the ones
  // listed under `lsp.<server>.settings`. Setdown's other schema addresses are listed there.
  const json = definition('json-lsp'), jsonServer = json && !names.fromExtension(json) ? names.server(json) : undefined;
  const schemas = ((json?.settings.json as { schemas?: { fileMatch: string[]; url: string }[] } | undefined)?.schemas ?? [])
    .map(schema => ({ ...schema, fileMatch: schema.fileMatch.filter(name => !zedSchemaFiles.has(name)) })).filter(schema => schema.fileMatch.length);
  if (jsonServer && schemas.length) lsp[jsonServer] = { ...lsp[jsonServer], settings: { json: { schemas } } };
  // typescript-language-server downloads type packages for plain JavaScript projects unless told not to.
  const typescript = lsp['typescript-language-server'];
  if (typescript) typescript.initialization_options = { disableAutomaticTypingAcquisition: true };
  return {
    // Zed's default formatter installs Prettier with npm the first time a file opens.
    // Formatting comes from the language's own tool, as it does everywhere else in Setdown.
    formatter: 'language_server',
    languages, lsp,
  };
}

type Registry = Pick<ServerRegistry, 'definitions' | 'definition' | 'chosen' | 'executable' | 'defaultServer' | 'routes'>;
/** What a person chose in Language Support, in Zed's settings format. It sits above their
 * Zed settings file and below a project's `.zed/settings.json`. */
export function setdownChoices(registry: Registry, names: ZedNames, defaults: ZedSettings): ZedSettings {
  const lsp: Record<string, unknown> = {};
  for (const definition of registry.definitions()) {
    const chosen = registry.chosen(definition.id);
    const program = definition.launch.kind === 'native' ? registry.executable(definition.id) : undefined;
    if (!Object.keys(chosen).length && !(program && path.isAbsolute(program))) continue;
    const server = names.server(definition); if (!server) continue;
    const entry: Record<string, unknown> = {};
    if (chosen.settings) entry.settings = chosen.settings;
    if (chosen.initializationOptions) entry.initialization_options = chosen.initializationOptions;
    // As in Zed: a named program runs with exactly these arguments, and arguments alone replace the adapter's.
    if (program && path.isAbsolute(program)) entry.binary = { path: program, arguments: chosen.args ?? definition.launch.args };
    else if (chosen.args && JSON.stringify(chosen.args) !== JSON.stringify(definition.launch.args)) entry.binary = { arguments: chosen.args };
    if (Object.keys(entry).length) lsp[server] = entry;
  }
  const languages: Record<string, { language_servers: string[] }> = {};
  const shipped = (defaults.languages ?? {}) as Record<string, { language_servers?: string[] }>;
  const routes = registry.routes();
  for (const [language, zed] of Object.entries(zedLanguages)) {
    const tools = [registry.defaultServer(language), ...routes.filter(route => route.languageId === language && route.role === 'supplementary').map(route => route.server)];
    const servers = [...new Set(tools.flatMap(id => { const server = id && names.server(registry.definition(id)); return server ? [server] : []; }))];
    if (JSON.stringify(servers) !== JSON.stringify(shipped[zed]?.language_servers ?? [])) languages[zed] ??= { language_servers: servers };
  }
  return { languages, lsp };
}

/** The folder a person would open in Zed to work on this file: the folder open in the window,
 * else the repository the file belongs to, else the nearest folder with a project file of the
 * language. A file with none of these is opened on its own, as `zed file` does. */
export function projectFolder(file: string, definition: Pick<LanguageServerDefinition, 'languages' | 'rootMarkers'>, folder?: string, chosen?: string): { path: string; reason: string; single?: boolean } {
  if (chosen && isInside(chosen, file)) return { path: chosen, reason: 'User-selected analysis root' };
  if (folder && isInside(folder, file)) return { path: folder, reason: 'Open folder' };
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    if (hasRepositoryMarker(directory)) return { path: directory, reason: 'Repository boundary (.git)' };
    if (path.dirname(directory) === directory) break;
  }
  const marked = languageRoot(file, definition);
  return marked.reason.startsWith('Project marker') ? marked : { path: path.dirname(file), reason: 'Single file', single: true };
}
