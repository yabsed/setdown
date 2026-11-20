import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setting } from './extension-rules';
import type { ToolRulesFactory } from './tool-signals';

// Custom data: JSON files that describe a project's own HTML tags and attributes, or its own CSS
// properties, at-rules and pseudo classes, so that the HTML and CSS servers complete and explain
// them like the standard ones. In VS Code a person lists the files in `html.customData` and
// `css.customData`; the extension turns each entry into an address and tells the server the
// addresses. The rules in this file are carried over from the two extensions. Below
// `vendor/vscode/extensions`:
//   html-language-features/client/src/customData.ts   `collectInWorkspaces`, `isURI`, `getContent`, what re-sends the list
//   html-language-features/client/src/htmlClient.ts   `html/customDataChanged`, `html/customDataContent`, `handledSchemas`
//   html-language-features/server/src/htmlServer.ts   `customDataRequestService`: the server asks its editor for every file
//   html-language-features/server/src/customData.ts   what the server does with an answer it cannot use
//   css-language-features/client/src/customData.ts    `getCustomDataPathsInAllWorkspaces`
//   css-language-features/client/src/cssClient.ts     `css/customDataChanged`, `handledSchemas`
//   css-language-features/server/src/cssServer.ts     `updateDataProviders`
//   css-language-features/server/src/requests.ts      `getRequestService`: the server reads `file:` itself
// and vendor/vscode-languageserver-node/jsonrpc/src/common/connection.ts `computeSingleParam`
// for the form a list takes as the one parameter of a message.
//
// Left out: the files other extensions contribute (`contributes.html.customData`,
// `contributes.css.customData`). Setdown has no extensions.

type Settings = Record<string, unknown>;
export type MarkupKind = 'html' | 'css';

/** The setting each extension reads: a list of file paths (package.json of each extension). */
export const customDataSetting: Readonly<Record<MarkupKind, string>> = { html: 'html.customData', css: 'css.customData' };
/** The notification that gives a server the whole list of addresses, replacing the list before. */
export const customDataChangedMethod: Readonly<Record<MarkupKind, string>> = { html: 'html/customDataChanged', css: 'css/customDataChanged' };
/** The request the HTML server makes of its editor for the text of one address. */
export const htmlCustomDataContentMethod = 'html/customDataContent';
/** `initializationOptions.handledSchemas` of both extensions: the server reads `file:` addresses
 * itself. Both servers assume the same when the option is absent (`handledSchemas || ['file']`). */
export const markupHandledSchemas: readonly string[] = ['file'];
/** What the extensions add to the initialization options for this. Nothing else is needed at
 * startup: the addresses go in the notification, once the server runs. The HTML server would
 * also read `dataPaths` here, which no extension sends; it then asks for the files before it
 * has answered `initialize`, so that option is left alone. */
export const customDataOptions: Readonly<Settings> = { handledSchemas: [...markupHandledSchemas] };

const listLimit = 256;
/** html customData.ts `isURI`: an entry that starts like an address is taken as one. */
const isAddress = (entry: string) => /^(?<scheme>\w[\w\d+.-]*):/.test(entry);

/** The addresses a server is told, from the tool's settings and the project folder.
 *
 * Both extensions read the setting for each workspace folder and resolve an entry against that
 * folder (`Utils.resolvePath`): `./data/tags.json` is inside it, `../shared.json` beside it, and
 * a full path stays what it is. An entry that is not text is passed over, and without a folder
 * there are no addresses.
 * HTML keeps an entry that is itself an address (`https://…`, `file:///…`) as written and tells
 * each address once (`collectInWorkspaces`). CSS resolves every entry as a path and tells them
 * in the order written (`getCustomDataPathsInAllWorkspaces`).
 *
 * Setdown has one settings value for a tool in a project, where VS Code has three (folder,
 * workspace file, user) that it adds up. */
export function customDataAddresses(kind: MarkupKind, settings: Settings | undefined, folder: string | undefined): string[] {
  const written = setting(settings, customDataSetting[kind]);
  if (!folder || !Array.isArray(written)) return [];
  const addresses: string[] = [];
  for (const entry of written.slice(0, listLimit)) {
    if (typeof entry !== 'string') continue;
    const address = kind === 'html' && isAddress(entry) ? entry : pathToFileURL(path.resolve(folder, entry)).href;
    if (kind === 'css' || !addresses.includes(address)) addresses.push(address);
  }
  return addresses;
}

/** The notification that tells a server its custom data: after it has started, and again
 * whenever the setting changes (both extensions), or one of the listed files changes (HTML).
 *
 * `params` is the `params` member of the message as it is written to the server: a list with
 * one element, the list of addresses. The extensions pass the addresses as the notification's
 * one parameter, and the connection wraps a parameter that is not an object in a list
 * (`computeSingleParam`). A connection that does this wrapping itself is given `params[0]`.
 * Sent with the bare list of addresses, the server would take the first address for the list. */
export function customDataChanged(kind: MarkupKind, addresses: readonly string[]): { method: string; params: [string[]] } {
  return { method: customDataChangedMethod[kind], params: [[...addresses]] };
}

/** The files on this computer behind the addresses: the ones to watch. The HTML extension
 * sends the list again when one of them changes in the editor (customData.ts
 * `onDidChangeTextDocument`), and the server then reads every file anew. The CSS extension
 * re-sends for a changed setting only; its server also reads every file anew on each
 * notification, so sending the list again after a save has the same effect there. */
export function customDataFiles(addresses: readonly string[]): string[] {
  const files = new Set<string>();
  for (const address of addresses) {
    if (!address.startsWith('file:')) continue;
    try { files.add(fileURLToPath(address)); } catch { /* Not a file on this computer. */ }
  }
  return [...files];
}

/** How each server gets the text behind an address.
 *
 * CSS (`getRequestService`): the server reads a `file:` address from disk itself, and asks its
 * editor with `fs/content` (`{ uri, encoding }`) for any other scheme. Every address of
 * `customDataAddresses('css', …)` is a `file:` address, so the editor is never asked.
 *
 * HTML (`customDataRequestService`): the server reads nothing itself. For every address, of
 * whatever scheme and whatever `handledSchemas` says, it sends `html/customDataContent` with the
 * address as the one parameter and expects the file's text. `handledSchemas` there only decides
 * who lists folders for path completion (`fs/stat`, `fs/readDir`).
 *
 * This is the file to read for such a request, or nothing when the address is not a file on
 * this computer. The parameter arrives as the address, or as a list holding it. The extension
 * reads whatever address the server names (`getContent`); so does this, for a server that
 * Setdown started itself and that could read the same file. */
export function htmlCustomDataFile(params: unknown): string | undefined {
  const address = Array.isArray(params) && params.length === 1 ? params[0] : params;
  if (typeof address !== 'string' || !address.startsWith('file:')) return undefined;
  try { return fileURLToPath(address); } catch { return undefined; }
}

/** Custom data is a description, not a corpus: a larger file is not read into the editor's memory. */
const contentLimit = 16 * 1024 * 1024;
async function readText(file: string): Promise<string> {
  if ((await stat(file)).size > contentLimit) throw new Error('the file is larger than 16 MB');
  return readFile(file, 'utf8');
}

/** The HTML tool's rules for custom data: the option its extension starts it with, and the
 * answer to `html/customDataContent`.
 *
 * The extension answers with the file's text and fails the request when it cannot read the
 * file; the server then goes on without that file's tags, and says nothing (server
 * customData.ts `fetchHTMLDataProviders`). Here an unreadable file is answered with empty
 * text, which the server treats the same way (`parseHTMLData`), and the reason goes to the
 * tool's log. */
export function htmlCustomDataRules(read: (file: string) => Promise<string> = readText): ToolRulesFactory {
  return () => ({
    initializationOptions: { ...customDataOptions },
    requests: {
      [htmlCustomDataContentMethod]: async params => {
        const file = htmlCustomDataFile(params);
        if (!file) return { result: '', signal: { log: [`${customDataSetting.html}: the server asked for an address that is not a file on this computer.`] } };
        try { return { result: await read(file) }; }
        catch (error) { return { result: '', signal: { log: [`${customDataSetting.html}: ${file} could not be read: ${error instanceof Error ? error.message : String(error)}`.slice(0, 4096)] } }; }
      },
    },
  });
}
