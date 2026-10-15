// Pass the extracted registry.json from the pinned Mason release to this offline importer.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const release = '2026-10-15-sedate-sheep';
const sha256 = '76df9a5627a77983a956b17549483ba2f9292eecafd2150875b3dc4540a91ed1';
const raw = await readFile(process.argv[2]);
if (createHash('sha256').update(raw).digest('hex') !== sha256) throw Error('Unexpected Mason registry checksum');
const packages = JSON.parse(raw).filter(item => item.categories?.includes('LSP')).map(item => ({
  id: item.name, description: item.description.trim(), homepage: item.homepage,
  languages: item.languages ?? [], licenses: item.licenses ?? [],
  source: item.source, executables: Object.keys(item.bin ?? {}),
})).sort((a, b) => a.id.localeCompare(b.id, 'en'));
await writeFile(new URL('../src/main/language/catalog/mason.json', import.meta.url),
  JSON.stringify({ release, sha256, packages }, null, 2) + '\n');
console.log(`Imported ${packages.length} LSP packages from Mason ${release}`);
