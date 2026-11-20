import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { builtinJsonSchemas, builtinSchemaAssociations, builtinSchemaFiles, builtinSchemaSource, jsonSchemasSetting, skippedSchemaAssociations } from './json-builtin-schemas';

const vendor = path.resolve(__dirname, '../../../../../vendor');
const extensions = path.join(vendor, 'vscode/extensions');
const catalog = path.join(__dirname, 'catalog');
const source = (file: string) => readFileSync(path.join(vendor, file), 'utf8');
const resolve = (file: string) => `file:///app/json-schemas/${file}`;

type Contributed = { extension: string; fileMatch: string | string[]; url: string };
/** Every `contributes.jsonValidation` entry below `vendor/vscode/extensions`, in the order VS Code reads them. */
function contributed(): Contributed[] {
  const entries: Contributed[] = [];
  for (const extension of readdirSync(extensions).sort()) {
    let manifest: { contributes?: { jsonValidation?: { fileMatch: string | string[]; url: string }[] } };
    try { manifest = JSON.parse(readFileSync(path.join(extensions, extension, 'package.json'), 'utf8')); } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) continue; throw error;
    }
    for (const { fileMatch, url } of manifest.contributes?.jsonValidation ?? []) entries.push({ extension, fileMatch, url });
  }
  return entries;
}

test('the recorded entries are the ones the built-in extensions contribute, in the same order', () => {
  // Each entry of `vendor/` is the next one of the kept list or of the skipped list, as written.
  const kept = [...builtinSchemaAssociations], skipped = [...skippedSchemaAssociations], entries = contributed();
  expect(entries.length).toBeGreaterThan(40);
  for (const entry of entries) {
    const same = (recorded: Contributed | undefined) => !!recorded && recorded.extension === entry.extension && recorded.url === entry.url && JSON.stringify(recorded.fileMatch) === JSON.stringify(entry.fileMatch);
    if (same(kept[0])) kept.shift(); else if (same(skipped[0])) skipped.shift();
    else throw new Error(`Not recorded, or out of order: ${JSON.stringify(entry)}. Run scripts/update-json-schema-associations.mjs.`);
  }
  expect([kept, skipped]).toEqual([[], []]);
  expect(builtinSchemaSource.vscode).toBe(JSON.parse(source('vscode/package.json')).version);
});

test('an entry is kept when its schema is an http(s) address or a file of the extension, and for project files', () => {
  for (const { url, file, fileMatch, extension } of builtinSchemaAssociations) {
    if (file === undefined) expect(url, extension).toMatch(/^https?:\/\//);
    else { expect(url.startsWith('./'), url).toBe(true); expect(file).toBe(`${extension}/${path.basename(url)}`); }
    for (const pattern of [fileMatch].flat()) expect(pattern).not.toMatch(/^!?(%|vscode:)/);
  }
  // What is left out is VS Code's own: its schemas, its settings folders, an address only an extension serves.
  expect(skippedSchemaAssociations.length).toBeGreaterThan(20);
  for (const { url, fileMatch, reason } of skippedSchemaAssociations) {
    expect(reason.length).toBeGreaterThan(40);
    expect(/^(?!https?:)[a-z][\w+.-]*:\/\//.test(url) || [fileMatch].flat().every(pattern => /^!?(%[A-Z_]+%|vscode:\/\/)/.test(pattern)), JSON.stringify({ url, fileMatch })).toBe(true);
  }
  expect(skippedSchemaAssociations.filter(entry => entry.url.startsWith('vscode://schemas/')).length).toBeGreaterThan(20);
  // The reading rules are the JSON extension's.
  const client = source('vscode/extensions/json-language-features/client/src/jsonClient.ts');
  expect(client).toContain("if (typeof fileMatch === 'string') {");
  expect(client).toContain("if (uri[0] === '.' && uri[1] === '/') {");
  expect(client).toContain('fm = fm.replace(/%APP_SETTINGS_HOME%/, \'/User\');');
  // The server makes one list of associations and `json.schemas`, so a setting entry does what an association does.
  const server = source('vscode/extensions/json-language-features/server/src/jsonServer.ts');
  expect(server).toContain('Array.prototype.push.apply(languageSettings.schemas, schemaAssociations);');
  expect(server).toContain('languageSettings.schemas.push({ uri, fileMatch: schema.fileMatch, schema: schema.schema, folderUri: schema.folderUri });');
});

test('each copied schema file is the extension\'s file, with the licence the extension states', () => {
  expect(builtinSchemaFiles.map(file => file.path).sort()).toEqual([...new Set(builtinSchemaAssociations.flatMap(entry => entry.file ?? []))].sort());
  for (const file of builtinSchemaFiles) {
    const original = readFileSync(path.join(vendor, 'vscode', file.from));
    expect(readFileSync(path.join(catalog, 'json-schemas', file.path)).equals(original), file.path).toBe(true);
    expect(file.extensionLicence).toBe(JSON.parse(source(`vscode/extensions/${file.path.split('/')[0]}/package.json`)).license);
    expect(file.extensionLicence).toBe('MIT');
    // No file states a licence of its own: each is plain JSON from its first character.
    expect(file.licenceHeader).toBeNull();
    expect(original.toString('utf8').trimStart().startsWith('{')).toBe(true);
    // A copied file names no other file. One that did could not be read from where the copy lies.
    const references = [...original.toString('utf8').matchAll(/"\$ref"\s*:\s*"([^"]*)"/g)].map(match => match[1]);
    expect(references.filter(reference => !reference.startsWith('#')), file.path).toEqual([]);
  }
  expect(readFileSync(path.join(catalog, builtinSchemaSource.licence.file), 'utf8')).toBe(source(`vscode/${builtinSchemaSource.licence.from}`));
  expect(source('vscode/LICENSE.txt')).toMatch(/^MIT License/);
});

test('the entries become json.schemas entries in the same order, each naming its extension', () => {
  const schemas = builtinJsonSchemas(resolve);
  expect(schemas).toHaveLength(builtinSchemaAssociations.length);
  expect(schemas[0]).toEqual({ fileMatch: ['devcontainer.json'], url: 'https://raw.githubusercontent.com/devcontainers/spec/main/schemas/devContainer.schema.json', origin: { extension: 'configuration-editing' } });
  // One pattern or a list, as written.
  expect(schemas.find(schema => schema.url === 'https://www.schemastore.org/openapi-3.X.json')).toEqual({ fileMatch: ['openapi.json', '*.openapi.json'], url: 'https://www.schemastore.org/openapi-3.X.json', origin: { extension: 'json-language-features' } });
  // A file the extension ships is read from where the copy lies.
  expect(schemas.filter(schema => schema.fileMatch.includes('tsconfig.json'))).toEqual([
    { fileMatch: ['tsconfig.json'], url: 'https://www.schemastore.org/tsconfig', origin: { extension: 'typescript-language-features' } },
    { fileMatch: ['tsconfig.json'], url: 'file:///app/json-schemas/typescript-language-features/tsconfig.schema.json', origin: { extension: 'typescript-language-features', file: 'typescript-language-features/tsconfig.schema.json' } },
  ]);
  for (const schema of schemas) expect(schema.url, schema.fileMatch.join()).toMatch(/^(https?|file):\/\//);
  expect(jsonSchemasSetting(schemas.slice(0, 2))).toEqual([
    { fileMatch: ['devcontainer.json'], url: schemas[0].url }, { fileMatch: ['.devcontainer.json'], url: schemas[0].url }]);
});

test('what Zed or Setdown already gives a schema for is left out', () => {
  const schemas = builtinJsonSchemas(resolve, ['package.json', 'tsconfig.json', 'openapi.json']);
  const matched = (pattern: string) => schemas.filter(schema => schema.fileMatch.includes(pattern));
  expect(matched('package.json')).toEqual([]);
  expect(matched('tsconfig.json')).toEqual([]);
  // Only the pattern that is given elsewhere goes; the rest of the entry stays.
  expect(matched('*.openapi.json')).toEqual([{ fileMatch: ['*.openapi.json'], url: 'https://www.schemastore.org/openapi-3.X.json', origin: { extension: 'json-language-features' } }]);
  // A pattern is compared as written: another spelling of tsconfig is another pattern.
  expect(matched('tsconfig.*.json').map(schema => schema.url)).toEqual(['https://www.schemastore.org/tsconfig', 'file:///app/json-schemas/typescript-language-features/tsconfig.schema.json']);
  expect(schemas.length).toBe(builtinSchemaAssociations.length - builtinSchemaAssociations.filter(entry => ['package.json', 'tsconfig.json'].includes(entry.fileMatch as string)).length);
  // A copied file with no address on this computer is left out; an http(s) address needs none.
  const online = builtinJsonSchemas(() => undefined);
  expect(online.length).toBe(builtinSchemaAssociations.filter(entry => entry.file === undefined).length);
  expect(online.every(schema => schema.origin.file === undefined)).toBe(true);
});
