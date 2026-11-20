import data from './catalog/json-schema-associations.json';

// In VS Code, which schema applies to which JSON file comes mostly from the extensions: each
// states it in `contributes.jsonValidation` of its package.json, and the JSON extension collects
// every entry and tells its server (`json/schemaAssociations`). Setdown has no extensions. What
// the extensions built into VS Code contribute is written out in
// `catalog/json-schema-associations.json` by `scripts/update-json-schema-associations.mjs`, and
// this file turns it into entries of the server's `json.schemas` setting, which the server
// reads exactly as it reads an association. Below `vendor/vscode/extensions`:
//   json-language-features/client/src/jsonClient.ts   `getSchemaExtensionAssociations`: how an entry is read
//   json-language-features/server/src/jsonServer.ts   `updateConfiguration`: associations and `json.schemas` become the same list
//   */package.json                                    `contributes.jsonValidation`: the entries

/** One `contributes.jsonValidation` entry of an extension built into VS Code, as its
 * package.json writes it. `file`: the schema is a file the extension ships, copied to
 * `catalog/json-schemas/<file>`; `url` is then the extension's own `./schemas/…`. */
export type BuiltinSchemaAssociation = { extension: string; fileMatch: string | string[]; url: string; file?: string };
/** An entry VS Code has and Setdown leaves out, and why. */
export type SkippedSchemaAssociation = { extension: string; fileMatch: string | string[]; url: string; reason: string };
/** A schema file copied from an extension. Its licence is the extension's; no copied file states one itself. */
export type BuiltinSchemaFile = { path: string; from: string; extensionLicence: string; licenceHeader: string | null };

/** In the order VS Code reads them: extensions by folder name, entries as written. */
export const builtinSchemaAssociations: readonly BuiltinSchemaAssociation[] = data.associations;
export const skippedSchemaAssociations: readonly SkippedSchemaAssociation[] = data.skipped;
export const builtinSchemaFiles: readonly BuiltinSchemaFile[] = data.files;
/** The VS Code the entries were read from, and the licence text that goes with the copied files (below `catalog/`). */
export const builtinSchemaSource = { source: data.source, vscode: data.vscode, licence: data.licence } as const;

/** An entry of the JSON server's `json.schemas` setting, and the extension it was carried over
 * from. `origin.file` is set when the schema is one of the copied files. */
export type BuiltinJsonSchema = { fileMatch: string[]; url: string; origin: { extension: string; file?: string } };

/** jsonClient.ts `getSchemaExtensionAssociations`: `fileMatch` is one pattern or a list. The
 * patterns stay as written, a leading `!` (not these files) included. VS Code writes a `/` in
 * front of a pattern that names no folder; the server takes it off again and matches the
 * pattern at any depth either way (vscode-json-languageservice `FilePatternAssociation`). */
const patterns = (fileMatch: string | string[]): string[] => typeof fileMatch === 'string' ? [fileMatch] : fileMatch;

/** The schemas VS Code knows without any setting, as `json.schemas` entries in VS Code's order.
 *
 * `resolve` turns the recorded path of a copied schema file (`typescript-language-features/tsconfig.schema.json`)
 * into an address the server reads itself, a `file:` address of the copy on this computer. An
 * entry whose file it has no address for is left out. Other entries keep their http(s) address.
 *
 * `provided` are the patterns something else already gives a schema for (Zed's own
 * `package.json` and `tsconfig.json`, the entries of Setdown's profile), written exactly as
 * they are written there. Such a pattern is taken out of every entry, and an entry left
 * without a pattern that names files is left out: two schemas for one file are both applied. */
export function builtinJsonSchemas(resolve: (file: string) => string | undefined, provided: Iterable<string> = []): BuiltinJsonSchema[] {
  const given = new Set(provided), schemas: BuiltinJsonSchema[] = [];
  for (const association of builtinSchemaAssociations) {
    const fileMatch = patterns(association.fileMatch).filter(pattern => !given.has(pattern));
    if (!fileMatch.some(pattern => !pattern.startsWith('!'))) continue;
    const url = association.file === undefined ? association.url : resolve(association.file);
    if (!url) continue;
    schemas.push({ fileMatch, url, origin: { extension: association.extension, ...(association.file === undefined ? {} : { file: association.file }) } });
  }
  return schemas;
}

/** The entries as the server's `json.schemas` setting takes them. */
export function jsonSchemasSetting(schemas: readonly BuiltinJsonSchema[]): { fileMatch: string[]; url: string }[] {
  return schemas.map(({ fileMatch, url }) => ({ fileMatch: [...fileMatch], url }));
}
