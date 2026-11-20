import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { builtinSchemaAddress, withBuiltinJsonSchemas } from './json-builtin-schema-files';

type Entry = { fileMatch: string[]; url: string };
const schemas = (settings: Record<string, unknown>) => (settings.json as { schemas: Entry[] }).schemas;

test('a copied schema is found on disk, and a path outside the folder is not', () => {
  const address = builtinSchemaAddress('typescript-language-features/jsconfig.schema.json');
  expect(address).toMatch(/^file:\/\/.*json-schemas\/typescript-language-features\/jsconfig\.schema\.json$/);
  expect(JSON.parse(readFileSync(fileURLToPath(address!), 'utf8'))).toBeTypeOf('object');
  expect(builtinSchemaAddress('../json-schema-associations.json')).toBeUndefined();
  expect(builtinSchemaAddress('missing.schema.json')).toBeUndefined();
});

test("VS Code's associations follow the written ones, and a file that has a schema gets no second", () => {
  const own = [{ fileMatch: ['tsconfig.json', 'tsconfig.*.json'], url: 'https://www.schemastore.org/tsconfig.json' }];
  const added = schemas(withBuiltinJsonSchemas({ json: { schemas: own, validate: { enable: true } }, other: 1 }, ['package.json']));
  expect(added.slice(0, 1)).toEqual(own);
  // What the person wrote beside the schemas stays.
  expect(withBuiltinJsonSchemas({ json: { validate: { enable: true } }, other: 1 })).toMatchObject({ other: 1, json: { validate: { enable: true } } });
  const names = added.slice(1).flatMap(entry => entry.fileMatch);
  expect(names).toEqual(expect.arrayContaining(['composer.json', 'bower.json', '.swcrc', 'typedoc.json', 'devcontainer.json', '*.schema.json', 'openapi.json', 'tsconfig-*.json']));
  for (const name of ['package.json', 'tsconfig.json', 'tsconfig.*.json']) expect(names, name).not.toContain(name);
  // The copied files are read by the server itself, from this computer.
  expect(added.find(entry => entry.fileMatch.includes('jsconfig.json') && entry.url.startsWith('file://'))).toBeDefined();
  expect(schemas(withBuiltinJsonSchemas(undefined)).length).toBeGreaterThan(20);
});
