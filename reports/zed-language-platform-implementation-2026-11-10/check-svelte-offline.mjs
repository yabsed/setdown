import { LanguageProvisioner } from './provisioner-check.mjs';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{createMessageConnection,StreamMessageReader,StreamMessageWriter}=require('vscode-jsonrpc/node');
const directory='/tmp/setdown-host-external/data',root='/tmp/setdown-host-external/offline-workspace';
await mkdir(root,{recursive:true});await mkdir(path.join(directory,'archives'),{recursive:true});
const catalog=JSON.parse(await readFile('apps/desktop/src/main/language/catalog/zed.json','utf8')),pkg=catalog.packages.find(p=>p.id==='svelte');
await copyFile(`target/language-catalog/svelte-${pkg.version}.tar.gz`,path.join(directory,'archives',pkg.sha256+'.tar.gz'));
const definition=JSON.parse(await readFile('apps/desktop/src/main/language/catalog/profiles.json','utf8')).profiles.find(p=>p.id==='svelte-language-server');
const environment={PATH:'/usr/bin:/bin',HOME:'/tmp/setdown-host-external/home'};
const noDownload=async()=>{throw Error('Unexpected package network request');};
const first=new LanguageProvisioner(directory,path.resolve('target/language-host/debug/setdown-language-host'),noDownload);
let prepared;
try{prepared=await first.prepare(definition,'svelte',root,environment,{});}finally{first.dispose();}
const offline=new LanguageProvisioner(directory,'/nonexistent-language-host',noDownload);
try{const cached=await offline.prepare(definition,'svelte',root,environment,{});assert.deepEqual(cached,prepared);}finally{offline.dispose();}
const child=spawn(prepared.executable,prepared.args,{cwd:root,env:{...process.env,...prepared.env},stdio:'pipe'});
const connection=createMessageConnection(new StreamMessageReader(child.stdout),new StreamMessageWriter(child.stdin));
const diagnostics=[];connection.onNotification('textDocument/publishDiagnostics',params=>diagnostics.push(params));
connection.onRequest('workspace/configuration',({items})=>items.map(({section})=>section?section.split('.').reduce((o,k)=>o?.[k],prepared.settings)??null:prepared.settings));
connection.onRequest('client/registerCapability',()=>null);connection.listen();
const timeout=setTimeout(()=>{child.kill();process.exitCode=1;},45000);
try{
 await connection.sendRequest('initialize',{processId:process.pid,rootUri:pathToFileURL(root).href,initializationOptions:prepared.initializationOptions,capabilities:{workspace:{configuration:true},textDocument:{publishDiagnostics:{versionSupport:true},hover:{contentFormat:['markdown','plaintext']}}}});
 await connection.sendNotification('initialized',{});await connection.sendNotification('workspace/didChangeConfiguration',{settings:prepared.settings});
 const uri=pathToFileURL(root+'/Counter.svelte').href,text='<script lang="ts">\nlet count: number = "wrong";\n</script>\n<p>{count}</p>\n';
 await connection.sendNotification('textDocument/didOpen',{textDocument:{uri,languageId:'svelte',version:1,text}});
 const start=Date.now();while(!diagnostics.some(d=>d.diagnostics.some(d=>/not assignable/.test(d.message)))){if(Date.now()-start>25000)throw Error('No Svelte type diagnostic: '+JSON.stringify(diagnostics));await new Promise(resolve=>setTimeout(resolve,50));}
 const hover=await connection.sendRequest('textDocument/hover',{textDocument:{uri},position:{line:3,character:5}});
 assert(hover && JSON.stringify(hover).includes('number'));
 const result={extension:pkg.id,version:pkg.version,offlineReopenWithoutHost:true,command:prepared.executable,args:prepared.args,diagnostics:diagnostics.flatMap(d=>d.diagnostics.map(d=>d.message)),hover};
 await writeFile(new URL('./svelte-offline-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 await connection.sendRequest('shutdown');await connection.sendNotification('exit');
}finally{clearTimeout(timeout);connection.dispose();child.kill();}
