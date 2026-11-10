// Read-only source audit. Run from the repository root with Node; no GUI or server starts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { parse } from 'smol-toml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const profiles = JSON.parse(read('apps/desktop/src/main/language/catalog/profiles.json'));
const mason = JSON.parse(read('apps/desktop/src/main/language/catalog/mason.json'));
const helix = parse(read('apps/desktop/scripts/language-profiles/upstream/helix-languages.toml'));
const bundled = await build({
  absWorkingDir: root, write: false, bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  stdin: { contents: `
    export { recognizedLanguage } from './apps/desktop/src/core/document/language-policy';
    export { languageSupport } from './apps/desktop/src/core/document/language-support';
    export { syntaxLanguages } from './apps/desktop/src/renderer/language/syntax-runtime';
  `, resolveDir: root, loader: 'ts' },
});
const module = { exports: {} };
runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url) });
const { recognizedLanguage, languageSupport, syntaxLanguages } = module.exports;

// Execute the installed Monaco basic-language registration declarations only.
// Imports are removed; lazy grammar loaders are captured but never invoked.
// This does not test Chromium rendering or tokenizer correctness.
const entry = 'node_modules/monaco-editor/esm/vs/basic-languages/monaco.contribution.js';
const languages = [];
const registrationFiles = [];
for (const match of read(entry).matchAll(/^import '([^']+)';/gm)) {
  const file = path.posix.normalize(path.posix.join(path.posix.dirname(entry), match[1]));
  registrationFiles.push(file);
  const source = read(file).replace(/^import .*;\s*$/gm, '');
  runInNewContext(source, { registerLanguage: language => languages.push(language) }, { filename: file });
}
const grammarIds = new Set([...languages.map(l => l.id), ...syntaxLanguages.map(l => l.id)]);
const registered = [...languages, ...syntaxLanguages];
const routes = profiles.profiles.flatMap(profile => profile.languages.map(language => ({ ...language, server: profile.id })));
const samples = ['Makefile', 'GNUmakefile', 'fragment.mk', 'config.yaml', 'config.yml',
  '.github/workflows/ci.yaml', 'compose.yaml', '.gitlab-ci.yml', 'Justfile', 'CMakeLists.txt',
  'main.f90', 'app.svelte', 'main.py', 'main.rs', 'main.ts'];
const cases = samples.map(file => {
  const language = recognizedLanguage(file, registered, routes);
  return { file, language, hasRegisteredGrammar: grammarIds.has(language),
    matchingProfiles: profiles.profiles.filter(profile => languageSupport(file, profile.languages.map(l => ({ ...l, server: profile.id })))).map(p => p.id) };
});
const helixMake = helix.language.find(language => language.name === 'make');
const files = [entry, ...registrationFiles, 'apps/desktop/src/core/document/language-policy.ts',
  'apps/desktop/src/core/document/document-profile.ts', 'apps/desktop/src/core/document/language-support.ts',
  'apps/desktop/src/renderer/language/syntax-runtime.ts', 'apps/desktop/scripts/update-language-profiles.py',
  'apps/desktop/scripts/language-profiles/upstream/helix-languages.toml',
  'apps/desktop/src/main/language/catalog/profiles.json', 'apps/desktop/src/main/language/catalog/mason.json'];
const output = {
  scope: 'Actual recognition functions against installed Monaco basic registrations, app syntax metadata, and imported profiles. No saved user overrides, rich-service registration, GUI, tokenization, installation, or server execution.',
  // Optional caller-supplied revision labels; sourceHashes identify the actual inputs.
  setdownRevision: process.argv[2] ?? null,
  zedRevision: process.argv[3] ?? null,
  versions: { monaco: JSON.parse(read('node_modules/monaco-editor/package.json')).version },
  counts: { masonEntries: mason.packages.length, connectionProfiles: profiles.profiles.length,
    mappedMasonEntries: profiles.coverage.filter(item => item.connection === 'profile').length,
    distinctProfileLanguageIds: new Set(routes.map(route => route.languageId)).size,
    helixLanguageDefinitions: helix.language.length,
    helixLanguagesWithoutServerBindings: helix.language.filter(language => !language['language-servers']?.length).length,
    monacoBasicLanguageRegistrations: languages.length, appAdditionalGrammarRegistrations: syntaxLanguages.length },
  make: { helixDefinition: helixMake, coverage: profiles.coverage.find(item => item.id === 'autotools-language-server'),
    inProfileRoutes: routes.some(route => route.languageId === 'make' || route.languageId === 'makefile'),
    inMonacoBasicRegistrations: languages.some(language => /make/i.test(language.id)) },
  cases,
  sourceHashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(read(file)).digest('hex')])),
};
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
