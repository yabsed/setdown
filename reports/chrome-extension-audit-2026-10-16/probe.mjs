import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1') throw Error('Run through apps/desktop/scripts/with-isolated-display.sh');
const repo = path.resolve(process.argv[2] ?? process.cwd());
const cwd = path.join(repo, 'apps/desktop');
const require = createRequire(path.join(cwd, 'package.json'));
const { _electron } = require('playwright');
const root = await mkdtemp('/tmp/setdown-extension-runtime-audit-');
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
const launch = () => _electron.launch({ chromiumSandbox: true, executablePath: require('electron'), cwd, args: ['.'], env: { ...env, XDG_CONFIG_HOME: path.join(root, 'config') } });
const stop = async a => { await a.evaluate(({BrowserWindow}) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(()=>{}); await a.close().catch(()=>{}); };
const poll = async (f, accept, timeout = 20000) => { const until=Date.now()+timeout; let v; do {v=await f(); if(accept(v))return v; await new Promise(r=>setTimeout(r,100));}while(Date.now()<until);throw Error('Audit condition timeout: '+JSON.stringify(v)); };
const server = createServer((req,res) => {res.setHeader('content-type','text/html');res.end('<!doctype html><title>Audit article</title><h1>Audit page</h1>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin = `http://127.0.0.1:${server.address().port}`;
const proxyRequests=[]; const proxy=createServer((req,res)=>{proxyRequests.push(req.url);res.setHeader('access-control-allow-origin','*');res.end('via-audit-proxy');}); await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
let app;
const result = { date: new Date().toISOString(), isolatedDisplay:process.env.SETDOWN_ISOLATED_DISPLAY, observations:{} };
try {
  app=await launch(); await app.firstWindow();
  const userData=await app.evaluate(({app})=>app.getPath('userData'));
  await stop(app); app=null;
  const snapshot = `function snapshot(){return {proxy:typeof chrome.proxy,proxySettings:typeof chrome.proxy?.settings,downloads:typeof chrome.downloads?.download,privacyGet:typeof chrome.privacy?.network?.webRTCIPHandlingPolicy?.get,scripting:typeof chrome.scripting?.executeScript,dnr:typeof chrome.declarativeNetRequest,sessionStorage:typeof chrome.storage.session,browsingData:typeof chrome.browsingData,browserSame:globalThis.browser===chrome,headerSame:globalThis.browser?.webRequest?.onHeadersReceived===chrome.webRequest?.onHeadersReceived,runtimeExternal:typeof chrome.runtime.onMessageExternal,setUninstallURL:typeof chrome.runtime.setUninstallURL,sessionSetAccessLevel:typeof chrome.storage.session?.setAccessLevel,badgeTextColor:typeof chrome.action?.setBadgeTextColor,actionBadge:typeof chrome.action?.setBadgeText};}`;
  for (const mv of [2,3]) {
    const dir=path.join(userData,'extensions','audit-mv'+mv); await mkdir(dir,{recursive:true});
    const manifest={manifest_version:mv,name:'Audit MV'+mv,version:'1.0',permissions:['storage','tabs','downloads','proxy','privacy','scripting','webRequest'],optional_permissions:['notifications'],content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js']}],...(mv===2?{browser_action:{default_popup:'popup.html'},background:{scripts:['background.js']}}:{action:{default_popup:'popup.html'},background:{service_worker:'background.js'},host_permissions:['http://127.0.0.1/*']})};
    if(mv===3)manifest.permissions.push('declarativeNetRequest','webRequestAuthProvider','browsingData');
    await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest));
    await writeFile(path.join(dir,'popup.html'),'<html><title>Audit popup MV'+mv+'</title><script src="popup.js"></script><body>Popup</body></html>');
    await writeFile(path.join(dir,'popup.js'),snapshot);
    await writeFile(path.join(dir,'content.js'),'document.documentElement.dataset.auditMV'+mv+'="yes";');
    await writeFile(path.join(dir,'background.js'),snapshot+`chrome.storage.local.set({workerSnapshot:snapshot()}); chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m==='audit-worker'){chrome.tabs.query({active:true,currentWindow:true}).then(t=>reply({snapshot:snapshot(),tabs:t}),e=>reply({error:String(e)}));return true;}});`);
  }
  await writeFile(path.join(userData,'browser-extensions.json'),JSON.stringify([2,3].map(v=>({dir:'audit-mv'+v,enabled:true}))));
  app=await launch(); let stderr=''; app.process().stderr.on('data',d=>{stderr+=d.toString();});
  const shell=await app.firstWindow();
  await app.evaluate(({session})=>{globalThis.__auditWorkerConsole=[];session.fromPartition('persist:setdown-browser').serviceWorkers.on('console-message',(_event,details)=>globalThis.__auditWorkerConsole.push(details));});
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();w.webContents.focus();});
  const extensions=await shell.evaluate(()=>window.marktex.browser.extensions());
  result.extensions=extensions.filter(x=>!x.builtin);
  result.preloads=await app.evaluate(({session})=>session.fromPartition('persist:setdown-browser').getPreloadScripts());
  await shell.evaluate(url=>window.marktex.openLink(url),origin+'/article');
  const articleId=await poll(()=>app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(w=>w.getURL()===url)?.id,origin+'/article'),Boolean);
  result.articleId=articleId;
  for(const mv of [2,3]) {
    const ext=extensions.find(e=>e.name==='Audit MV'+mv); if(!ext?.enabled){result.observations['MV'+mv]={loadFailed:ext};continue;}
    await shell.evaluate(id=>window.marktex.browser.openExtension(id,'popup'),ext.id);
    const popupId=await poll(()=>app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(w=>w.getURL()===url&&!w.isLoading())?.id,`chrome-extension://${ext.id}/popup.html`),Boolean);
    const exec=script=>app.evaluate(({webContents},{id,script})=>webContents.fromId(id).executeJavaScript(script,true),{id:popupId,script});
    await poll(()=>exec('typeof snapshot'),v=>v==='function');
    const observation={popupId,snapshot:await exec('snapshot()'),activeTabs:await exec('chrome.tabs.query({active:true,currentWindow:true})'),workerStorage:await exec('chrome.storage.local.get("workerSnapshot")')};
    observation.download=await exec(`(async()=>{let cb=false,cbValue='unset';const value=await chrome.downloads.download({url:'data:text/plain,audit',filename:'audit.txt'},v=>{cb=true;cbValue=String(v)});return {value:String(value),callback:cb,callbackValue:cbValue,lastError:chrome.runtime.lastError?.message}})()`);
    observation.privacy=await exec(`new Promise(resolve=>{let called=false;chrome.privacy.network.webRTCIPHandlingPolicy.get({},v=>{called=true;resolve({callback:true,value:v})});setTimeout(()=>{if(!called)resolve({callback:false,waitedMs:500})},500)})`);
    observation.permissions=await exec(`(async()=>{const p={permissions:['notifications']};const before=await chrome.permissions.contains(p);const granted=await chrome.permissions.request(p);const after=await chrome.permissions.contains(p);const removed=await chrome.permissions.remove(p);const afterRemove=await chrome.permissions.contains(p);return {before,granted,after,removed,afterRemove}})()`);
    observation.workerMessage=await exec(`Promise.race([chrome.runtime.sendMessage('audit-worker'),new Promise(r=>setTimeout(()=>r({timeout:true}),3000))])`);
    if(mv===3) {
      observation.scripting=await exec(`chrome.scripting.executeScript({target:{tabId:${articleId}},func:()=>{document.documentElement.dataset.scriptAudit='yes';return document.title}})`);
      observation.proxyBefore=await exec(`new Promise(r=>{chrome.proxy.settings.get({},r);setTimeout(()=>r({timeout:true}),1000)})`);
      observation.proxySet=await exec(`new Promise(r=>{chrome.proxy.settings.set({scope:'regular',value:{mode:'fixed_servers',rules:{singleProxy:{scheme:'http',host:'127.0.0.1',port:${proxy.address().port}}}}},()=>r({done:true,error:chrome.runtime.lastError?.message}));setTimeout(()=>r({timeout:true}),1000)})`);
      observation.proxyResolved=await app.evaluate(({session})=>session.fromPartition('persist:setdown-browser').resolveProxy('http://setdown-audit.invalid/route'));
      observation.proxyFetch=await app.evaluate(async ({session})=>{try{return await (await session.fromPartition('persist:setdown-browser').fetch('http://setdown-audit.invalid/route')).text()}catch(e){return {error:String(e)}}});
      observation.proxyRequests=[...proxyRequests];
      observation.proxyNativeControl=await app.evaluate(async ({session},port)=>{const ses=session.fromPartition('persist:setdown-browser');try{await ses.setProxy({mode:'fixed_servers',proxyRules:'http=127.0.0.1:'+port});await ses.closeAllConnections();const resolved=await ses.resolveProxy('http://setdown-audit.invalid/control');const body=await(await ses.fetch('http://setdown-audit.invalid/control')).text();return {resolved,body}}finally{await ses.setProxy({mode:'system'});await ses.closeAllConnections();}},proxy.address().port);
      observation.proxyRequestsAfterControl=[...proxyRequests];
      observation.proxyClear=await exec(`new Promise(r=>{chrome.proxy.settings.clear({scope:'regular'},()=>r({done:true,error:chrome.runtime.lastError?.message}));setTimeout(()=>r({timeout:true}),1000)})`);
      observation.proxyResolvedAfterClear=await app.evaluate(({session})=>session.fromPartition('persist:setdown-browser').resolveProxy('http://setdown-audit.invalid/route'));
      observation.dnr=await exec(`(async()=>{try{const rule={id:999999,priority:1,action:{type:'block'},condition:{urlFilter:'${origin}/dnr-blocked',resourceTypes:['xmlhttprequest']}};await chrome.declarativeNetRequest.updateDynamicRules({addRules:[rule],removeRuleIds:[999999]});return await chrome.declarativeNetRequest.getDynamicRules()}catch(e){return {error:String(e)}}})()`);
      observation.dnrRequest=await app.evaluate(({webContents},{id,url})=>webContents.fromId(id).executeJavaScript(`fetch(${JSON.stringify(url)}).then(r=>({status:r.status}),e=>({error:String(e)}))`),{id:articleId,url:origin+'/dnr-blocked'});
      await exec('chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[999999]})');
      observation.dnrAfterRemoval=await app.evaluate(({webContents},{id,url})=>webContents.fromId(id).executeJavaScript(`fetch(${JSON.stringify(url)}).then(r=>({status:r.status}),e=>({error:String(e)}))`),{id:articleId,url:origin+'/dnr-blocked'});
    }
    result.observations['MV'+mv]=observation;
  }
  await app.evaluate(({session},file)=>{session.fromPartition('persist:setdown-browser').on('will-download',(_e,item)=>item.setSavePath(file));},path.join(root,'blob-export.md'));
  await app.evaluate(({webContents},id)=>webContents.fromId(id).executeJavaScript(`(()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['# Export\\n한글 audit'],{type:'text/markdown'}));a.download='blob-export.md';a.target='_blank';a.click()})()`,true),articleId);
  result.blobDownload=await poll(()=>shell.evaluate(()=>window.marktex.browser.downloads()),rows=>rows.some(r=>r.state==='completed'));
  result.blobFileText=await readFile(path.join(root,'blob-export.md'),'utf8');
  result.workerConsole=await app.evaluate(()=>globalThis.__auditWorkerConsole);
  result.downloadList=await shell.evaluate(()=>window.marktex.browser.downloads());
  await writeFile('/tmp/setdown-extension-audit-runtime-stderr.log',stderr);
  await writeFile('/tmp/setdown-extension-audit-runtime.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {if(app)await stop(app);await new Promise(r=>server.close(r));await new Promise(r=>proxy.close(r));await rm(root,{recursive:true,force:true});}
