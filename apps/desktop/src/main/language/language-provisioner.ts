import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises';
import { languageDefinition } from '../../core/document/language-catalog';
import type { LanguageServerDefinition } from '../../core/document/language-definition';
import type { Options } from './server-registry';
import { LanguagePackageStore } from './language-package-store';
import { ZedLanguageHost, validatePreparedServer, type PreparedLanguageServer } from './zed-language-host';
import mason from './catalog/mason.json';
import zed from './catalog/zed.json';
import adapters from './catalog/zed-profiles.json';
import type { RuntimeLanguageCatalog, ZedAdapterBinding } from './runtime-language-catalog';
import type { LanguageCatalogEntry } from '../../protocol/language';

import { mergeLanguageSettings } from './language-settings';
export { mergeLanguageSettings } from './language-settings';

export class AutomaticDownloadsDisabled extends Error {}

// Zed serializes shell environments from a HashMap. Field order must not change
// the identity of a prepared command across host/application restarts.
const orderedEnvironment = (env: NodeJS.ProcessEnv): Record<string, string> => Object.fromEntries(Object.entries(env)
  .filter((entry): entry is [string, string] => typeof entry[1] === 'string').sort(([a], [b]) => a.localeCompare(b)));

/** One installer per package/workspace configuration, shared by simultaneous document opens. */
export class LanguageProvisioner {
  private readonly host: ZedLanguageHost;
  private readonly offlineHost: ZedLanguageHost;
  private readonly packages: LanguagePackageStore;
  private readonly pending = new Map<string, Promise<PreparedLanguageServer>>();
  private readonly installed = new Map<string, string>();
  private inventory?: Promise<{ servers: string[]; languages: string[] }>;
  private loading: Promise<unknown> = Promise.resolve();
  private readonly environments = new Map<string, Promise<NodeJS.ProcessEnv>>();
  constructor(private readonly directory: string, executable: string, download: typeof fetch = fetch, private readonly catalog?: RuntimeLanguageCatalog) {
    this.host = new ZedLanguageHost(directory, executable);
    this.offlineHost = new ZedLanguageHost(directory, executable, { ...process.env, SETDOWN_LANGUAGE_HOST_OFFLINE: '1' });
    this.packages = new LanguagePackageStore(path.join(directory, 'extensions'), download);
  }
  private hostInventory() {
    return this.inventory ??= this.host.request<{ servers: string[]; languages: string[] }>('inventory').catch(error => { this.inventory = undefined; throw error; });
  }
  private binding(definition: LanguageServerDefinition) {
    return this.catalog?.binding(definition.id) ?? (adapters.bindings as ZedAdapterBinding[]).find(binding => binding.id === definition.id);
  }
  private adapterName(definition: LanguageServerDefinition, servers: string[]) {
    const names = [definition.id, definition.provenance?.profile, definition.launch.kind === 'native' ? definition.launch.command : undefined];
    return servers.find(name => names.includes(name));
  }
  async usesZed(definition: LanguageServerDefinition): Promise<boolean> {
    return !!this.binding(definition) || !!this.adapterName(definition, (await this.hostInventory()).servers);
  }
  projectEnvironment(root: string, inherited: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
    const env = orderedEnvironment(inherited);
    const key = JSON.stringify([root, env]);
    let pending = this.environments.get(key);
    if (!pending) {
      pending = this.host.request<Record<string, string>>('environment', { root, env,
        inheritEnvironment: !!(env.VIRTUAL_ENV || env.CONDA_PREFIX || env.SETDOWN_LSP_INHERIT_ENV === '1') });
      this.environments.set(key, pending);
      void pending.catch(() => this.environments.delete(key));
    }
    return pending;
  }
  resetEnvironment(): void { this.environments.clear(); }
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
  async installation(id: string): Promise<LanguageCatalogEntry['preparation']> {
    try {
      const saved = JSON.parse(await readFile(path.join(this.directory, 'installations', id + '.json'), 'utf8'));
      if (!Array.isArray(saved.files) || !saved.files.length) return;
      for (const file of saved.files) {
        const current = await stat(file.path);
        if (!current.isFile() || current.size !== file.size || current.mtimeMs !== file.mtime) return;
      }
      return { state: 'ready', source: 'managed', executable: saved.executable };
    } catch { return undefined; }
  }
  private async recordInstallation(id: string, executable: string, files: Array<{ path: string; size: number; mtime: number }>): Promise<void> {
    const directory = path.join(this.directory, 'installations'); await mkdir(directory, { recursive: true });
    const file = path.join(directory, id + '.json'), staging = file + '.' + randomUUID();
    await writeFile(staging, JSON.stringify({ executable, files }), { mode: 0o600 }); await rename(staging, file);
  }
  prepare(definition: LanguageServerDefinition, languageId: string, root: string, env: NodeJS.ProcessEnv, options: Options,
    progress?: (message: string) => void): Promise<PreparedLanguageServer> {
    env = orderedEnvironment(env);
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
    const { automaticInstall: _downloadPolicy, ...launchOptions } = options;
    const receiptFor = (options: Options) => path.join(this.directory, 'launches', createHash('sha256').update(JSON.stringify([definition,languageId,root,env,options,pkg?.sha256,inputs])).digest('hex') + '.json');
    const receipt = receiptFor(launchOptions);
    // Download policy does not change the installed command. Read legacy receipts
    // too, so turning downloads off never discards a previously validated install.
    let cached: PreparedLanguageServer | undefined;
    for (const candidate of new Set([receipt, receiptFor(options), ...[true, false].flatMap(automaticInstall => [receiptFor({ ...launchOptions, automaticInstall }), receiptFor({ automaticInstall, ...launchOptions })])])) try {
      if((await stat(candidate)).size>4*1024*1024)throw Error('Invalid launch receipt');
      const saved=JSON.parse(await readFile(candidate,'utf8')) as {version:number;prepared:PreparedLanguageServer;files:Array<{path:string;size:number;mtime:number}>};
      if(saved.version!==1 || !saved.files.length)throw Error('Invalid launch receipt');
      for(const file of saved.files){const current=await stat(file.path);if(!current.isFile() || current.size!==file.size || current.mtimeMs!==file.mtime)throw Error('Installed server changed');}
      const prepared = validatePreparedServer(saved.prepared);
      await this.recordInstallation(definition.id, prepared.executable, saved.files).catch(() => {});
      cached = prepared; break;
    }catch{/* A missing or stale receipt is repaired through the actual adapter. */}
    // Ask Zed again before reusing a managed command: a worktree may have gained
    // its own toolchain or external installation since its last connection.
    let resolved: PreparedLanguageServer;
    try { resolved = await this.resolve(definition,languageId,root,env,options,progress); }
    catch (error) {
      if (cached) return cached;
      throw error;
    }
    const prepared={...resolved,env:Object.fromEntries(Object.entries(resolved.env??{}).filter(([key])=>!['NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'].includes(key)))};
    const managed=(file:string)=>{const relative=path.relative(this.directory,file);return relative!=='' && !relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative);};
    const paths=[prepared.executable,...prepared.args.filter(arg=>path.isAbsolute(arg)&&managed(arg))];
    if(paths.some(managed)) {
      const files=(await Promise.all(paths.map(async file=>{try{const info=await stat(file);return info.isFile()?{path:file,size:info.size,mtime:info.mtimeMs}:undefined;}catch{return undefined;}}))).filter((value):value is {path:string;size:number;mtime:number}=>!!value);
      const overrides=Object.fromEntries(Object.entries(prepared.env??{}).filter(([key,value])=>value!==env[key]&&!['NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE'].includes(key)));
      await mkdir(path.dirname(receipt),{recursive:true});await writeFile(receipt,JSON.stringify({version:1,prepared:{...prepared,env:overrides},files}),{mode:0o600});
      await this.recordInstallation(definition.id, prepared.executable, files);
    }
    return prepared;
  }
  private async resolve(definition: LanguageServerDefinition, languageId: string, root: string, env: NodeJS.ProcessEnv, options: Options,
    progress?: (message: string) => void): Promise<PreparedLanguageServer> {
    const inventory = await this.hostInventory();
    let server = this.adapterName(definition, inventory.servers);
    const binding = this.binding(definition);
    const downloads = options.automaticInstall !== false;
    const disabled = () => new AutomaticDownloadsDisabled(`${definition.name} has no usable external executable or prepared project cache. Automatic downloads are disabled. Choose an executable or enable downloads in Language Support.`);
    if (!server && binding) {
      // WASI extensions own their installation logic and may invoke package
      // managers. Without download permission only a validated receipt is used.
      if (!downloads) throw disabled();
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
      const prepared = await (downloads ? this.host : this.offlineHost).prepare({server,language:name,root,allowBinaryDownload:downloads,env:Object.fromEntries(Object.entries(env).filter((e): e is [string,string] => typeof e[1] === 'string')),
        settings:{[server]:{settings:options.settings??definition.settings,initialization_options:options.initializationOptions??definition.initializationOptions}}},progress).catch(error => {
          if (!downloads && /downloading language servers disabled/i.test(String(error))) throw disabled();
          throw error;
        });
      // Adapter arguments can contain the server script or transport switches.
      // Keep that launch command intact and append only explicit user options.
      return { ...prepared, args: [...prepared.args, ...(options.args ?? [])], languageId:binding?.languageIds?.[languageId]??prepared.languageId,settings:mergeLanguageSettings(prepared.settings,definition.settings,options.settings),
        initializationOptions:mergeLanguageSettings(prepared.initializationOptions,definition.initializationOptions,options.initializationOptions) };
    }
    if (!downloads) throw disabled();
    const source = mason.packages.find(p=>p.id===definition.id)?.source.id;
    if (source?.startsWith('pkg:npm/') && definition.launch.kind === 'native') {
      const at = source.lastIndexOf('@'), pkg = decodeURIComponent(source.slice(8,at)), version=source.slice(at+1).split('?')[0];
      const prepared = validatePreparedServer(await this.host.request<PreparedLanguageServer>('npm',{package:pkg,version,command:definition.launch.command},progress));
      return {...prepared,args:[...prepared.args,...(options.args??definition.launch.args)],languageId:protocolLanguageId(languageId),
        settings:options.settings??definition.settings,initializationOptions:options.initializationOptions??definition.initializationOptions??{}};
    }
    throw Error(`No automatic installer is available for ${definition.name}. Configure its executable in Language Support.`);
  }
  dispose(): void { this.host.dispose(); this.offlineHost.dispose(); this.environments.clear(); }
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
