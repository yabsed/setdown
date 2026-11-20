import { createHash } from 'node:crypto';
import path from 'node:path';
import { setting } from './extension-rules';
import type { ToolAction, ToolRulesFactory } from './tool-signals';

// What the Intelephense extension for VS Code does around the PHP tool it starts. The extension
// is open (MIT). The tool it starts is not, and its licence forbids reverse engineering
// (`LICENSE.txt`, 5b), so every rule here is what the extension sends, and nothing is said about
// what the tool does with it.
// The rules in this file are carried over from:
//   vendor/vscode-intelephense/src/extension.ts    `createClient`: initialization options, heap size; `activate`: when the index is
//                                                  thrown away; `indexWorkspace`, `cancelIndexing`, `enterLicenceKey`, `activateKey`
//   vendor/vscode-intelephense/src/middleware.ts   `mergeSettings`: what is added to the settings the tool asks for
//   vendor/vscode-intelephense/package.json        command titles, defaults of the settings
//   vendor/vscode-intelephense/CHANGELOG.md        1.17.0: where the tool keeps its files when it is told nothing;
//                                                  1.17.6: indexing is reported with `$/progress`
//
// The extension of this version listens to no notification of its own. The tool reports indexing
// with the protocol's `$/progress`, which every tool's session shows already.

type Settings = Record<string, unknown>;
const record = (value: unknown): Settings | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Settings : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value && value.length <= 4096 && !value.includes('\0') ? value : undefined;

/** `package.json`, `contributes.commands`: the three commands, as the person reads them. */
export const intelephenseCommandTitles = { indexWorkspace: 'Index workspace', cancelIndexing: 'Cancel indexing', enterLicenceKey: 'Enter licence key' } as const;

/** What one start of the tool is given. A folder that is left out is left to the tool, which then
 * keeps its files under `~/.config/intelephense/` (`CHANGELOG.md`, 1.17.0). */
export type IntelephenseStart = {
  /** A folder for this project alone; the tool keeps the project's index there. `ExtensionContext.storagePath`. */
  storagePath?: string;
  /** A folder for all projects of the person. `ExtensionContext.globalStoragePath`. */
  globalStoragePath?: string;
  /** The licence key the person entered. The extension keeps it in VS Code's global state under `intelephense.licence.key`. */
  licenceKey?: string;
  /** The tool throws its index of the project away and reads every file again. */
  clearCache?: boolean;
};

/** `createClient`, `initializationOptions`. `clearCache` is always sent; a folder or a key only
 * when there is one. The extension also sends `isVscode: true`, which is not true here. */
export function intelephenseOptions(start: IntelephenseStart): Record<string, unknown> {
  const storagePath = text(start.storagePath), globalStoragePath = text(start.globalStoragePath);
  const licenceKey = text(typeof start.licenceKey === 'string' ? start.licenceKey.trim() : undefined);
  return { ...(storagePath ? { storagePath } : {}), clearCache: start.clearCache === true, ...(globalStoragePath ? { globalStoragePath } : {}), ...(licenceKey ? { licenceKey } : {}) };
}

/** "Index workspace" (`indexWorkspace`) and the end of "Enter licence key": the tool is stopped
 * and started again with `clearCache: true`. Nothing else is sent to it. */
export function intelephenseReindexOptions(start: IntelephenseStart): Record<string, unknown> {
  return intelephenseOptions({ ...start, clearCache: true });
}

/** `activate`: whether the project's index was made by another version of the tool than the one
 * that is about to start, or by none that is remembered. The extension then removes the folder
 * `storagePath` and starts the tool with `clearCache: true`. It remembers the version for each
 * project (`workspaceState`, key `version`). */
export function intelephenseIndexIsStale(remembered: string | undefined, version: string): boolean {
  return !remembered || remembered !== version;
}

/** The rules of a session: the initialization options, under what the person wrote for the tool. */
export function intelephenseRules(start: IntelephenseStart): ToolRulesFactory {
  return () => ({ initializationOptions: intelephenseOptions(start) });
}

/** `CANCEL_INDEXING_REQUEST`: the name of a request. `cancelIndexing` sends it with no parameters and does not read the answer. */
export const intelephenseCancelIndexingMethod = 'cancelIndexing';
/** "Cancel indexing" as a button. */
export const intelephenseCancelIndexing: ToolAction = { title: intelephenseCommandTitles.cancelIndexing, request: { method: intelephenseCancelIndexingMethod } };

/** `enterLicenceKey`: what the input box asks, and what a key has to look like. */
export const intelephenseLicenceKeyPrompt = 'Intelephense Licence Key';
export const intelephenseLicenceKeyPattern = /^[0-9a-zA-Z]{15}$/;
export const intelephenseLicenceKeyMessage = 'A licence key must be a 15 character alphanumeric string.';
/** `enterLicenceKey`, `validateInput`: why the text cannot be entered, or `undefined` when it can.
 * Spaces around the key do not count. No text at all can be entered: it removes the key. */
export function licenceKeyProblem(entered: string): string | undefined {
  const key = entered.trim();
  return key && !intelephenseLicenceKeyPattern.test(key) ? intelephenseLicenceKeyMessage : undefined;
}
/** `enterLicenceKey`: what the person is told after the key was sent for activation. */
export const intelephenseKeyActivated = 'Your Intelephense licence key has been activated.';
export const intelephenseKeyNotActivated = 'Key could not be activated at this time. Please contact support.';

/** One request to the maker of the tool, and the file its answer is kept in. */
export type IntelephenseActivation = { url: string; method: 'POST'; headers: Record<string, string>; body: string; file: string };
/** `activateKey`: what the extension sends when the person has entered a key, before it starts
 * the tool again. `machineId` is the SHA-256 of the path of the home folder. An answer with
 * status 200 is written to `file` as it came; any other answer, or none, is the failure
 * `intelephenseKeyNotActivated`. `undefined` for a text that is not a key. */
export function intelephenseActivation(licenceKey: string, home: string, globalStoragePath: string): IntelephenseActivation | undefined {
  const key = licenceKey.trim();
  if (!intelephenseLicenceKeyPattern.test(key)) return undefined;
  return { url: 'https://intelephense.com/activate', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ machineId: createHash('sha256').update(home, 'utf8').digest('hex'), licenceKey: key }).toString(),
    file: path.join(globalStoragePath, `intelephense_licence_key_${key}`) };
}

/** `createClient`: `intelephense.maxMemory`, in megabytes, becomes the heap size of the tool's
 * Node process when it is 256 or more. An argument for Node: it stands before the tool's script. */
export function intelephenseNodeArguments(settings: Settings | undefined): string[] {
  const written = setting(settings, 'intelephense.maxMemory');
  const memory = typeof written === 'number' || typeof written === 'string' ? Math.floor(Number(written)) : Number.NaN;
  return Number.isSafeInteger(memory) && memory >= 256 ? [`--max-old-space-size=${memory}`] : [];
}

/** `package.json`: the defaults of `intelephense.files.associations` and `intelephense.files.exclude`. */
export const intelephenseFileDefaults: { associations: readonly string[]; exclude: readonly string[] } = {
  associations: ['*.php', '*.phtml'],
  exclude: ['**/.git/**', '**/.svn/**', '**/.hg/**', '**/CVS/**', '**/.DS_Store/**', '**/node_modules/**', '**/bower_components/**', '**/vendor/**/{Tests,tests}/**', '**/.history/**',
    '**/vendor/**/vendor/**'],
};

/** The names of an object of the editor's settings whose value passes; at most 1024. */
const names = (value: unknown, passes: (value: unknown) => boolean): string[] =>
  Object.entries(record(value) ?? {}).filter(([, item]) => passes(item)).map(([name]) => name).slice(0, 1024);
/** The list the tool is sent: the written one with the editor's patterns added. Where nothing
 * is written and the editor adds something, the default takes the place of the written list. */
function patterns(written: unknown, standard: readonly string[] | undefined, added: string[]): unknown[] | undefined {
  const list = Array.isArray(written) ? written : written === undefined && added.length ? standard : undefined;
  return list && [...new Set<unknown>([...list, ...added])];
}
/** `server-session.ts` `configurationSection`: a section of the settings by its name, `null` when it is not written. */
function sectionOf(settings: Settings, section?: string): unknown {
  if (!section) return settings;
  if (Object.hasOwn(settings, section)) return settings[section];
  let value: unknown = settings;
  for (const key of section.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return null;
    value = (value as Settings)[key];
  }
  return value ?? null;
}

/** What the tool is answered when it asks for `section` of the settings (`workspace/configuration`).
 * `settings` holds what the person wrote, by VS Code's names: the tool's own under `intelephense`,
 * and the editor's `files.associations`, `files.exclude` and `php.validate.run`.
 *
 * `middleware.ts` `mergeSettings` changes three things in an answer:
 *   `files.associations`  gains every pattern the editor's `files.associations` gives to `php`
 *   `files.exclude`       gains every pattern the editor's `files.exclude` switches on
 *   `diagnostics.run`     written as `null` becomes `php.validate.run`, or `onType` when that is not written
 *
 * In VS Code an answer always holds the two lists, because VS Code fills in the defaults of the
 * extension. Here an answer holds what the person wrote. So for the section `intelephense` a list
 * that is not written starts from the extension's default when the editor has something to add,
 * and stays out of the answer when it has not. */
export function intelephenseConfiguration(settings: Settings, section?: string): unknown {
  const answer = sectionOf(settings, section);
  const whole = section === 'intelephense';
  const own = record(answer) ?? (whole && answer === null ? {} : undefined);
  if (!own) return answer;
  const files = record(own.files) ?? (whole && own.files === undefined ? {} : undefined);
  const associations = files && patterns(files.associations, whole ? intelephenseFileDefaults.associations : undefined, names(setting(settings, 'files.associations'), value => value === 'php'));
  const exclude = files && patterns(files.exclude, whole ? intelephenseFileDefaults.exclude : undefined, names(setting(settings, 'files.exclude'), Boolean));
  const diagnostics = record(own.diagnostics);
  const validate = setting(settings, 'php.validate.run');
  const run = diagnostics && diagnostics.run === null ? (typeof validate === 'string' ? validate : 'onType') : undefined;
  if (!associations && !exclude && run === undefined) return answer;
  return { ...own,
    ...(associations || exclude ? { files: { ...files, ...(associations ? { associations } : {}), ...(exclude ? { exclude } : {}) } } : {}),
    ...(run !== undefined ? { diagnostics: { ...diagnostics, run } } : {}) };
}
