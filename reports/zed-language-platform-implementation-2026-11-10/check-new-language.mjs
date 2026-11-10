import { RuntimeLanguageCatalog, LanguageProvisioner, documentLanguage, updateLanguageDefinitions } from './new-language-check.mjs';
import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{create}=require('tar'),{createMessageConnection,StreamMessageReader,StreamMessageWriter}=require('vscode-jsonrpc/node');
const root='/tmp/setdown-new-language-real',directory=root+'/data',project=root+'/project',source=root+'/package',id='setdown-unknown-language',language='Setdown Unknown Language',server='future-language-server';
await mkdir(source+'/languages/future',{recursive:true});await mkdir(project,{recursive:true});
const filename=project+'/Counter.future.svelte';
assert.equal(documentLanguage(filename,[]),'svelte');
await copyFile('/tmp/setdown-host-external/data/extensions/svelte/extension.wasm',source+'/extension.wasm');
await writeFile(source+'/extension.toml',`id="${id}"\nname="Unknown language fixture"\nversion="1.0.0"\nschema_version=1\nlanguages=["languages/future"]\n[lib]\nkind="Rust"\nversion="0.7.0"\n[language_servers.${server}]\nlanguages=["${language}"]\n[language_servers.${server}.language_ids]\n"${language}"="svelte"\n`);
await writeFile(source+'/languages/future/config.toml',`name="${language}"\npath_suffixes=["future.svelte"]\n`);
const archive=root+'/package.tar.gz';await create({gzip:true,cwd:source,file:archive},['extension.toml','extension.wasm','languages']);const bytes=await readFile(archive);
const download=async input=>String(input).includes('/download')?new Response(bytes):Response.json({data:[{id,version:'1.0.0'}]});
const catalog=new RuntimeLanguageCatalog(directory,download);await catalog.commit(await catalog.refresh());updateLanguageDefinitions(catalog.languages);
assert.equal(documentLanguage(filename,[]),id);
const definition=catalog.profiles.find(p=>p.id===`zed.${id}.${server}`);assert(definition?.enabledByDefault);assert.equal(catalog.binding(definition.id).languageIds[id],'svelte');
// Reuse already verified npm dependencies; the actual WASM adapter still resolves and checks them.
const work=directory+'/extensions/work/'+id;await mkdir(work,{recursive:true});await cp('/tmp/setdown-host-external/data/extensions/work/svelte/node_modules',work+'/node_modules',{recursive:true});
const provisioner=new LanguageProvisioner(directory,path.resolve('target/language-host/debug/setdown-language-host'),download,catalog);
let prepared;try{assert(provisioner.canPrepare(definition));prepared=await provisioner.prepare(definition,id,project,{PATH:'/usr/bin:/bin',HOME:root+'/home'},{});}finally{provisioner.dispose();}
assert.equal(prepared.languageId,'svelte');assert(prepared.args[0].includes(id));
const child=spawn(prepared.executable,prepared.args,{cwd:project,env:{...process.env,...prepared.env},stdio:'pipe'});
const connection=createMessageConnection(new StreamMessageReader(child.stdout),new StreamMessageWriter(child.stdin));const diagnostics=[];
connection.onNotification('textDocument/publishDiagnostics',p=>diagnostics.push(p));connection.onRequest('workspace/configuration',({items})=>items.map(()=>null));connection.onRequest('client/registerCapability',()=>null);connection.listen();
const timeout=setTimeout(()=>{child.kill();process.exitCode=1;},45000);
try{
 await connection.sendRequest('initialize',{processId:process.pid,rootUri:pathToFileURL(project).href,initializationOptions:prepared.initializationOptions,capabilities:{workspace:{configuration:true},textDocument:{publishDiagnostics:{versionSupport:true},hover:{contentFormat:['markdown','plaintext']}}}});
 await connection.sendNotification('initialized',{});
 const uri=pathToFileURL(filename).href,text='<script lang="ts">\nlet count: number = "wrong";\n</script>\n<p>{count}</p>\n';
 await connection.sendNotification('textDocument/didOpen',{textDocument:{uri,languageId:prepared.languageId,version:1,text}});
 const start=Date.now();while(!diagnostics.some(d=>d.diagnostics.some(d=>/not assignable/.test(d.message)))){if(Date.now()-start>25000)throw Error('Missing new-language diagnostic: '+JSON.stringify(diagnostics));await new Promise(resolve=>setTimeout(resolve,50));}
 const hover=await connection.sendRequest('textDocument/hover',{textDocument:{uri},position:{line:3,character:5}});assert(hover&&JSON.stringify(hover).includes('number'));
 const result={newLanguage:id,newServer:definition.id,newExtension:id,protocolLanguage:prepared.languageId,registeredWithoutCoreChange:true,actualWasmAdapter:'Svelte 0.2.11, repackaged under new manifest identities for this fixture',diagnostics:diagnostics.flatMap(d=>d.diagnostics.map(d=>d.message)),hover};
 await writeFile(new URL('./new-language-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 await connection.sendRequest('shutdown');await connection.sendNotification('exit');
}finally{clearTimeout(timeout);connection.dispose();child.kill();catalog.dispose();}
