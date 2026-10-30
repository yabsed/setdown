import { _electron } from 'playwright';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require=createRequire(path.resolve('apps/desktop/package.json'));
const input=spawn('/usr/bin/python3',[path.resolve('apps/desktop/test/support/electron/wayland-input.py')],{stdio:['pipe','pipe','inherit']});
const lines=createInterface({input:input.stdout})[Symbol.asyncIterator]();
const send=async value=>{input.stdin.write(JSON.stringify(value)+'\n');const r=JSON.parse((await lines.next()).value);if(r.error)throw Error(r.error);};
const ready=JSON.parse((await lines.next()).value);if(!ready.ready)throw Error('Input not ready');
const root=await mkdtemp('/tmp/setdown-wayland-probe-');
await writeFile(root+'/main.cjs',`const {app,BrowserWindow}=require('electron'); global.events=[];global.windows=[];global.create=async()=>{const n=windows.length;const w=new BrowserWindow({width:700,height:600,frame:false});windows.push(w);w.webContents.on('console-message',(_e,...args)=>events.push([n,...args]));await w.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0;background:'+(n?'lightblue':'orange')+'"><div draggable="true" style="height:150px">DRAG '+n+'</div><script>for(const type of ["dragstart","dragenter","dragover","dragleave","drop","dragend","click"])document.addEventListener(type,e=>{if(type==="dragstart")e.dataTransfer.setData("application/x-test","token");else if(["dragenter","dragover","drop"].includes(type)){e.preventDefault();e.dataTransfer.dropEffect="move";}console.log(type,JSON.stringify({x:e.clientX,y:e.clientY,sx:e.screenX,sy:e.screenY,effect:e.dataTransfer?.dropEffect}))})</script>'));};app.whenReady().then(create);`);
const {ELECTRON_RUN_AS_NODE:_,...env}=process.env;
const app=await _electron.launch({executablePath:require('electron'),args:['--ozone-platform=wayland',root+'/main.cjs'],env});
try{
 await app.firstWindow();await new Promise(r=>setTimeout(r,600));
 await send({keyDown:['Super_L'],keys:['Left'],keyUp:['Super_L']});await new Promise(r=>setTimeout(r,500));
 await app.evaluate(()=>global.create());await new Promise(r=>setTimeout(r,500));
 await send({keyDown:['Super_L'],keys:['Right'],keyUp:['Super_L']});await new Promise(r=>setTimeout(r,500));
 console.log('bounds',await app.evaluate(()=>global.windows.map(w=>({bounds:w.getBounds(),focused:w.isFocused()}))));
 await send({click:{x:100,y:80}});await send({pointer:[{x:150,y:80}],button:'down'});
 await send({pointer:[{x:170,y:90},{x:450,y:450},{x:800,y:450},{x:1150,y:450}]});
 await new Promise(r=>setTimeout(r,300));await send({button:'up'});await new Promise(r=>setTimeout(r,300));
 console.log('events',JSON.stringify(await app.evaluate(()=>global.events.map(event => event.slice(0, 3)))));
}finally{await app.close();input.stdin.end();await rm(root,{recursive:true,force:true});}
