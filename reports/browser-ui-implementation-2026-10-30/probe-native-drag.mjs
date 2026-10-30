import { _electron } from 'playwright';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';
const require=createRequire(path.resolve('apps/desktop/package.json'));
if(process.env.SETDOWN_ISOLATED_DISPLAY!=='1')throw Error('Isolated display required');
const tmp=await mkdtemp('/tmp/setdown-drag-probe-');
await writeFile(`${tmp}/main.cjs`, `const { app, BrowserWindow, WebContentsView }=require('electron'); app.whenReady().then(async()=>{ global.wins=[];global.logs=[]; const s=new BrowserWindow({x:0,y:0,width:650,height:600}); const d=new BrowserWindow({x:700,y:0,width:650,height:600}); wins.push(s,d); for(const [i,w]of wins.entries()){ w.webContents.on('console-message',(_e,...args)=>logs.push([i,...args]));await w.loadURL('data:text/html,<body style="margin:0"><div draggable="true" style="height:80px;background:orange">DRAG</div><script>document.addEventListener("dragstart",e=>{e.dataTransfer.setData("application/x-setdown-tab","token");e.dataTransfer.effectAllowed="copyMove"});for(const type of ["dragenter","dragover","drop","dragend"])document.addEventListener(type,e=>{if(type!=="dragend"){e.preventDefault();e.dataTransfer.dropEffect="move"}console.log(type,e.dataTransfer.dropEffect)})</script>');} s.focus(); });`);
const {ELECTRON_RUN_AS_NODE:_,...env}=process.env;
const app=await _electron.launch({executablePath:require('electron'),args:[`${tmp}/main.cjs`],env});
try{
 await app.firstWindow();
 await new Promise(r=>setTimeout(r,1000));
 console.log('ADOPT',await app.evaluate(({WebContentsView})=>{try{const w=global.wins[0],v=new WebContentsView({webContents:w.webContents});return 'ok'}catch(e){return String(e)}}));
 console.log('ROOT', await app.evaluate(()=>global.wins.map(w=>({kind:w.contentView.constructor.name,web:'webContents' in w.contentView,children:w.contentView.children.length}))));
 for(const layer of [true]){
  await app.evaluate(async({WebContentsView})=>{const v=new WebContentsView();global.wins[0].contentView.addChildView(v);v.setBounds({x:0,y:120,width:600,height:400});v.webContents.on('console-message',(_e,...args)=>global.logs.push(['source-layer',...args]));await v.webContents.loadURL('data:text/html,<body style="height:100vh;margin:0;background:lightblue"><script>for(const type of ["dragenter","dragover","drop"])document.addEventListener(type,e=>{e.preventDefault();e.dataTransfer.dropEffect="move";console.log(type,e.dataTransfer.dropEffect)})</script>')});
  if(layer)await app.evaluate(async({WebContentsView})=>{const v=new WebContentsView();global.wins[1].contentView.addChildView(v);v.setBounds({x:0,y:120,width:600,height:400});v.webContents.on('console-message',(_e,...args)=>global.logs.push(['layer',...args]));await v.webContents.loadURL('data:text/html,<body style="height:100vh;margin:0;background:lightblue"><script>for(const type of ["dragenter","dragover","drop"])document.addEventListener(type,e=>{e.preventDefault();e.dataTransfer.dropEffect="move";console.log(type,e.dataTransfer.dropEffect)})</script>')});
  const points=await app.evaluate(()=>{const a=global.wins[0].getContentBounds(),b=global.wins[1].getContentBounds();global.wins[0].focus();return[a.x+100,a.y+30,b.x+300,b.y+300]});
  await promisify(execFile)('python3',['-c',`import ctypes,ctypes.util,time,sys
x=ctypes.CDLL(ctypes.util.find_library('X11'));t=ctypes.CDLL(ctypes.util.find_library('Xtst'));x.XOpenDisplay.restype=ctypes.c_void_p;x.XFlush.argtypes=[ctypes.c_void_p];t.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong];t.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong];d=x.XOpenDisplay(None);sx,sy,tx,ty=map(int,sys.argv[1:])
def move(a,b):
 t.XTestFakeMotionEvent(d,-1,a,b,0);x.XFlush(d);time.sleep(.04)
move(sx,sy);t.XTestFakeButtonEvent(d,1,1,0);x.XFlush(d);time.sleep(.2)
move(sx+20,sy+15);move(sx+20,ty);move(tx,ty)
time.sleep(.3);t.XTestFakeButtonEvent(d,1,0,0);x.XFlush(d);time.sleep(.3)
`,...points.map(String)]);
 console.log(layer,await app.evaluate(()=>global.logs.splice(0)));
 }
}finally{await app.close();await rm(tmp,{recursive:true,force:true})}
