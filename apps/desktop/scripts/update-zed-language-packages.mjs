// Import published extension manifests/configs, never execute an extension during import.
// Downloaded archives are content-addressed in the generated catalog and reused offline.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import * as tar from 'tar';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cache = path.join(root, 'target/language-catalog');
await mkdir(cache, { recursive: true });
const indexFile = path.join(cache, 'index.json');
let index;
if (process.argv.includes('--refresh')) {
  const lists = await Promise.all(['languages', 'language-servers'].map(async provides => {
    const response = await fetch(`https://api.zed.dev/extensions?max_schema_version=1&provides=${provides}`);
    if (!response.ok) throw Error(`Zed catalog: ${response.status}`);
    return (await response.json()).data;
  }));
  index = [...new Map(lists.flat().map(item => [item.id, item])).values()].sort((a,b) => a.id.localeCompare(b.id,'en'));
  await writeFile(indexFile, JSON.stringify(index, null, 2) + '\n');
} else index = JSON.parse(await readFile(indexFile, 'utf8'));
const packages = [], failures = [];
let cursor = 0;
await Promise.all(Array.from({length: 6}, async () => {
  for (;;) {
    const item = index[cursor++]; if (!item) return;
    try {
      const file = path.join(cache, `${item.id}-${item.version}.tar.gz`);
      let bytes = await readFile(file).catch(() => undefined);
      const url = `https://api.zed.dev/extensions/${encodeURIComponent(item.id)}/${encodeURIComponent(item.version)}/download`;
      if (!bytes) {
        const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw Error(`Download: ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 128 * 1024 * 1024) throw Error('Archive exceeds 128 MiB');
        await writeFile(file, bytes);
      }
      const texts = new Map(), pending = [];
      await tar.t({ file, onentry(entry) {
        const name = entry.path.replace(/^\.\//,'');
        if (name !== 'extension.toml' && !/^languages\/[^/]+\/config\.toml$/.test(name)) return;
        pending.push(new Promise((resolve,reject) => { let text=''; entry.on('data', data => { text += data; }); entry.on('error',reject); entry.on('end', () => { texts.set(name,text); resolve(); }); }));
      }});
      await Promise.all(pending);
      const manifest = parse(texts.get('extension.toml'));
      if (manifest.id !== item.id || manifest.version !== item.version) throw Error('Manifest identity mismatch');
      const languages = [...texts].filter(([name]) => name !== 'extension.toml').map(([file,text]) => ({ file, ...parse(text) }));
      packages.push({ id:item.id, version:item.version, repository:item.repository, url,
        sha256:createHash('sha256').update(bytes).digest('hex'), wasmApiVersion:item.wasm_api_version,
        servers:manifest.language_servers ?? {}, languages, downloads:item.download_count });
      console.log(`${item.id}: ${languages.length} languages, ${Object.keys(manifest.language_servers??{}).length} servers`);
    } catch (error) { failures.push({id:item.id,version:item.version,error:String(error)}); console.error(item.id,String(error)); }
  }
}));
const output = { source:'https://api.zed.dev/extensions', updatedAt:(await stat(indexFile)).mtime.toISOString(), zed:'b5cd310b3b54dfc659fcc06453e6358843dfe216', packages:packages.sort((a,b)=>a.id.localeCompare(b.id,'en')), failures };
await writeFile(path.join(root,'apps/desktop/src/main/language/catalog/zed.json'), JSON.stringify(output,null,2)+'\n');
console.log(`${packages.length} packages, ${packages.reduce((n,p)=>n+p.languages.length,0)} languages, ${failures.length} failures`);
if (failures.length) process.exitCode=1;
