import { afterEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { create } from 'tar';
import { RuntimeLanguageCatalog } from './runtime-language-catalog';
import { LanguagePackageStore } from './language-package-store';
import { ServerRegistry } from './server-registry';
import { updateLanguageDefinitions } from '../../core/document/language-catalog';
import { documentLanguage } from '../../core/document/document-profile';
import { languageSupport } from '../../core/document/language-support';

const roots:string[]=[];
afterEach(async()=>{updateLanguageDefinitions([]);await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'setdown-new-language-'));roots.push(root);
 const source=path.join(root,'source');await mkdir(path.join(source,'languages','future'),{recursive:true});
 await writeFile(path.join(source,'extension.toml'),'id="setdown-future-test"\nname="Future language"\nversion="1.0.0"\nschema_version=1\n[language_servers.yaml-language-server]\nlanguages=["Future Test Language"]\n[language_servers.yaml-language-server.language_ids]\n"Future Test Language"="yaml"\n');
 await writeFile(path.join(source,'languages','future','config.toml'),'name="Future Test Language"\ngrammar="yaml"\npath_suffixes=["setdown-future-test"]\nline_comments=["# "]\ntab_size=3\nhard_tabs=false\n');
 const archive=path.join(root,'extension.tar.gz');await create({gzip:true,cwd:source,file:archive},['extension.toml','languages']);
 return {root,bytes:await readFile(archive)};
}
test('an unknown published language is discovered, registered, installed and reopened without application code changes',async()=>{
 const f=await fixture(),directory=path.join(f.root,'data');
 expect(documentLanguage('new.setdown-future-test',[])).toBe('plaintext');
 const download=vi.fn(async(input:Parameters<typeof fetch>[0])=>String(input).includes('/download')?new Response(f.bytes):Response.json({data:[{id:'setdown-future-test',version:'1.0.0'}]}));
 const catalog=new RuntimeLanguageCatalog(directory,download);
 await catalog.commit(await catalog.refresh());
 expect(catalog.languages).toEqual([expect.objectContaining({id:'future-test-language',tabSize:3,insertSpaces:true,lineComment:'#'})]);
 updateLanguageDefinitions(catalog.languages);
 expect(documentLanguage('new.setdown-future-test',[])).toBe('future-test-language');
 const registry=new ServerRegistry(f.root,()=>catalog.profiles);
 expect(languageSupport('new.setdown-future-test',registry.routes())).toEqual({server:'yaml-language-server',languageId:'future-test-language'});
 expect(catalog.binding('yaml-language-server')?.languageIds?.['future-test-language']).toBe('yaml');
 const offline=vi.fn(async()=>{throw Error('offline');});
 const store=new LanguagePackageStore(path.join(directory,'extensions'),offline);
 await Promise.all([store.ensure(catalog.package('setdown-future-test')!),store.ensure(catalog.package('setdown-future-test')!)]);
 expect(offline).not.toHaveBeenCalled();
 expect(await readFile(path.join(directory,'extensions','setdown-future-test','languages','future','config.toml'),'utf8')).toContain('Future Test Language');
 const restored=new RuntimeLanguageCatalog(directory,offline);
 expect(restored.definition('future-test-language')?.treeSitter?.extension).toBe('setdown-future-test');
 expect(restored.profiles.map(p=>p.id)).toEqual(catalog.profiles.map(p=>p.id));
});
test('package downloads are deduplicated, reused offline, and a bad upgrade leaves the working version intact',async()=>{
 const f=await fixture(),directory=path.join(f.root,'extensions');
 const pkg={id:'setdown-future-test',version:'1.0.0',url:'https://api.zed.dev/extensions/setdown-future-test/1.0.0/download',sha256:createHash('sha256').update(f.bytes).digest('hex')};
 const download=vi.fn(async()=>new Response(f.bytes));const store=new LanguagePackageStore(directory,download);
 await Promise.all([store.ensure(pkg),store.ensure(pkg)]);expect(download).toHaveBeenCalledTimes(1);
 await store.ensure(pkg);expect(download).toHaveBeenCalledTimes(1);
 const before=await readFile(path.join(directory,pkg.id,'extension.toml'),'utf8');
 await expect(store.ensure({...pkg,version:'2.0.0',sha256:'0'.repeat(64)})).rejects.toThrow(/checksum/);
 expect(await readFile(path.join(directory,pkg.id,'extension.toml'),'utf8')).toBe(before);
});
