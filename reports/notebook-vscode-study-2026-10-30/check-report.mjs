import { _electron } from '@playwright/test';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url));
if(process.env.SETDOWN_ISOLATED_DISPLAY!=='1')throw new Error('Use isolated display');
const dir=await mkdtemp('/tmp/setdown-report-check-');
await writeFile(path.join(dir,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1200,height:1000,webPreferences:{sandbox:true,contextIsolation:true}});w.loadFile(${JSON.stringify(path.join(out,'index.html'))});});`);
const req=createRequire(path.resolve(out,'../../apps/desktop/package.json'));
const {ELECTRON_RUN_AS_NODE,...env}=process.env;
const app=await _electron.launch({executablePath:req('electron'),chromiumSandbox:true,args:[path.join(dir,'main.cjs')],env});
try{
 const page=await app.firstWindow();await page.waitForLoadState('load');
 // Offscreen report images use lazy loading; request and decode each before inspection.
 await page.evaluate(async()=>{await Promise.all([...document.images].map(image=>{image.loading='eager';return image.decode();}));});
 const desktop=await page.evaluate(()=>({sections:document.querySelectorAll('section').length,bodyOverflow:document.documentElement.scrollWidth>innerWidth,brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src),title:document.title}));
 await page.screenshot({path:path.join(out,'report-preview.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(640,900));
 const narrow=await page.evaluate(()=>({width:innerWidth,bodyOverflow:document.documentElement.scrollWidth>innerWidth}));
 if(desktop.sections!==15||desktop.bodyOverflow||desktop.brokenImages.length||narrow.bodyOverflow)throw new Error(JSON.stringify({desktop,narrow}));
 await writeFile(path.join(out,'report-validation.json'),JSON.stringify({desktop,narrow},null,2));
 console.log(JSON.stringify({desktop,narrow}));
}finally{await app.close();}
