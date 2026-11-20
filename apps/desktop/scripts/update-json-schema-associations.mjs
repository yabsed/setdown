// Snapshot which JSON schema VS Code applies to which file without any setting. In VS Code the
// table comes from `contributes.jsonValidation` of every installed extension
// (vendor/vscode/extensions/json-language-features/client/src/jsonClient.ts,
// `getSchemaExtensionAssociations`). Setdown has no extensions, so the entries of the extensions
// built into VS Code are written out here once, and the schema files those extensions ship are
// copied beside them. Reads `vendor/vscode` only; writes
//   src/main/language/catalog/json-schema-associations.json
//   src/main/language/catalog/json-schemas/
// src/main/language/json-builtin-schemas.ts reads the result, and its test compares the result
// with `vendor/vscode`, so a newer submodule fails that test until this script has run again.
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const app = fileURLToPath(new URL('../', import.meta.url));
const vscode = path.resolve(app, '../../vendor/vscode');
const catalog = path.join(app, 'src/main/language/catalog');
const schemas = path.join(catalog, 'json-schemas');
const licenceFile = 'VSCODE-LICENSE.txt';

/** A place only VS Code has: its settings folders (jsonClient.ts replaces these three names by
 * `/User`, `/Machine` and `/Workspaces`) and its own `vscode://` documents. */
const ownPlace = pattern => /^!?(%(APP_SETTINGS_HOME|MACHINE_SETTINGS_HOME|APP_WORKSPACES_HOME)%|vscode:\/\/)/.test(pattern);

/** Why an entry is of no use outside VS Code, or nothing when it is kept. */
function reasonToSkip(patterns, url) {
  if (url.startsWith('vscode://'))
    return 'The schema describes VS Code itself (its settings, keybindings, snippets, themes and extension manifests). VS Code generates it while running and serves it under vscode://, which nothing else can read.';
  if (!url.startsWith('./') && !/^https?:\/\//.test(url))
    return `The address is served by the extension's own code inside VS Code (${url.slice(0, url.indexOf(':') + 1)}), which nothing else can read.`;
  if (patterns.every(ownPlace))
    return "Every file it applies to is in VS Code's own settings folder, which a project does not have.";
  if (patterns.some(ownPlace))
    throw new Error(`Classify by hand: ${JSON.stringify(patterns)} mixes VS Code's own places with project files.`);
  return undefined;
}

/** The comment a file starts with, where a licence would be stated. JSON has none. */
function leadingComment(text) {
  const match = /^﻿?\s*(\/\*[\s\S]*?\*\/|(?:\/\/[^\n]*\n\s*)+)/.exec(text);
  return match ? match[1].trim() : null;
}

const associations = [], skipped = [], files = [], copies = [];
for (const extension of (await readdir(path.join(vscode, 'extensions'))).sort()) {
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(vscode, 'extensions', extension, 'package.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue; throw error; }
  const contributed = manifest.contributes?.jsonValidation;
  if (contributed === undefined) continue;
  if (!Array.isArray(contributed)) throw new Error(`${extension}: jsonValidation is not a list.`);
  for (const { fileMatch, url } of contributed) {
    // jsonClient.ts takes a single pattern or a list, and an address that is text.
    const patterns = typeof fileMatch === 'string' ? [fileMatch] : fileMatch;
    if (!Array.isArray(patterns) || !patterns.length || patterns.some(pattern => typeof pattern !== 'string') || typeof url !== 'string')
      throw new Error(`${extension}: classify by hand: ${JSON.stringify({ fileMatch, url })}`);
    const reason = reasonToSkip(patterns, url);
    if (reason) { skipped.push({ extension, fileMatch, url, reason }); continue; }
    if (!url.startsWith('./')) { associations.push({ extension, fileMatch, url }); continue; }
    // A schema the extension ships: `./` is relative to the extension's folder.
    const source = path.join(vscode, 'extensions', extension, url);
    if (path.relative(path.join(vscode, 'extensions', extension), source).startsWith('..')) throw new Error(`${extension}: ${url} is outside the extension.`);
    const file = `${extension}/${path.basename(url)}`;
    associations.push({ extension, fileMatch, url, file });
    if (files.some(copied => copied.path === file)) continue;
    if (typeof manifest.license !== 'string') throw new Error(`${extension}: states no licence for ${url}.`);
    files.push({ path: file, from: `extensions/${extension}/${url.slice(2)}`, extensionLicence: manifest.license, licenceHeader: leadingComment(await readFile(source, 'utf8')) });
    copies.push([source, path.join(schemas, file)]);
  }
}

await rm(schemas, { recursive: true, force: true });
for (const [from, to] of copies) { await mkdir(path.dirname(to), { recursive: true }); await copyFile(from, to); }
// The copied files carry no notice of their own; the repository's licence covers them.
await mkdir(schemas, { recursive: true });
await copyFile(path.join(vscode, 'LICENSE.txt'), path.join(schemas, licenceFile));
await writeFile(path.join(catalog, 'json-schema-associations.json'), JSON.stringify({
  source: 'https://github.com/microsoft/vscode/tree/' + execFileSync('git', ['rev-parse', 'HEAD'], { cwd: vscode, encoding: 'utf8' }).trim() + '/extensions',
  vscode: JSON.parse(await readFile(path.join(vscode, 'package.json'), 'utf8')).version,
  licence: { name: 'MIT', file: `json-schemas/${licenceFile}`, from: 'LICENSE.txt' },
  associations, files, skipped,
}, null, 2) + '\n');
console.log(`${associations.length} associations (${files.length} schema files copied), ${skipped.length} skipped.`);
