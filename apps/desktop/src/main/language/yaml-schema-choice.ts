import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolRulesFactory } from './tool-signals';

// The Red Hat YAML extension shows which schema a YAML file is validated with, lets the person
// choose others, and stores the choice in `yaml.schemas`. It also tells the server at startup
// what its editor can do. The rules in this file are carried over from that extension. Below
// `vendor/vscode-yaml`:
//   src/schema-status-bar-item.ts   the two requests, the status text, the picker, `writeSchemaUriMappings`
//   src/extension.ts                the notifications sent at startup, the server's own notifications
//   package.json                    `yaml.schemas`, `yaml.disableSchemaDetection`, `yaml.maxItemsComputed`
// The server's side was read in the installed yaml-language-server 2.0.0, whose source is not
// under `vendor/` (out/src/requestTypes.js, languageserver/handlers/{schemaSelectionHandlers,
// notificationHandlers,settingsHandlers}.js, languageservice/services/schemaRequestHandler.js).

type Settings = Record<string, unknown>;
const record = (value: unknown): Settings | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Settings : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value ? value.slice(0, 4096) : undefined;
/** An address is used whole or not at all: a shortened one would name something else. */
const address = (value: unknown): string | undefined => typeof value === 'string' && value && value.length <= 4096 ? value : undefined;
/** The JSON Schema Store catalogue, which the server offers whole, has about a thousand entries. */
const choiceLimit = 4096;
const versionLimit = 256;

/** The schemas a file is validated with now. Parameter: the document's address. Answer:
 * `{ uri, name?, description?, versions? }[]`, empty for a document the server does not have open. */
export const yamlFileSchemasMethod = 'yaml/get/jsonSchema';
/** Every schema the server knows. Parameter: the document's address. Answer: the file's own
 * schemas first (`usedForCurrentFile: true`), then all others, each
 * `{ uri, name?, description?, versions?, usedForCurrentFile, fromStore }`. */
export const yamlAllSchemasMethod = 'yaml/get/all/jsonSchemas';
/** Either request as it is written to the server. The address is the one parameter, and a
 * parameter that is not an object travels in a list (vscode-jsonrpc `computeSingleParam`).
 * Without `params` the server answers `InvalidParams`. */
export function yamlSchemaRequest(method: typeof yamlFileSchemasMethod | typeof yamlAllSchemasMethod, uri: string): { method: string; params: [string] } {
  return { method, params: [uri] };
}

/** From the server, once `yaml/supportSchemaSelection` was sent: it has applied its settings
 * and loaded the schema catalogue. The extension asks for the file's schemas when this arrives
 * (extension.ts, `createJSONSchemaStatusBarItem`); asked earlier, a file that only the
 * catalogue has a schema for is answered with none. */
export const yamlSchemaStoreInitializedMethod = 'yaml/schema/store/initialized';
/** From the server: an outline or a folding answer was cut at `yaml.maxItemsComputed`. The parameter is the sentence to show. */
export const yamlResultLimitReachedMethod = 'yaml/resultLimitReached';
export const yamlSchemasSetting = 'yaml.schemas';
export const yamlDetectionSetting = 'yaml.disableSchemaDetection';
export const yamlMaxItemsSetting = 'yaml.maxItemsComputed';

export type YamlStartupNotification = {
  method: string;
  /** The `params` member as the extension's connection writes it: a notification sent without
   * a parameter carries `[null]`, and a list as the one parameter travels inside a list. */
  params: unknown;
  switchesOn: string;
  /** The requests the server makes of its editor from then on. An editor that sends the
   * notification and does not answer them leaves every schema lookup, or every schema
   * download, failing. */
  asks: readonly string[] };
/** What the extension sends when the server has started (extension.ts `startClient`, after
 * `client.start()`), in its order. None of them is needed for the two requests above: the
 * server answers those from its first moment (yamlLanguageService.js makes its
 * `JSONSchemaSelection` unconditionally). */
export const yamlStartupNotifications: readonly YamlStartupNotification[] = [
  { method: 'json/schemaAssociations', params: [[]], asks: [],
    switchesOn: 'Schemas that other VS Code extensions assign to YAML files (`contributes.yamlValidation`). The parameter is that list, each `{ fileMatch: string[], uri }`; the server asks for its settings again when it arrives. Setdown has no extensions, so there is nothing to send.' },
  { method: 'yaml/registerCustomSchemaRequest', params: [null], asks: ['custom/schema/request'],
    switchesOn: 'Before it uses its own settings, the server asks its editor for the schemas of every file (`custom/schema/request`, parameter the file address, answer one address or a list). In VS Code other extensions answer through the YAML extension. Setdown has no such extensions.' },
  { method: 'yaml/registerContentRequest', params: [null], asks: ['vscode/content'],
    switchesOn: 'The server stops downloading http(s) schemas itself and asks its editor for each (`vscode/content`, parameter the address, answer the text). The extension answers from a cache on disk, through the proxy the person set.' },
  { method: 'yaml/supportSchemaSelection', params: [null], asks: [],
    switchesOn: 'After every settings update the server sends `yaml/schema/store/initialized`, the moment to ask for the file\'s schemas.' },
];
/** The one Setdown sends: it obliges the editor to answer nothing, and tells it when to ask. */
export const yamlSchemaSelectionSupported: { method: string; params: [null] } = { method: 'yaml/supportSchemaSelection', params: [null] };

/** schema-status-bar-item.ts `schemaDeclarationPattern`: a line that names the file's schema
 * itself (`# yaml-language-server: $schema=…`, `$schema: …`). When an edit adds or changes
 * such a line, the extension asks for the file's schemas again. */
export const yamlSchemaDeclaration = /(?:#\s*(?:yaml-language-server\s*:\s*)?\$schema\s*(?:=|:)|^[ \t]*["']?\$schema["']?\s*:)/m;

/** The picker's first entry, and the status text of a file without a schema (`noSchemaLabel`). */
export const yamlNoSchemaLabel = 'No JSON Schema';

type Schema = { uri: string; name?: string; description?: string; versions?: Record<string, string>; used: boolean; fromStore: boolean };
function schema(value: unknown): Schema | undefined {
  const stated = record(value), uri = address(stated?.uri);
  if (!stated || !uri) return undefined;
  const name = text(stated.name), description = text(stated.description);
  const versions = Object.entries(record(stated.versions) ?? {}).filter((entry): entry is [string, string] => !!entry[0] && !!address(entry[1])).slice(0, versionLimit);
  return { uri, used: stated.usedForCurrentFile === true, fromStore: stated.fromStore === true,
    ...(name ? { name } : {}), ...(description ? { description } : {}), ...(versions.length ? { versions: Object.fromEntries(versions) } : {}) };
}
const schemas = (answer: unknown): Schema[] => Array.isArray(answer) ? answer.slice(0, choiceLimit).flatMap(value => schema(value) ?? []) : [];

/** `findUsedVersion`: the version whose address the schema has, and `latest` when no version has it. */
const usedVersion = (versions: Record<string, string>, uri: string): string => Object.keys(versions).find(version => versions[version] === uri) ?? 'latest';
/** `findSchemaStoreItem`: the name of the catalogue version that has this address. */
const storeVersion = (all: readonly Schema[], uri: string): string | undefined =>
  all.flatMap(entry => Object.entries(entry.versions ?? {})).find(([, versionUri]) => versionUri === uri)?.[0];

export type YamlSchemaVersion = { version: string; uri: string;
  /** The version in use, which the extension ticks: the one whose address is the schema's own,
   * or the one named `latest` when no version has that address. */
  current: boolean };
export type YamlSchemaChoice = {
  /** The schema's name, or its address when it has none (`val.name ?? val.uri`). */
  name: string; description?: string; uri: string;
  /** The file is validated with it now. */
  inUse: boolean;
  /** It is an entry of the JSON Schema Store catalogue. */
  fromStore: boolean;
  /** The versions the catalogue has of it. Choosing one maps the file to that version's address. */
  versions?: YamlSchemaVersion[] };

function versionsOf(entry: Schema): YamlSchemaVersion[] | undefined {
  if (!entry.versions) return undefined;
  const current = usedVersion(entry.versions, entry.uri);
  return Object.entries(entry.versions).map(([version, uri]) => ({ version, uri, current: version === current }));
}

/** The picker's entries (`showSchemaSelection`), from the answer to `yaml/get/all/jsonSchemas`
 * and, when at hand, the answer to `yaml/get/jsonSchema`. The first answer already marks the
 * file's schemas; a schema only the second one names is added as in use. Order as in the
 * extension: schemas in use that have versions, then the others in use, then the rest by name.
 * The extension puts `yamlNoSchemaLabel` above them, and several entries may be chosen. */
export function yamlSchemaChoices(all: unknown, inUse?: unknown): YamlSchemaChoice[] {
  const known = new Map<string, Schema>();
  for (const entry of schemas(all)) if (!known.has(entry.uri)) known.set(entry.uri, entry);
  for (const entry of schemas(inUse)) known.set(entry.uri, { ...known.get(entry.uri), ...entry, fromStore: known.get(entry.uri)?.fromStore ?? false, used: true });
  const rank = (choice: YamlSchemaChoice) => choice.inUse ? choice.versions ? 0 : 1 : 2;
  return [...known.values()].map((entry): YamlSchemaChoice => {
    const versions = versionsOf(entry);
    return { name: entry.name ?? entry.uri, ...(entry.description ? { description: entry.description } : {}), uri: entry.uri, inUse: entry.used, fromStore: entry.fromStore, ...(versions ? { versions } : {}) };
  }).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** What the document panel says about the schema of a YAML file (`updateStatusBar`), from the
 * answer to `yaml/get/jsonSchema`: no schema, the one schema's name with its version, or how
 * many and which. `all` is the answer to `yaml/get/all/jsonSchemas`; the extension asks it
 * only to name the version of a schema that does not state its versions itself. The extension
 * shows several as `Multiple JSON Schemas` and lists their names in the tooltip; a line in the
 * panel has no tooltip, so the names are in the line. */
export function yamlSchemaLine(inUse: unknown, all?: unknown): string {
  const used = schemas(inUse);
  if (!used.length) return yamlNoSchemaLabel;
  if (used.length > 1) return `${used.length} JSON schemas: ${used.slice(0, 8).map(entry => entry.name ?? entry.uri).join(', ')}${used.length > 8 ? ', …' : ''}`.slice(0, 4096);
  const [only] = used, name = only.name ?? only.uri;
  const version = only.versions ? usedVersion(only.versions, only.uri) : storeVersion(schemas(all), only.uri);
  return version && !name.includes(version) ? `${name} (${version})` : name;
}

/** `handleSchemaVersionSelection`: the chosen schemas once a version of one of them was picked.
 * That schema, under whichever of its versions it was chosen before, gives way to the picked
 * version's address; the other chosen schemas stay. */
export function yamlVersionSelection(selected: readonly string[], choice: Pick<YamlSchemaChoice, 'uri' | 'versions'>, versionUri: string): string[] {
  const own = new Set([choice.uri, ...(choice.versions ?? []).map(entry => entry.uri)]);
  return [...new Set([...selected.filter(uri => !own.has(uri)), versionUri])];
}

export type YamlFile = {
  /** The document's address, exactly as the server was told it when the document was opened. */
  uri: string;
  /** The project folder, for the spelling of the file relative to it. */
  folder?: string };
function spellings(uri: string, folder?: string): { path?: string; relative?: string } {
  let file: string | undefined;
  try { if (uri.startsWith('file:')) file = fileURLToPath(uri); } catch { /* Not a file on this computer. */ }
  const relative = file && folder ? path.relative(folder, file) : undefined;
  return { path: file, relative: relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : undefined };
}
/** `getFilePatternCandidates`: the ways a setting may name exactly this file: its address, its
 * full path, and its path from the project folder. */
export function yamlFileSpellings(file: YamlFile): string[] {
  const { path: full, relative } = spellings(file.uri, file.folder);
  return [...new Set([file.uri, full, relative].filter((spelling): spelling is string => !!spelling))];
}

const uris = (values: readonly string[]): string[] => values.filter(value => !!address(value) && value !== '__proto__').slice(0, 64);
function patterns(value: unknown): string[] {
  const stated: unknown[] = Array.isArray(value) ? value : [value];
  return stated.filter((pattern): pattern is string => typeof pattern === 'string');
}
const written = (list: string[]): string | string[] => list.length === 1 ? list[0] : list;

/** `writeSchemaUriMappings`: the new value of `yaml.schemas` after the person chose `selected`
 * for the file, where `used` were in use before (the entries with `inUse`). `yaml.schemas` maps
 * a schema's address to the files it applies to: one pattern or a list, a pattern that starts
 * with `!` taking files out again.
 *
 *  - A schema that was in use and is no longer chosen: this file's own spellings are taken out
 *    of its entry. If patterns for other files remain, `!<file address>` is added to them, so
 *    the entry goes on applying to the others; if none remain, the entry is removed.
 *  - A chosen schema that has an entry: a `!` pattern for this file is taken out of it.
 *  - A chosen schema without an entry: it gets one, with the file's address as its only pattern.
 *  - An entry is found under the address the server reports, or, for a schema that is a file,
 *    under its path or its path from the project folder (`resolveSettingsKey`).
 * A schema that applies through the catalogue alone has no entry, so taking it off the list
 * changes nothing here, as in the extension.
 *
 * Where this differs from the extension:
 *  - A schema chosen now whose entry names other files only, or held nothing but the `!`
 *    pattern, gets the file's address added to that entry. The extension writes nothing in the
 *    first case and an empty list in the second, and the file stays without the schema.
 *  - An entry written as `./schema.json` is found for the schema's address. Zed makes such a
 *    key a full path before the server sees it, so the server reports the address.
 *  - After a version was picked (`yamlVersionSelection`) the extension passes no `used`, and an
 *    entry for the version in use before stays beside the new one. Passing `used` removes it.
 *
 * VS Code keeps `yaml.schemas` in three places (user, workspace, folder). The extension
 * changes an entry in each place that has it and adds a new entry to the workspace's settings,
 * or the user's when no folder is open. Here there is one value: the one given. */
export function yamlSchemasAfterPick(current: unknown, file: YamlFile, selected: readonly string[], used: readonly string[] = []): Settings {
  const before = record(current) ?? {}, after: Settings = { ...before };
  const own = yamlFileSpellings(file), negated = own.map(spelling => `!${spelling}`);
  const key = (uri: string): string => {
    if (Object.hasOwn(before, uri)) return uri;
    const { path: full, relative } = spellings(uri, file.folder);
    return [full, relative, relative && `./${relative}`].find((candidate): candidate is string => !!candidate && Object.hasOwn(before, candidate)) ?? uri;
  };
  const chosen = new Set(uris(selected).map(key)), were = new Set(uris(used).map(key)), handled = new Set<string>();
  for (const [name, value] of Object.entries(before)) {
    const stated = patterns(value);
    if (were.has(name) && !chosen.has(name)) {
      const others = stated.filter(pattern => !own.includes(pattern));
      if (others.some(pattern => !pattern.startsWith('!'))) after[name] = others.includes(`!${file.uri}`) ? others : [...others, `!${file.uri}`];
      else delete after[name];
    } else if (chosen.has(name)) {
      handled.add(name);
      const kept = stated.filter(pattern => !negated.includes(pattern));
      const applies = kept.some(pattern => !pattern.startsWith('!')) && (kept.length !== stated.length || were.has(name) || kept.some(pattern => own.includes(pattern)));
      if (!applies) after[name] = written([...kept, file.uri]);
      else if (kept.length !== stated.length) after[name] = written(kept);
    }
  }
  for (const name of chosen) if (!handled.has(name)) after[name] = file.uri;
  return after;
}

/** `isSchemaDetectionDisabled`: `yaml.disableSchemaDetection` names exactly this file. The
 * picker then opens with `yamlNoSchemaLabel` chosen, whatever the server says is in use. */
export function yamlDetectionDisabled(current: unknown, file: YamlFile): boolean {
  const own = yamlFileSpellings(file);
  return patterns(current).some(pattern => own.includes(pattern));
}
/** `writeSchemaUriMappings`, its first step: once a schema is chosen for the file, the file is
 * taken out of `yaml.disableSchemaDetection` (`removeFilePatternFromSetting`). The new value of
 * that setting, or nothing when it is to be left as it is: when no schema was chosen, and when
 * the setting does not name the file. Nothing in the extension adds a file to it. */
export function yamlDetectionAfterPick(current: unknown, file: YamlFile, selected: readonly string[]): string[] | undefined {
  if (!uris(selected).length || !yamlDetectionDisabled(current, file)) return undefined;
  const own = yamlFileSpellings(file);
  return patterns(current).filter(pattern => !own.includes(pattern));
}

/** The YAML tool's rules: what its own notifications mean for the person.
 * `yaml/resultLimitReached` (extension.ts): the extension shows the server's sentence with a
 * hint at the setting, and buttons to open the settings or never be told again. Here it is a
 * notice, which stays dismissed until the sentence changes. */
export const yamlRules: ToolRulesFactory = () => ({
  notifications: {
    [yamlResultLimitReachedMethod]: params => {
      const message = text(Array.isArray(params) && params.length === 1 ? params[0] : params);
      return message ? { notices: { [yamlResultLimitReachedMethod]: { severity: 'info', message: `${message}\nUse setting '${yamlMaxItemsSetting}' to configure the limit.`.slice(0, 4096) } } } : undefined;
    },
  },
});
