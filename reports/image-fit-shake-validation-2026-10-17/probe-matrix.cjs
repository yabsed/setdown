const {createRequire}=require('node:module');
const root='/home/yabsed/Documents/fall26/work/projects/better-markdown-viewer';
const appRequire=createRequire(root+'/apps/desktop/package.json');
const {_electron,expect}=appRequire('@playwright/test');
const fs=require('node:fs/promises');const path=require('node:path');
const sharp=appRequire('sharp');
(async()=>{
 const tmp=await fs.mkdtemp('/tmp/setdown-shake-probe-');const file=path.join(tmp,'wide.png');
 await sharp({create:{width:1920,height:1080,channels:3,background:'#d05030'}}).png().toFile(file);
 const {ELECTRON_RUN_AS_NODE:_,...env}=process.env;
 const app=await _electron.launch({executablePath:appRequire('electron'),chromiumSandbox:true,cwd:root+'/apps/desktop',args:['.',file],env:{...env,XDG_CONFIG_HOME:path.join(tmp,'profile')}});
 const page=await app.firstWindow();
 const results=[];
 try{
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();});
 await page.getByRole('button',{name:'Edit image',exact:true}).click();
 await expect(page.getByAltText('Edited preview')).toBeVisible();
 for(const zoom of [.9,.8,1.2,1.3])for(const [width,height]of [[921,775],[1920,1080],[1101,801],[1281,1037]])for(const pane of [1,.5]){
  await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setZoomFactor(zoom);w.setSize(width,height);},{width,height,zoom});
  await page.locator('.media-content').evaluate((node,pane)=>node.style.width=`${pane*100}%`,pane);
  const samples=await page.evaluate(()=>new Promise(resolve=>{
   const samples=[];const viewport=document.querySelector('.image-editor .preview'),stage=viewport.querySelector('.stage'),image=stage.querySelector('img');
   const frame=()=>{const v=viewport.getBoundingClientRect(),r=image.getBoundingClientRect(),s=stage.getBoundingClientRect();samples.push({x:r.x,y:r.y,w:r.width,h:r.height,vw:v.width,vh:v.height,cw:viewport.clientWidth,ch:viewport.clientHeight,sw:s.width,sh:s.height,scrollW:viewport.scrollWidth,scrollH:viewport.scrollHeight});if(samples.length<60)requestAnimationFrame(frame);else resolve(samples);};requestAnimationFrame(frame);
  }));
  const steady=samples.slice(20);const ranges=Object.fromEntries(['x','y','w','h','cw','ch','sw','sh'].map(key=>[key,Math.max(...steady.map(x=>x[key]))-Math.min(...steady.map(x=>x[key]))]));
  results.push({width,height,zoom,pane,ranges,samples});console.log(JSON.stringify({width,height,zoom,pane,ranges}));
 }
 await page.screenshot({path:'/tmp/setdown-photo-error-164706/repro.png'});
 await fs.writeFile('/tmp/setdown-photo-error-164706/geometry-matrix-before.json',JSON.stringify(results,null,2));
 }finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();await fs.rm(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
