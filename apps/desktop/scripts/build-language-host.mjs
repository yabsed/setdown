import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(desktop,'../..'), project = path.join(root,'tooling/language-host');
const profile = process.env.SETDOWN_LANGUAGE_HOST_PROFILE ?? 'dev';
if (!['dev','release'].includes(profile)) throw Error('Language host profile must be dev or release.');
const target = path.resolve(root,process.env.CARGO_TARGET_DIR ?? 'target/language-host');
const name = process.platform === 'win32' ? 'setdown-language-host.exe' : 'setdown-language-host';
const run = (command,args,options={}) => new Promise((resolve,reject) => {
  const child = spawn(command,args,{stdio:'inherit',...options});
  child.on('error',reject); child.on('exit',code=>code===0?resolve():reject(Error(`${command} exited ${code}`)));
});
await run(process.env.CARGO ?? 'cargo',['build','--locked','--manifest-path',path.join(project,'Cargo.toml'),'-j',process.env.CARGO_BUILD_JOBS ?? '1',...(profile==='release'?['--release']:[])],{
  cwd:project,env:{...process.env,CARGO_TARGET_DIR:target},
});
const binary = path.join(target,profile==='release'?'release':'debug',name);
const data = await mkdtemp(path.join(os.tmpdir(),'setdown-host-build-'));
try {
  // Missing embedded assets, native libraries and protocol drift fail the build, not a user's file open.
  await new Promise((resolve,reject)=>{
    const child=spawn(binary,[data],{stdio:['pipe','pipe','inherit'],windowsHide:true}); let output='';
    const timer=setTimeout(()=>{child.kill();reject(Error('Language host smoke test timed out.'));},60000);
    child.stdout.setEncoding('utf8'); child.stdout.on('data',text=>{output+=text;});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{clearTimeout(timer);try {
      const response=JSON.parse(output.split('\n').find(line=>line.startsWith('SETDOWN-LANGUAGE/1 '))?.slice(19)??'null');
      if(code!==0 || !response?.result?.servers?.includes('yaml-language-server'))throw Error('Language host inventory is invalid.');
      resolve();
    }catch(error){reject(error);}});
    child.stdin.end(JSON.stringify({id:1,op:'inventory'})+'\n');
  });
} finally {await rm(data,{recursive:true,force:true});}
const destination=path.join(desktop,'dist-electron/language-host');await mkdir(destination,{recursive:true});
await copyFile(binary,path.join(destination,name));
await copyFile(path.join(root,'vendor/zed/LICENSE-GPL'),path.join(destination,'ZED-LICENSE-GPL'));
await copyFile(path.join(root,'vendor/zed/LICENSE-APACHE'),path.join(destination,'ZED-LICENSE-APACHE'));
await copyFile(path.join(project,'NOTICE'),path.join(destination,'NOTICE'));
