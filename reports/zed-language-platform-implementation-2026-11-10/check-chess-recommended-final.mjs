import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{createMessageConnection,StreamMessageReader,StreamMessageWriter}=require('vscode-jsonrpc/node');
const root='/home/yabsed/Documents/fall26/work/projects/chess';
const files=['infra/foundation/template.yaml','infra/backend/template.yaml','infra/local/compose.yaml','.github/workflows/deploy.yml','.github/workflows/frontend.yml'];
const settings=JSON.parse(await readFile(new URL('./chess-recommended-settings.json',import.meta.url),'utf8')).lsp['yaml-language-server'].settings;
const prepared=(await readFile(new URL('./real-yaml-host.log.txt',import.meta.url),'utf8')).split('\n').filter(l=>l.startsWith('SETDOWN-LANGUAGE/1 ')).map(l=>JSON.parse(l.slice(19))).find(m=>m.result).result;
const child=spawn(prepared.executable,prepared.args,{cwd:root,env:{...process.env,...prepared.env},stdio:'pipe'});
const c=createMessageConnection(new StreamMessageReader(child.stdout),new StreamMessageWriter(child.stdin));
const diagnostics=[];let configured=0,ready=false;
c.onNotification('textDocument/publishDiagnostics',p=>diagnostics.push(p));
c.onRequest('workspace/configuration',({items})=>{configured++;return items.map(({section})=>section?section.split('.').reduce((o,k)=>o?.[k],settings)??null:settings);});
c.onRequest('client/registerCapability',()=>null);c.onNotification('yaml/schema/store/initialized',()=>{ready=true;});c.listen();
const wait=async predicate=>{const deadline=Date.now()+45000;while(!predicate()){if(Date.now()>deadline)throw Error('Diagnostics timeout');await new Promise(r=>setTimeout(r,50));}};
const timeout=setTimeout(()=>child.kill(),120000),result={workspaceRoot:root,yamlValidate:true,settings:'chess-recommended-settings.json',results:[]};
try{
 await c.sendRequest('initialize',{processId:process.pid,rootUri:pathToFileURL(root).href,workspaceFolders:[{uri:pathToFileURL(root).href,name:'chess'}],capabilities:{workspace:{configuration:true}}});
 await c.sendNotification('yaml/supportSchemaSelection',{});await c.sendNotification('initialized',{});await wait(()=>ready);
 for(const file of files){
  const uri=pathToFileURL(root+'/'+file).href,text=await readFile(root+'/'+file,'utf8'),start=diagnostics.length;
  await c.sendNotification('textDocument/didOpen',{textDocument:{uri,languageId:'yaml',version:1,text}});
  await wait(()=>diagnostics.slice(start).some(d=>d.uri===uri));
  const values=diagnostics.filter(d=>d.uri===uri).at(-1).diagnostics;
  result.results.push({file,diagnostics:values.map(d=>({message:d.message,severity:d.severity,line:d.range.start.line+1}))});
  assert(!values.some(d=>/Unresolved tag:/.test(d.message)),file+': '+JSON.stringify(result.results.at(-1)));
  if(file.includes('compose') || file.startsWith('.github/')){
   const marker='__setdown_invalid__',index=diagnostics.length;
   await c.sendNotification('textDocument/didChange',{textDocument:{uri,version:2},contentChanges:[{text:text+'\n'+marker+': true\n'}]});
   await wait(()=>diagnostics.slice(index).some(d=>d.uri===uri && d.diagnostics.some(d=>d.message.includes(marker))));
   result.results.at(-1).schemaRejectsUnknownProperty=true;
  }
  await c.sendNotification('textDocument/didClose',{textDocument:{uri}});
 }
 await writeFile(new URL('./chess-recommended-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 await c.sendRequest('shutdown');await c.sendNotification('exit');
}finally{clearTimeout(timeout);c.dispose();child.kill();}
