import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {createMessageConnection,StreamMessageReader,StreamMessageWriter}=require('vscode-jsonrpc/node');
const root='/tmp/setdown-host-real/workspace',uri=pathToFileURL(root+'/example.yaml').href;
const prepared=(await readFile(new URL('./real-yaml-host.log.txt',import.meta.url),'utf8')).split('\n').filter(line=>line.startsWith('SETDOWN-LANGUAGE/1 ')).map(line=>JSON.parse(line.slice(19))).find(message=>message.result)?.result;
assert(prepared?.executable.includes('/setdown-host-real/data/node/'));
const schema=pathToFileURL(root+'/schema.json').href;
await writeFile(root+'/schema.json',JSON.stringify({type:'object',properties:{name:{type:'string'},enabled:{type:'boolean'}},additionalProperties:false}));
const settings={yaml:{validate:true,hover:true,completion:true,schemaStore:{enable:false},schemas:{[schema]:['*.yaml']}}};
const child=spawn(prepared.executable,prepared.args,{cwd:root,env:{...process.env,...prepared.env},stdio:'pipe'});
const connection=createMessageConnection(new StreamMessageReader(child.stdout),new StreamMessageWriter(child.stdin));
const diagnostics=[];connection.onNotification('textDocument/publishDiagnostics',params=>diagnostics.push(params));
connection.onRequest('workspace/configuration',({items})=>items.map(({section})=>section?section.split('.').reduce((o,k)=>o?.[k],settings)??null:settings));
connection.onRequest('client/registerCapability',()=>null);connection.listen();
const timeout=setTimeout(()=>{child.kill();process.exitCode=1;},30000);
try{
 const capabilities=await connection.sendRequest('initialize',{processId:process.pid,rootUri:pathToFileURL(root).href,capabilities:{workspace:{configuration:true},textDocument:{publishDiagnostics:{versionSupport:true},completion:{completionItem:{snippetSupport:true}}}}});
 await connection.sendNotification('initialized',{});await connection.sendNotification('workspace/didChangeConfiguration',{settings});
 await connection.sendNotification('textDocument/didOpen',{textDocument:{uri,languageId:'yaml',version:1,text:'name: 42\n'}});
 const started=Date.now();while(!diagnostics.some(result=>result.uri===uri&&result.diagnostics.length)){if(Date.now()-started>15000)throw Error('No schema diagnostic');await new Promise(resolve=>setTimeout(resolve,50));}
 assert(diagnostics.some(result=>result.diagnostics.some(d=>/string|type/i.test(d.message))));
 await connection.sendNotification('textDocument/didChange',{textDocument:{uri,version:2},contentChanges:[{text:'name: valid\nena'}]});
 const completion=await connection.sendRequest('textDocument/completion',{textDocument:{uri},position:{line:1,character:3}});
 const items=Array.isArray(completion)?completion:completion.items;assert(items.some(item=>item.label==='enabled'));
 const result={managedNode:prepared.executable,server:prepared.args[0],diagnostics:diagnostics.flatMap(result=>result.diagnostics.map(d=>d.message)),completion:items.map(item=>item.label),capabilities:Object.keys(capabilities.capabilities)};
 await writeFile(new URL('./yaml-feature-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 await connection.sendRequest('shutdown');await connection.sendNotification('exit');
}finally{clearTimeout(timeout);connection.dispose();child.kill();}
