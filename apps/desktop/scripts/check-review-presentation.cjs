// Runs actual production modules; Electron targets and Crossnote are injected.
const fs=require('fs'), path=require('path'), assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'../src');
function load(name, stubs={}){
  const file=path.resolve(root,name);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',code)(spec=>{
    if(spec in stubs)return stubs[spec];
    if(spec.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),spec+'.ts')),stubs);
    return require(spec);
  },module,module.exports);
  return module.exports;
}
let passed=0;
async function check(name,fn){await fn(); console.log('PASS',++passed,name);}
(async()=>{
 const {readReviewPresentation}=load('core/preview/review-presentation.ts');
 const pos={sourceLine:120,topRatio:.8,sourceSide:'after',band:[]};
 const request={presentationId:1,bounds:{x:10,y:20,width:800,height:600},position:pos};
 await check('immutable request snapshot',()=>{const r=readReviewPresentation(request);request.position.sourceLine=121;assert.equal(r.position.sourceLine,120);});
 for(const [name,value] of [['null',null],['zero id',{...request,presentationId:0}],['bad bounds',{...request,bounds:{...request.bounds,width:0}}],['bad side',{...request,position:{...pos,sourceSide:'other'}}],['bad band',{...request,position:{...pos,band:[{sourceLine:1,yRatio:NaN}]}}]])await check('reject '+name,()=>assert.equal(readReviewPresentation(value),null));
 const {ReviewPresentationCoordinator}=load('main/preview/review-presentation-coordinator.ts');
 for(const property of ['revision','geometry','page'])await check('reject changed '+property,()=>{let failures=0;const c=new ReviewPresentationCoordinator(()=>failures++);const t={owner:1,view:'a',id:1,revision:2,geometry:'g',page:'p'};const g=c.begin(t);const args={...t,[property]:property==='revision'?3:'other'};assert.equal(c.finish(1,'a',g,args.revision,args.geometry,args.page),null);assert.equal(failures,1);});
 await check('superseded ack cannot commit',()=>{const c=new ReviewPresentationCoordinator(()=>{});const t={owner:1,view:'a',id:1,revision:2,geometry:'g',page:'p'};const old=c.begin(t);const fresh=c.begin({...t,id:2});assert.equal(c.finish(1,'a',old,2,'g','p'),null);assert.equal(c.finish(1,'a',fresh,2,'g','p').id,2);});
 await check('cancel invalidates late ack',()=>{const c=new ReviewPresentationCoordinator(()=>{});const t={owner:1,view:'a',id:1,revision:2,geometry:'g',page:'p'};const n=c.begin(t);c.cancel(1);assert.equal(c.finish(1,'a',n,2,'g','p'),null);});
 const {reviewPresentationPort}=load('renderer/project/source-control/review-presentation-port.ts');
 await check('show position observe batch emits exactly one message',async()=>{const calls=[];const d={showPreview:(...x)=>calls.push(x),sendPreviewCommand:(...x)=>calls.push(x)};const {desktop:p}=reviewPresentationPort(d);p.showPreview('git-diff:x:a',request.bounds);p.sendPreviewCommand('git-diff:x:a',{command:'marktex:position-preview',...pos});p.sendPreviewCommand('git-diff:x:a',{command:'marktex:observe-viewport',observationId:5});assert.equal(calls.length,0);await Promise.resolve();assert.equal(calls.length,1);assert.equal(calls[0][1].position.sourceLine,121);assert.equal(calls[0][1].observation.observationId,5);});
 await check('hide cancels queued presentation before it leaves renderer',async()=>{const calls=[];const {desktop:p}=reviewPresentationPort({showPreview:(...x)=>calls.push(x),sendPreviewCommand:(...x)=>calls.push(x)});p.showPreview('git-diff:x:a',request.bounds);p.showPreview(null,null);await Promise.resolve();assert.deepEqual(calls,[[null,null]]);});
 await check('geometry update retains in-flight final source intent',async()=>{const calls=[];const {desktop:p}=reviewPresentationPort({showPreview(){},sendPreviewCommand:(...x)=>calls.push(x)});p.showPreview('git-diff:x:a',request.bounds);p.sendPreviewCommand('git-diff:x:a',{command:'marktex:position-preview',...pos});await Promise.resolve();p.showPreview('git-diff:x:a',{...request.bounds,width:700});await Promise.resolve();assert.equal(calls[1][1].position.sourceLine,121);assert.equal(calls[1][1].bounds.width,700);});
 await check('ordinary Markdown transport is unchanged',()=>{let count=0;const {desktop:p}=reviewPresentationPort({showPreview(){count++},sendPreviewCommand(){count++}});p.showPreview('document',request.bounds);p.sendPreviewCommand('document',{command:'marktex:position-preview'});assert.equal(count,2);});
 const {renderReviewFragment}=load('main/preview/review-fragment.ts');
 await check('fragment retains preview parse options and exact output',async()=>{let seen;const html='<span class="katex"><math>x</math></span>';const result=await renderReviewFragment({async parseMD(text,options){seen={text,options};return {html}}},'$x$');assert.equal(result,html);assert.deepEqual(seen.options,{isForPreview:true,useRelativeFilePath:false,hideFrontMatter:false,vscodePreviewPanel:{}});});
 await check('blank fragment uses same newline input as page route',async()=>{await renderReviewFragment({async parseMD(text){assert.equal(text,'\n');return{html:''}}},'');});
 await check('fragment parse failures propagate',async()=>{await assert.rejects(renderReviewFragment({async parseMD(){throw new Error('parse')}},'x'),/parse/);});
 const {ReviewNativePresentation}=load('main/preview/review-native-presentation.ts',{'../windows/workspace-zoom':{nativeZoomBounds:(b,z)=>Object.fromEntries(Object.entries(b).map(([k,v])=>[k,Math.round(v*z)]))}});
 function fixture(){const events=[],views=new Map();let zoom=1;const window={isDestroyed:()=>false,getContentSize:()=>[1000,800],webContents:{getZoomFactor:()=>zoom,send:(...x)=>events.push(['shell',...x])}};
 const v={ownerWebContentsId:1,view:{webContents:{id:2,isDestroyed:()=>false,getURL:()=>'/page',getZoomFactor:()=>zoom,send:(...x)=>events.push(['send',...x])},getVisible:()=>false,getBounds:()=>({...request.bounds})}};views.set('a',v);
 const p=new ReviewNativePresentation({views,owner:()=>({window}),navigating:()=>false,applyBounds(){},show:(...x)=>events.push(['show',...x])});p.installed('a',7);return{p,events,views,setZoom:z=>zoom=z};}
 await check('native front is not shown before target acknowledgment',()=>{const f=fixture();f.p.command(1,'a',{...request,command:'marktex:present-review'});assert.ok(!f.events.some(x=>x[0]==='show'));const msg=f.events.find(x=>x[0]==='send')[2];f.p.receive('a',{type:'marktex:review-presentation-ready',presentationId:msg.presentationId,revision:7});assert.equal(f.events.filter(x=>x[0]==='show').length,1);});
 await check('zoom while positioning refuses stale native commit',()=>{const f=fixture();f.p.command(1,'a',{...request,command:'marktex:present-review'});const msg=f.events.find(x=>x[0]==='send')[2];f.setZoom(2);f.p.receive('a',{type:'marktex:review-presentation-ready',presentationId:msg.presentationId,revision:7});assert.ok(!f.events.some(x=>x[0]==='show'));});
 await check('hide during font work cancels stale show',()=>{const f=fixture();f.p.command(1,'a',{...request,command:'marktex:present-review'});const msg=f.events.find(x=>x[0]==='send')[2];f.p.cancel(1);f.p.receive('a',{type:'marktex:review-presentation-ready',presentationId:msg.presentationId,revision:7});assert.ok(!f.events.some(x=>x[0]==='show'));});
 await check('unrelated owner cannot present a review',()=>{const f=fixture();f.p.command(99,'a',{...request,command:'marktex:present-review'});assert.equal(f.events.length,0);});
 const assemblies=[],workerCalls=[];
 let listener,serial=0;
 const worker={on(event,fn){if(event==='message')listener=fn;},postMessage(req){
   if(req.kind!=='render')return;workerCalls.push(req);
   queueMicrotask(()=>listener({kind:'render',id:req.id,ok:true,totalLineCount:20,
     baseHref:'marktex-resource://test/',themeId:'paper',html:'<p>'+req.text+'</p>',
     template:req.fragmentOnly?undefined:'<html>safe</html>',
     requiresFullRuntime:req.text==='diagram',runtime:req.text==='diagram'?'crossnote':'lean'}));
 }};
 class Assembler{async assemble(input){assemblies.push(input);return{supported:true,html:'<p>merged</p>',template:input.needsTemplate?'<html>merged</html>':undefined};}forget(){}seed(){}}
 class Baselines{get(key,text,context){const v=this.value;return v&&v.key===key&&v.text===text&&v.context===context?v.html:undefined;}set(key,text,context,html){this.value={key,text,context,html};}delete(){this.value=null;}clear(){this.value=null;}}
 const {PreviewRenderer}=load('main/preview/preview-renderer.ts',{
   electron:{utilityProcess:{fork:()=>worker}},
   './review-render-client':{ReviewRenderClient:Assembler},
   './review-baseline-cache':{ReviewBaselineCache:Baselines},
   '../../core/document/document-state':{applyTextRevision:d=>d},
   '../../core/preview/preview-preferences':{normalizePreviewTheme:x=>x,previewThemeBackground:()=>''},
 });
 let url='',loads=0;
 const contents={id:10,isDestroyed:()=>false,getURL:()=>url,once(){},send(){}};
 const pv={ownerWebContentsId:1,view:{webContents:contents,getVisible:()=>false,setBackgroundColor(){}}};
 const previews={views:new Map([['git-diff:test:a',pv]]),beforeReviewRender:async()=>{},
   prepareReviewViewport:async()=>{},storeDocument:()=>`marktex-preview://document/${++serial}`,
   loadURL:async(_v,next)=>{loads++;url=next;},markTheme(){},ensureSpare(){},syncTheme(){},waitForUpdate:async()=>{}};
 const renderer=new PreviewRenderer({previews,roots:()=>[],theme:()=> 'paper',workerPath:'/test/render-worker.cjs'});
 const diff={filePath:'/test/note.md',staged:true,originalText:'before',modifiedText:'after',hunks:[]};
 await check('cold Git baseline requests fragment, modified requests full shell',async()=>{await renderer.prepareDiff({},'git-diff:test:a',diff,'paper',1);assert.equal(workerCalls[0].fragmentOnly,true);assert.equal(workerCalls[1].fragmentOnly,false);assert.equal(loads,1);});
 await check('warm Git requests only fragment and performs no navigation',async()=>{workerCalls.length=0;await renderer.prepareDiff({},'git-diff:test:a',{...diff,modifiedText:'edit'},'paper',1);assert.equal(workerCalls.length,1);assert.equal(workerCalls[0].fragmentOnly,true);assert.equal(assemblies.at(-1).needsTemplate,false);assert.equal(loads,1);});
 await check('diagram introduction upgrades lean runtime instead of dropping features',async()=>{workerCalls.length=0;await renderer.prepareDiff({},'git-diff:test:a',{...diff,modifiedText:'diagram'},'paper',1);assert.equal(workerCalls.length,2);assert.equal(workerCalls[0].fragmentOnly,true);assert.equal(workerCalls[1].fragmentOnly,false);assert.equal(loads,2);});
 await check('crossnote-capable page reuses fragment on later diagram edit',async()=>{workerCalls.length=0;await renderer.prepareDiff({},'git-diff:test:a',{...diff,modifiedText:'diagram'},'paper',1);assert.equal(workerCalls.length,1);assert.equal(loads,2);});
 console.log('TOTAL:',passed,'production-module checks passed. Native targets/Crossnote are fakes.');
})().catch(e=>{console.error(e);process.exitCode=1});
