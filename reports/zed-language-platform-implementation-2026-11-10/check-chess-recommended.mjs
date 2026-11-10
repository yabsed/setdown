import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { ZedProjectSettings } from './zed-settings-check.mjs';
const require=createRequire(import.meta.url), {createMessageConnection,StreamMessageReader,StreamMessageWriter}=require('vscode-jsonrpc/node');
const root='/home/yabsed/Documents/fall26/work/projects/chess';
const files=['infra/foundation/template.yaml','infra/backend/template.yaml','infra/local/compose.yaml','.github/workflows/deploy.yml','.github/workflows/frontend.yml'];
const recommended=JSON.parse(await readFile(new URL('./chess-recommended-settings.json',import.meta.url),'utf8')).lsp['yaml-language-server'].settings;
const prepared=(await readFile(new URL('./real-yaml-host.log.txt',import.meta.url),'utf8')).split('\n').filter(line=>line.startsWith('SETDOWN-LANGUAGE/1 ')).map(line=>JSON.parse(line.slice(19))).find(message=>message.result)?.result;
let settings={yaml:{validate:true,schemaStore:{enable:false}}};
const reader=new ZedProjectSettings({home:'/home/yabsed',env:{},platform:'linux'});
const child=spawn(prepared.executable,prepared.args,{cwd:root,env:{...process.env,...prepared.env},stdio:'pipe'});
const connection=createMessageConnection(new StreamMessageReader(child.stdout),new StreamMessageWriter(child.stdin));
const diagnostics=[];connection.onNotification('textDocument/publishDiagnostics',params=>diagnostics.push(params));
connection.onRequest('workspace/configuration',({items})=>items.map(({section})=>section?section.split('.').reduce((o,k)=>o?.[k],settings)??null:settings));
connection.onRequest('client/registerCapability',()=>null);connection.listen();
const timeout=setTimeout(()=>{child.kill();process.exitCode=1;},120000);
const wait=async(predicate)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>60000)throw Error('Timed out waiting for diagnostics');await new Promise(resolve=>setTimeout(resolve,50));}};
const report={workspaceRoot:root,settingsFile:root+'/.zed/settings.json',results:[]};
try{
 await connection.sendRequest('initialize',{processId:process.pid,rootUri:pathToFileURL(root).href,workspaceFolders:[{uri:pathToFileURL(root).href,name:'chess'}],capabilities:{workspace:{configuration:true},textDocument:{publishDiagnostics:{versionSupport:true}}}});
 await connection.sendNotification('initialized',{});
 for(const file of files){
  const uri=pathToFileURL(root+'/'+file).href,text=await readFile(root+'/'+file,'utf8');
  settings={yaml:{validate:true,schemaStore:{enable:false},customTags:[]}};
  await connection.sendNotification('workspace/didChangeConfiguration',{settings});
  const beforeIndex=diagnostics.length;
  await connection.sendNotification('textDocument/didOpen',{textDocument:{uri,languageId:'yaml',version:1,text}});
  await wait(()=>diagnostics.slice(beforeIndex).some(d=>d.uri===uri));
  const before=diagnostics.filter(d=>d.uri===uri).at(-1).diagnostics;
  const inherited=reader.options({id:'yaml-language-server',launch:{kind:'native',command:'yaml-language-server'}},root+'/'+file);
  assert.deepEqual(inherited.settings.yaml.customTags,['!Sub scalar','!Sub sequence']);
  settings=recommended;
  const afterIndex=diagnostics.length;
  await connection.sendNotification('workspace/didChangeConfiguration',{settings});
  await connection.sendNotification('textDocument/didChange',{textDocument:{uri,version:2},contentChanges:[{text:text+'\n'}]});
  await wait(()=>diagnostics.slice(afterIndex).some(d=>d.uri===uri && d.version===2));
  const after=diagnostics.filter(d=>d.uri===uri).at(-1).diagnostics;
  assert(!after.some(d=>/Unresolved tag:/.test(d.message)),file+': '+JSON.stringify(after.map(d=>d.message)));
  const summarize=list=>list.reduce((out,d)=>{out[d.message]=(out[d.message]??0)+1;return out;},{});
  report.results.push({file,customTags:settings.yaml.customTags,before:summarize(before),after:summarize(after)});
  await connection.sendNotification('textDocument/didClose',{textDocument:{uri}});
 }
 await writeFile(new URL('./chess-recommended-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 await connection.sendRequest('shutdown');await connection.sendNotification('exit');
}finally{reader.dispose();clearTimeout(timeout);connection.dispose();child.kill();}
