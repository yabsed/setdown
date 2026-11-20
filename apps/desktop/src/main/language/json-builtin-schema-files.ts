import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { builtinJsonSchemas, jsonSchemasSetting } from './json-builtin-schemas';

// Where the schema files copied from VS Code's extensions lie on this computer, and the JSON
// server's settings with VS Code's built-in associations added (`json-builtin-schemas.ts`).
// scripts/build-electron.mjs copies `catalog/json-schemas` beside the main bundle.

const folders = () => [path.join(__dirname, 'json-schemas').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'), path.join(__dirname, 'catalog', 'json-schemas')];
/** The `file:` address of a copied schema, by its recorded path; none when the copy is not there. */
export function builtinSchemaAddress(file: string): string | undefined {
  for (const folder of folders()) {
    const full = path.resolve(folder, file);
    if (full.startsWith(folder + path.sep) && existsSync(full)) return pathToFileURL(full).href;
  }
  return undefined;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** The settings with VS Code's built-in schema associations after the ones already written in
 * `json.schemas`. A file name that already has a schema there, or that `provided` names (the
 * files Zed gives a schema itself), gets no second one: two schemas for one file are both applied. */
export function withBuiltinJsonSchemas(settings: Record<string, unknown> | undefined, provided: Iterable<string> = []): Record<string, unknown> {
  const json = record(settings?.json), own = Array.isArray(json.schemas) ? json.schemas as unknown[] : [];
  const named = own.flatMap(entry => { const match = record(entry).fileMatch; return Array.isArray(match) ? match.filter((name): name is string => typeof name === 'string') : []; });
  return { ...settings, json: { ...json, schemas: [...own, ...jsonSchemasSetting(builtinJsonSchemas(builtinSchemaAddress, [...provided, ...named]))] } };
}
