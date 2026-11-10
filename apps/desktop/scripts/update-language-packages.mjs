// Deterministic, offline language metadata import. Grammars stay separate lazy assets.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { languageNames } from '@shikijs/langs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFile(path.join(desktop, file), 'utf8');
const helix = parse(await read('scripts/language-profiles/upstream/helix-languages.toml'));
const overrides = JSON.parse(await read('scripts/language-profiles/overrides.json'));
const sources = JSON.parse(await read('scripts/language-profiles/sources.json'));
const zed = JSON.parse(await read('src/main/language/catalog/zed.json').catch(() => '{"packages":[]}'));
const grammars = new Map(), aliases = new Map();
for (const name of languageNames) {
  const registrations = (await import(`@shikijs/langs/${name}`)).default;
  const grammar = registrations.find(g => g.name === name) ?? registrations.at(-1);
  grammars.set(name, { name, label: grammar.displayName ?? name, aliases: grammar.aliases ?? [], scope: grammar.scopeName });
  for (const alias of [name, ...(grammar.aliases ?? [])]) aliases.set(alias.toLowerCase(), name);
}
// Vocabulary between upstream catalogs, not editor-surface special cases.
const grammarAliases = {
  'github-action': 'yaml', 'dockercompose': 'yaml', 'gitlab-ci': 'yaml', 'woodpecker-ci': 'yaml',
  'ansible': 'yaml', 'helm': 'helm', 'jsonc': 'jsonc', 'jsonl': 'json', 'jsonnet': 'jsonnet',
  'bash': 'shellscript', 'shell': 'shellscript', 'c-sharp': 'csharp', 'f-sharp': 'fsharp',
  'fortran': 'fortran-free-form', 'fortran-fixed-form': 'fortran-fixed-form',
  'git-commit': 'git-commit', 'git-config': 'ini', 'git-ignore': 'gitignore',
  'dockerfile': 'docker', 'protobuf': 'proto', 'typescriptreact': 'tsx', 'javascriptreact': 'jsx',
  'ocaml-interface': 'ocaml', 'sml': 'sml', 'elisp': 'emacs-lisp', 'common-lisp': 'common-lisp',
  'rust-format-args': 'rust', 'python-format-string': 'python', 'python-string': 'python',
};
function expand(pattern) {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (match) return match[1].split(',').flatMap(part => expand(pattern.slice(0, match.index) + part + pattern.slice(match.index + match[0].length)));
  const characters = /\[([a-zA-Z]+)\]/.exec(pattern);
  return characters ? [...characters[1]].flatMap(part => expand(pattern.slice(0, characters.index) + part + pattern.slice(characters.index + characters[0].length))) : [pattern];
}
const languages = [];
for (const input of helix.language) {
  const sourceId = input['language-id'] ?? input.name;
  const id = overrides.monacoIds[sourceId] ?? sourceId;
  const blocks = input['block-comment-tokens'];
  const block = (Array.isArray(blocks) ? blocks : [blocks]).find(b => typeof b?.start === 'string' && typeof b?.end === 'string');
  const grammar = grammarAliases[sourceId] ?? aliases.get(input.name.toLowerCase()) ?? aliases.get(sourceId.toLowerCase())
    ?? [...grammars.values()].find(g => g.scope === input.scope)?.name;
  const record = { id, sourceId, name: input.name, label: grammar && grammars.get(grammar)?.label || input.name,
    servers: (input['language-servers'] ?? []).map(server => typeof server === 'string' ? server : server.name),
    grammar: grammar && grammars.has(grammar) ? grammar : undefined,
    extensions: [], caseSensitiveExtensions: [], filenames: [], filenamePatterns: [],
    shebangs: input.shebangs ?? [], lineComment: [input['comment-tokens'] ?? input['comment-token']].flat()[0],
    blockComment: block ? [block.start, block.end] : undefined,
    tabSize: input.indent?.['tab-width'], insertSpaces: input.indent?.unit ? !input.indent.unit.includes('\t') : undefined,
  };
  for (const type of input['file-types'] ?? []) {
    if (typeof type === 'string') {
      record[/[A-Z]/.test(type) ? 'caseSensitiveExtensions' : 'extensions'].push('.' + type);
    } else for (const pattern of expand(type.glob)) {
      record[/[/*?]/.test(pattern) ? 'filenamePatterns' : 'filenames'].push(pattern);
    }
  }
  languages.push(record);
}
const normalized = name => name.toLowerCase().replace(/[^a-z0-9+]+/g, '-').replace(/^-|-$/g, '');
const zedLanguages = new Map();
for (const pkg of [...zed.packages].sort((a,b) => b.downloads - a.downloads || a.id.localeCompare(b.id))) for (const input of pkg.languages) {
  if (zedLanguages.has(input.name)) continue;
  const sourceId = normalized(input.name), grammar = aliases.get(sourceId) ?? aliases.get(input.grammar) ?? grammarAliases[sourceId];
  let record = languages.find(l => normalized(l.name) === sourceId || normalized(l.sourceId) === sourceId || l.id === sourceId);
  if (!record) {
    const suffixes = input.path_suffixes ?? [];
    record = { id: overrides.monacoIds[sourceId] ?? sourceId, sourceId, name: sourceId, label: input.name,
      grammar, extensions: suffixes.filter(s => !s.startsWith('.') && s === s.toLowerCase()).map(s => '.' + s),
      caseSensitiveExtensions: suffixes.filter(s => s !== s.toLowerCase()).map(s => '.' + s),
      filenames: suffixes, filenamePatterns: [],
      shebangs: [], lineComment: input.line_comments?.[0]?.trimEnd(),
      blockComment: Array.isArray(input.block_comment) ? input.block_comment : input.block_comment ? [input.block_comment.start,input.block_comment.end] : undefined,
      tabSize: input.tab_size, insertSpaces: input.hard_tabs === undefined ? undefined : !input.hard_tabs };
    languages.push(record);
  }
  record.zedName ??= input.name;
  if (input.grammar) record.treeSitter ??= { extension: pkg.id, config: input.file };
  zedLanguages.set(input.name, record);
}
// Make every bundled grammar selectable, including languages outside upstream snapshots.
for (const grammar of grammars.values()) if (!languages.some(l => l.id === grammar.name)) {
  languages.push({ id: grammar.name, sourceId: grammar.name, name: grammar.name, label: grammar.label,
    grammar: grammar.name, extensions: [], filenames: [], filenamePatterns: [], shebangs: [] });
}
const profiles = JSON.parse(await read('src/main/language/catalog/profiles.json')).profiles;
const zedProfiles = [], bindings = [];
for (const pkg of [...zed.packages].sort((a,b) => b.downloads - a.downloads || a.id.localeCompare(b.id))) for (const [server, config] of Object.entries(pkg.servers)) {
  const supported = config.languages?.length ? config.languages : config.language ? [config.language] : [];
  const records = supported.map(name => ({name, definition: zedLanguages.get(name) ?? languages.find(l => normalized(l.name) === normalized(name) || normalized(l.label) === normalized(name))})).filter(l => l.definition);
  const existing = profiles.find(p => p.id === normalized(server) || p.provenance?.profile === server || p.launch.command === server);
  const id = existing?.id ?? `zed.${pkg.id}.${normalized(server)}`;
  if (bindings.some(b => b.id === id)) continue;
  bindings.push({ id, server, extension: pkg.id, languages: Object.fromEntries(records.map(l => [l.definition.sourceId,l.name])),
    languageIds:Object.fromEntries(records.filter(l=>typeof config.language_ids?.[l.name]==='string').map(l=>[l.definition.sourceId,config.language_ids[l.name]])) });
  if (existing || !records.length || zedProfiles.some(p=>p.id===id)) continue;
  const associations = records.filter(l => !(config.opt_in_languages??[]).includes(l.name)).map(({definition:l}) => ({ languageId:l.sourceId,monacoId:l.id,
    extensions:l.extensions,caseSensitiveExtensions:l.caseSensitiveExtensions,filenames:l.filenames,filenamePatterns:l.filenamePatterns }));
  if (!associations.length) continue;
  const ownsLanguage = records.some(l => pkg.languages.some(own => own.name === l.name));
  const unserved = associations.some(language => ![...profiles,...zedProfiles].some(profile => profile.enabledByDefault && profile.role !== 'supplementary' && profile.languages.some(l => l.languageId === language.languageId)));
  zedProfiles.push({ id,name:server,enabledByDefault:ownsLanguage && unserved,automatic:true,role:ownsLanguage?'primary':'supplementary',languages:associations,
    launch:{kind:'native',command:server,args:[]},rootMarkers:['.git'],settings:{},watchExtensions:[...new Set(associations.flatMap(l=>l.extensions))],watchFiles:[],
    provenance:{source:'Zed',revision:pkg.version,profile:server} });
}
const result = { sources: { helix: sources.helix, zed: zed.zed, shiki: JSON.parse(await read('../../node_modules/@shikijs/langs/package.json')).version }, languages };
const ids = [...profiles,...zedProfiles].map(profile => profile.id);
if (new Set(ids).size !== ids.length) throw Error('Colliding language server identities in imported catalog');
const files = {
  'src/core/document/catalog/languages.json': JSON.stringify(result) + '\n',
  'src/main/language/catalog/zed-profiles.json': JSON.stringify({profiles:zedProfiles,bindings},null,2) + '\n',
  'src/renderer/language/grammar-loaders.ts': '// Generated by scripts/update-language-packages.mjs. No grammar is eagerly imported.\n'
    + 'export const grammarLoaders = {\n' + [...grammars.keys()].map(name => `  ${JSON.stringify(name)}: () => import(${JSON.stringify('@shikijs/langs/' + name)}).then(module => module.default),`).join('\n') + '\n};\n',
};
for (const [file, text] of Object.entries(files)) {
  if (process.argv.includes('--check')) {
    if (await read(file).catch(() => '') !== text) throw Error(`Stale language metadata: ${file}`);
  } else {
    await mkdir(path.dirname(path.join(desktop, file)), { recursive: true });
    await writeFile(path.join(desktop, file), text);
  }
}
console.log(`${languages.length} language definitions; ${grammars.size} lazy grammars; ${helix.language.length} Helix definitions preserved.`);
