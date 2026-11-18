import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * tsserver reads its standard library, `lib.*.d.ts`, from its own directory at
 * run time. electron-builder removes every `.d.ts` under node_modules, so the
 * packaged server reported Array, Promise and console as unknown in every file
 * while the development build, which runs from the repository's node_modules,
 * stayed correct. Only a packaged application can show this.
 */
const standardLibrary = /^lib\.(?:[^\\/]+\.)?d\.ts$/;
const packagedLibrary = /[\\/]node_modules[\\/]typescript[\\/]lib[\\/]lib\.(?:[^\\/]+\.)?d\.ts$/;

/** electron-builder calls this synchronously per file; `true` overrides its default exclusions. */
export function onNodeModuleFile(file) {
  return packagedLibrary.test(file);
}

export async function missingStandardLibrary(source, packaged) {
  const present = new Set(await readdir(packaged).catch(() => []));
  return (await readdir(source)).filter(name => standardLibrary.test(name) && !present.has(name)).sort();
}

/** A package without these files starts and analyses, but every result is wrong. Stop here instead. */
export async function afterPack({ packager, appOutDir }) {
  const source = path.dirname(createRequire(import.meta.url).resolve('typescript/lib/tsserver.js'));
  const packaged = path.join(packager.getResourcesDir(appOutDir), 'app.asar.unpacked/node_modules/typescript/lib');
  const missing = await missingStandardLibrary(source, packaged);
  if (missing.length) {
    throw Error(`The packaged TypeScript SDK lacks ${missing.length} standard library file(s), such as ${missing[0]}, in ${packaged}. `
      + 'TypeScript analysis in the installed application would report built-in types as errors.');
  }
}
