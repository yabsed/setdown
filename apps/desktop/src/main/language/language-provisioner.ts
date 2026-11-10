import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { languageDefinition } from '../../core/document/language-catalog';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import type { Options } from './server-registry';
import { LanguagePackageStore } from './language-package-store';
import { ZedLanguageHost, validatePreparedServer, type PreparedLanguageServer } from './zed-language-host';
import mason from './catalog/mason.json';
import zed from './catalog/zed.json';
import adapters from './catalog/zed-profiles.json';
import type { RuntimeLanguageCatalog, ZedAdapterBinding } from './runtime-language-catalog';

import { mergeLanguageSettings } from './language-settings';
export { mergeLanguageSettings } from './language-settings';

/** One installer per package/workspace configuration, shared by simultaneous document opens. */
export class LanguageProvisioner {
  private readonly host: ZedLanguageHost;
  private readonly packages: LanguagePackageStore;
  private readonly pending = new Map<string, Promise<PreparedLanguageServer>>();
  private readonly installed = new Map<string, string>();
  private inventory?: Promise<{ servers: string[]; languages: string[] }>;
  private loading: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string, executable: string, download: typeof fetch = fetch, private readonly catalog?: RuntimeLanguageCatalog) {
    this.host = new ZedLanguageHost(directory, executable);
    this.packages = new LanguagePackageStore(path.join(directory, 'extensions'), download);
  }
  rank(definition: LanguageServerDefinition, languageId: string): number {
    const order = (this.catalog?.definition(languageId)??languageDefinition(languageId))?.servers ?? [];
    const index = order.findIndex(id => id === definition.id || id === definition.provenance?.profile || definition.launch.kind === 'native' && id === definition.launch.command);
    return index < 0 ? order.length + 1 : index;
  }
  canPrepare(definition: LanguageServerDefinition): boolean {
    return !!definition.automatic && (!!this.catalog?.binding(definition.id) || adapters.bindings.some(b => b.id === definition.id)
      || mason.packages.some(p => p.id === definition.id && p.source.id.startsWith('pkg:npm/'))
      || ['clangd','rust-analyzer','gopls','yaml-language-server','bash-language-server','vscode-css-language-server','vscode-json-language-server','ruff','ty','pyrefly','basedpyright','vtsls','eslint','tailwindcss-language-server'].includes(definition.id));
  }
  prepare(definition: LanguageServerDefinition, languageId: string, root: string, env: NodeJS.ProcessEnv, options: Options,
    progress?: (message: string) => void): Promise<PreparedLanguageServer> {
    const key = JSON.stringify([definition.id,languageId,root,env,options]);
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.cachedResolve(definition,languageId,root,env,options,progress).finally(() => this.pending.delete(key));
      this.pending.set(key,pending);
    }
    return pending;
  }
  private async cachedResolve(definition: LanguageServerDefinition, languageId: string, root: string, env: NodeJS.ProcessEnv, options: Options,
    progress?: (message: string) => void): Promise<PreparedLanguageServer> {
    const binding=this.catalog?.binding(definition.id)??adapters.bindings.find(b=>b.id===definition.id);
    const pkg=binding&&(this.catalog?.package(binding.extension)??zed.packages.find(p=>p.id===binding.extension));
    const inputs=await Promise.all([...new Set([...definition.rootMarkers,'package.json','package-lock.json','pnpm-lock.yaml','yarn.lock'])].map(async name=>{
      try{const value=await stat(path.join(root,name));return [name,value.size,value.mtimeMs];}catch{return [name];}
    }));
    const key=createHash('sha256').update(JSON.stringify([definition,languageId,root,env,options,pkg?.sha256,inputs])).digest('hex');
    const receipt=path.join(this.directory,'launches',key+'.json');
    try {
      if((await stat(receipt)).size>4*1024*1024)throw Error('Invalid launch receipt');
      const saved=JSON.parse(await readFile(receipt,'utf8')) as {version:number;prepared:PreparedLanguageServer;files:Array<{path:string;size:number;mtime:number}>};
      if(saved.version!==1 || !saved.files.length)throw Error('Invalid launch receipt');
      for(const file of saved.files){const current=await stat(file.path);if(!current.isFile() || current.size!==file.size || current.mtimeMs!==file.mtime)throw Error('Installed server changed');}
      return validatePreparedServer(saved.prepared);
    }catch{/* A missing or stale receipt is repaired through the actual adapter. */}
    const resolved=await this.resolve(definition,languageId,root,env,options,progress);
    const prepared={...resolved,env:Object.fromEntries(Object.entries(resolved.env??{}).filter(([key])=>!['NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'].includes(key)))};
    const managed=(file:string)=>{const relative=path.relative(this.directory,file);return relative!=='' && !relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative);};
    const paths=[prepared.executable,...prepared.args.filter(arg=>path.isAbsolute(arg)&&managed(arg))];
    if(paths.some(managed)) {
      const files=(await Promise.all(paths.map(async file=>{try{const info=await stat(file);return info.isFile()?{path:file,size:info.size,mtime:info.mtimeMs}:undefined;}catch{return undefined;}}))).filter((value):value is {path:string;size:number;mtime:number}=>!!value);
      const overrides=Object.fromEntries(Object.entries(prepared.env??{}).filter(([key,value])=>value!==env[key]&&!['NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'].includes(key)));
      await mkdir(path.dirname(receipt),{recursive:true});await writeFile(receipt,JSON.stringify({version:1,prepared:{...prepared,env:overrides},files}),{mode:0o600});
    }
    return prepared;
  }
  private async resolve(definition: LanguageServerDefinition, languageId: string, root: string, env: NodeJS.ProcessEnv, options: Options,
    progress?: (message: string) => void): Promise<PreparedLanguageServer> {
    this.inventory ??= this.host.request<{servers:string[];languages:string[]}>('inventory').catch(error => { this.inventory=undefined; throw error; });
    const inventory = await this.inventory;
    const names = [definition.id,definition.provenance?.profile,definition.launch.kind === 'native' ? definition.launch.command : undefined];
    let server = inventory.servers.find(name => names.includes(name));
    const binding = this.catalog?.binding(definition.id)??(adapters.bindings as ZedAdapterBinding[]).find(b=>b.id===definition.id);
    if (!server && binding) {
      const pkg = this.catalog?.package(binding.extension)??zed.packages.find(p=>p.id===binding.extension)!;
      await this.packages.ensure(pkg);
      // Serializing the full retained inventory prevents Zed's sync operation from unloading peers.
      const load = this.loading.catch(()=>{}).then(async () => {
        this.installed.set(pkg.id,pkg.version);
        await this.host.request('extensions', {extensions:[...this.installed].map(([id,version])=>({id,version}))});
      });
      this.loading = load; await load; server = binding.server;
    }
    const language = this.catalog?.definition(languageId)??languageDefinition(languageId);
    if (server) {
      const name = binding?.languages[languageId as keyof typeof binding.languages]
        ?? inventory.languages.find(name => [language?.zedName,language?.name,language?.grammar,language?.label,languageId].some(candidate=>candidate?.toLowerCase()===name.toLowerCase()))
        ?? language?.zedName ?? language?.label ?? languageId;
      const prepared = await this.host.prepare({server,language:name,root,env:Object.fromEntries(Object.entries(env).filter((e): e is [string,string] => typeof e[1] === 'string')),
        settings:{[server]:{settings:options.settings??definition.settings,initialization_options:options.initializationOptions??definition.initializationOptions}}},progress);
      return { ...prepared,languageId:binding?.languageIds?.[languageId]??prepared.languageId,settings:mergeLanguageSettings(prepared.settings,definition.settings,options.settings),
        initializationOptions:mergeLanguageSettings(prepared.initializationOptions,definition.initializationOptions,options.initializationOptions) };
    }
    const source = mason.packages.find(p=>p.id===definition.id)?.source.id;
    if (source?.startsWith('pkg:npm/') && definition.launch.kind === 'native') {
      const at = source.lastIndexOf('@'), pkg = decodeURIComponent(source.slice(8,at)), version=source.slice(at+1).split('?')[0];
      const prepared = validatePreparedServer(await this.host.request<PreparedLanguageServer>('npm',{package:pkg,version,command:definition.launch.command},progress));
      return {...prepared,args:[...prepared.args,...(options.args??definition.launch.args)],languageId:protocolLanguageId(languageId),
        settings:options.settings??definition.settings,initializationOptions:options.initializationOptions??definition.initializationOptions??{}};
    }
    throw Error(`No automatic installer is available for ${definition.name}. Configure its executable in Language Support.`);
  }
  dispose(): void { this.host.dispose(); }
  async highlight(languageId: string, text: string): Promise<Array<[number,number,string]>> {
    const grammar = (this.catalog?.definition(languageId)??languageDefinition(languageId))?.treeSitter;
    if (!grammar) return [];
    const pkg = this.catalog?.package(grammar.extension)??zed.packages.find(pkg=>pkg.id===grammar.extension);
    if (!pkg) throw Error('Language grammar package is unavailable.');
    await this.packages.ensure(pkg);
    return this.host.request('highlight',{...grammar,text});
  }
}
/** Syntax dialects retain their editor IDs; the protocol uses the server's base language. */
export function protocolLanguageId(id: string): string {
  const language = languageDefinition(id);
  return language?.grammar === 'yaml' ? 'yaml' : id;
}
