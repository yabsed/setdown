import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { list } from 'tar';
import { parse } from 'smol-toml';
import type { LanguageDefinition } from '../../core/document/language-catalog';
import { languageDefinitions } from '../../core/document/language-catalog';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import { builtinLanguageServers } from './catalog/profiles';
import bundled from './catalog/zed.json';
import bindings from './catalog/zed-profiles.json';
import type { ExtensionPackage } from './language-package-store';

export type ZedAdapterBinding = { id:string; server:string; extension:string; languages:Record<string,string>; languageIds?:Record<string,string> };
type Binding=ZedAdapterBinding;
export type RuntimeLanguagePackage = ExtensionPackage & { languages: LanguageDefinition[]; profiles: LanguageServerDefinition[]; bindings: Binding[] };
type State = { version:1; checked:number; packages:RuntimeLanguagePackage[] };
const slug=(name:string)=>name.toLowerCase().replace(/[^a-z0-9+]+/g,'-').replace(/^-|-$/g,'');
const packageId=(id:unknown):id is string=>typeof id==='string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(id);

/** Catalog updates are data. Discovering a new language never requires an application rebuild. */
export class RuntimeLanguageCatalog {
  private state:State={version:1,checked:Date.parse(bundled.updatedAt),packages:[]};
  private refreshing?:Promise<State>;
  private timer?:ReturnType<typeof setTimeout>;
  private profilesValue:LanguageServerDefinition[]=[];
  readonly file:string;
  constructor(readonly directory:string,private readonly download:typeof fetch=fetch) {
    this.file=path.join(directory,'catalog.json');
    if(existsSync(this.file)) {
      if(statSync(this.file).size>16*1024*1024)throw Error('Language catalog exceeds its size limit.');
      const saved=JSON.parse(readFileSync(this.file,'utf8')) as State;
      if(saved.version!==1 || !Array.isArray(saved.packages) || !Number.isFinite(saved.checked))throw Error('Invalid saved language catalog.');
      for(const pkg of saved.packages) if(!packageId(pkg.id) || !/^[a-f0-9]{64}$/.test(pkg.sha256) || !Array.isArray(pkg.languages) || !Array.isArray(pkg.profiles) || !Array.isArray(pkg.bindings))throw Error('Invalid saved language package.');
      this.state=saved;this.rebuild();
    }
  }
  get profiles():LanguageServerDefinition[]{return this.profilesValue;}
  get languages():LanguageDefinition[]{return this.state.packages.flatMap(p=>p.languages);}
  definition(id:string):LanguageDefinition|undefined{return this.languages.find(l=>l.id===id || l.sourceId===id)??languageDefinitions.find(l=>l.id===id || l.sourceId===id);}
  binding(id:string):Binding|undefined{return this.state.packages.flatMap(p=>p.bindings).find(b=>b.id===id)??(bindings.bindings as Binding[]).find(b=>b.id===id);}
  package(id:string):ExtensionPackage|undefined{return this.state.packages.find(p=>p.id===id)??bundled.packages.find(p=>p.id===id);}
  private rebuild():void {this.profilesValue=[...new Map(this.state.packages.flatMap(pkg=>pkg.profiles).map(profile=>[profile.id,profile])).values()];}
  schedule(changed:(apply:()=>Promise<void>)=>Promise<void>,unknownFile=false):void {
    if(this.timer || Date.now()-this.state.checked<(unknownFile?5*60*1000:24*60*60*1000))return;
    this.timer=setTimeout(()=>{this.timer=undefined;void this.refresh().then(next=>changed(()=>this.commit(next))).catch(error=>console.warn('Language catalog refresh:',String(error)));},5000);
    this.timer.unref();
  }
  refresh():Promise<State> {
    return this.refreshing??=this.readUpdates().finally(()=>{this.refreshing=undefined;});
  }
  async commit(state:State):Promise<void> {
    await mkdir(this.directory,{recursive:true});
    await writeFile(this.file+'.tmp',JSON.stringify(state),{mode:0o600});await rename(this.file+'.tmp',this.file);
    this.state=state;this.rebuild();
  }
  private async readUpdates():Promise<State> {
    const indexes=await Promise.all(['languages','language-servers'].map(async provides=>{
      const response=await this.download(`https://api.zed.dev/extensions?max_schema_version=1&provides=${provides}`,{signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error(`Language index: ${response.status}`);
      const value=await response.json() as {data:Array<{id:string;version:string}>};
      if(!Array.isArray(value.data) || value.data.length>10000)throw Error('Invalid language index');return value.data;
    }));
    const entries=[...new Map(indexes.flat().map(p=>[p.id,p])).values()];
    const packages=new Map(this.state.packages.map(p=>[p.id,p]));
    for(const entry of entries) {
      if(!packageId(entry.id) || !/^[\w.+-]{1,80}$/.test(entry.version))continue;
      if((packages.get(entry.id)??bundled.packages.find(p=>p.id===entry.id))?.version===entry.version)continue;
      try {
        const url=`https://api.zed.dev/extensions/${entry.id}/${entry.version}/download`;
        const response=await this.download(url,{signal:AbortSignal.timeout(120000)});
        if(!response.ok)throw Error(`Extension ${entry.id}: ${response.status}`);
        const bytes=await boundedArchive(response);
        const pkg=await importLanguageArchive(this.directory,{...entry,url,sha256:createHash('sha256').update(bytes).digest('hex')},bytes,[...languageDefinitions,...this.languages],[...builtinLanguageServers,...this.profiles]);
        packages.set(entry.id,pkg);
      }catch(error){console.warn(`Language package ${entry.id} was not updated:`,String(error));}
    }
    return {version:1,checked:Date.now(),packages:[...packages.values()]};
  }
  dispose():void{if(this.timer)clearTimeout(this.timer);}
}
async function boundedArchive(response:Response):Promise<Buffer>{
  const reader=response.body?.getReader();if(!reader)throw Error('Empty extension archive');
  const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>128*1024*1024)throw Error('Extension archive is too large');chunks.push(value);}}
  finally{await reader.cancel();}return Buffer.concat(chunks);
}
export async function importLanguageArchive(directory:string,pkg:ExtensionPackage,bytes:Uint8Array,knownLanguages:readonly LanguageDefinition[]=languageDefinitions,knownProfiles:readonly LanguageServerDefinition[]=builtinLanguageServers):Promise<RuntimeLanguagePackage>{
  if(!packageId(pkg.id) || createHash('sha256').update(bytes).digest('hex')!==pkg.sha256)throw Error('Invalid language archive identity');
  await mkdir(directory,{recursive:true});const temporary=await mkdtemp(path.join(directory,'.catalog-'));const archive=path.join(temporary,'extension.tar.gz');
  try {
    await writeFile(archive,bytes);const texts=new Map<string,string>(),pending:Promise<void>[]=[];
    await list({file:archive,onentry(entry){const name=entry.path.replace(/^\.\//,'');
      if(name!=='extension.toml' && !/^languages\/[^/]+\/config\.toml$/.test(name))return;
      if(entry.size>1024*1024)throw Error('Extension metadata exceeds its size limit');
      pending.push(new Promise((resolve,reject)=>{let text='';entry.on('data',data=>{text+=data;});entry.on('error',reject);entry.on('end',()=>{texts.set(name,text);resolve();});}));
    }});await Promise.all(pending);
    const manifest=parse(texts.get('extension.toml')??'') as Record<string,any>;
    if(manifest.id!==pkg.id || manifest.version!==pkg.version)throw Error('Extension manifest identity mismatch');
    const languages:LanguageDefinition[]=[],byName=new Map<string,LanguageDefinition>();
    for(const [config,text] of texts){if(config==='extension.toml')continue;const input=parse(text) as Record<string,any>;
      if(typeof input.name!=='string' || input.name.length>100 || (input.path_suffixes!==undefined && !Array.isArray(input.path_suffixes)))continue;
      const id=slug(input.name),existing=knownLanguages.find(l=>[l.id,l.sourceId,slug(l.name),l.zedName&&slug(l.zedName)].includes(id));
      const suffixes=(input.path_suffixes??[]).filter((s:unknown):s is string=>typeof s==='string' && s.length>0 && s.length<100 && !/[\/\\\0]/.test(s));
      const block=input.block_comment;
      const language:LanguageDefinition={...existing,id:existing?.id??id,sourceId:existing?.sourceId??id,name:existing?.name??id,label:input.name,zedName:input.name,
        extensions:[...new Set([...(existing?.extensions??[]),...suffixes.filter((s:string)=>!s.startsWith('.') && s===s.toLowerCase()).map((s:string)=>'.'+s)])],
        caseSensitiveExtensions:[...new Set([...(existing?.caseSensitiveExtensions??[]),...suffixes.filter((s:string)=>s!==s.toLowerCase()).map((s:string)=>'.'+s)])],
        filenames:[...new Set([...(existing?.filenames??[]),...suffixes])],
        filenamePatterns:existing?.filenamePatterns??[],shebangs:existing?.shebangs??[],
        lineComment:existing?.lineComment??input.line_comments?.[0]?.trimEnd(),blockComment:existing?.blockComment??(Array.isArray(block)?block:block?[block.start,block.end]:undefined),
        tabSize:existing?.tabSize??input.tab_size,insertSpaces:existing?.insertSpaces??(input.hard_tabs===undefined?undefined:!input.hard_tabs),
        treeSitter:input.grammar?{extension:pkg.id,config}:existing?.treeSitter};
      if(!/^[\w.+-]{1,100}$/.test(language.id))continue;languages.push(language);byName.set(input.name,language);
    }
    const profiles:LanguageServerDefinition[]=[],adapters:Binding[]=[];
    for(const [server,untyped] of Object.entries(manifest.language_servers??{})) {
      const value=untyped as Record<string,any>,names:string[]=value.languages?.length?value.languages:value.language?[value.language]:[];
      const records=names.map(name=>({name,definition:byName.get(name)??knownLanguages.find(l=>slug(l.zedName??l.name)===slug(name))})).filter((l):l is {name:string;definition:LanguageDefinition}=>!!l.definition);
      const existing=knownProfiles.find(p=>p.id===slug(server) || p.provenance?.profile===server || p.launch.kind==='native' && p.launch.command===server);
      const id=existing?.id??`zed.${pkg.id}.${slug(server)}`;
      adapters.push({id,server,extension:pkg.id,languages:Object.fromEntries(records.map(l=>[l.definition.sourceId,l.name])),
        languageIds:Object.fromEntries(records.filter(l=>typeof value.language_ids?.[l.name]==='string').map(l=>[l.definition.sourceId,value.language_ids[l.name]]))});
      const associations=records.filter(l=>!(value.opt_in_languages??[]).includes(l.name)).map(({definition:l})=>({languageId:l.sourceId,monacoId:l.id,extensions:l.extensions,caseSensitiveExtensions:l.caseSensitiveExtensions,filenames:l.filenames,filenamePatterns:l.filenamePatterns}));
      if(!associations.length)continue;
      const owns=records.some(l=>byName.has(l.name));
      const unserved=associations.some(l=>![...knownProfiles,...profiles].some(p=>p.enabledByDefault && p.role!=='supplementary' && p.languages.some(other=>other.languageId===l.languageId)));
      profiles.push(existing?{...existing,languages:[...existing.languages,...associations.filter(l=>!existing.languages.some(other=>other.languageId===l.languageId))]}:
        {id,name:server,automatic:true,enabledByDefault:owns&&unserved,role:owns?'primary':'supplementary',languages:associations,launch:{kind:'native',command:server,args:[]},rootMarkers:['.git'],settings:{},watchExtensions:[...new Set(associations.flatMap(l=>l.extensions))],watchFiles:[],provenance:{source:'Zed',revision:pkg.version,profile:server}});
    }
    const cache=path.join(directory,'archives');await mkdir(cache,{recursive:true});await writeFile(path.join(cache,pkg.sha256+'.tar.gz'),bytes,{mode:0o600});
    return {...pkg,languages,profiles,bindings:adapters};
  }finally{await rm(temporary,{recursive:true,force:true});}
}
