import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { afterPack, missingStandardLibrary, onNodeModuleFile } from './package-typescript-sdk.mjs';

const library = path.dirname(createRequire(import.meta.url).resolve('typescript/lib/tsserver.js'));

test('only TypeScript’s standard library overrides the packager’s declaration-file exclusion', () => {
  for (const file of ['/app/node_modules/typescript/lib/lib.d.ts', '/app/node_modules/typescript/lib/lib.es2022.full.d.ts',
    'C:\\app\\node_modules\\typescript\\lib\\lib.dom.d.ts']) assert.equal(onNodeModuleFile(file), true, file);
  for (const file of ['/app/node_modules/typescript/lib/typescript.d.ts', '/app/node_modules/typescript/lib/tsserver.js',
    '/app/node_modules/typescript/lib/ko/lib.d.ts', '/app/node_modules/other/lib/lib.d.ts', '/app/node_modules/typescript/lib/library.d.ts'])
    assert.equal(onNodeModuleFile(file), false, file);
});

test('every standard library file of the installed TypeScript is one the packager is told to keep', async () => {
  const names = (await readdir(library)).filter(name => name.endsWith('.d.ts') && name.startsWith('lib.'));
  assert.ok(names.includes('lib.d.ts') && names.length > 50);
  for (const name of names) assert.equal(onNodeModuleFile(path.join('/app/node_modules/typescript/lib', name)), true, name);
});

test('packaging fails when the packaged SDK has no standard library and passes when it is complete', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'setdown-package-typescript-'));
  const packaged = path.join(output, 'resources/app.asar.unpacked/node_modules/typescript/lib');
  const context = { appOutDir: output, packager: { getResourcesDir: directory => path.join(directory, 'resources') } };
  try {
    await assert.rejects(afterPack(context), /lacks \d+ standard library file/);
    await mkdir(packaged, { recursive: true });
    await copyFile(path.join(library, 'tsserver.js'), path.join(packaged, 'tsserver.js'));
    await assert.rejects(afterPack(context), /lib\.d\.ts/);
    const required = (await readdir(library)).filter(name => onNodeModuleFile(path.join('/app/node_modules/typescript/lib', name)));
    for (const name of required.slice(1)) await copyFile(path.join(library, name), path.join(packaged, name));
    assert.deepEqual(await missingStandardLibrary(library, packaged), [required[0]]);
    await copyFile(path.join(library, required[0]), path.join(packaged, required[0]));
    await afterPack(context);
  } finally { await rm(output, { recursive: true, force: true }); }
});
