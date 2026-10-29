import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureTable } from './measure.mjs';
const out = path.dirname(fileURLToPath(import.meta.url));
const overview=process.argv.includes('--overview'),file=overview?'overview.ipynb':'fixture.ipynb';
if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1') throw new Error('Use with-isolated-display.sh');
const profile = await mkdtemp('/tmp/setdown-vscode-study-');
await mkdir(path.join(profile, 'User'));
await writeFile(path.join(profile, 'User/settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none', 'window.zoomLevel': 0,
  'workbench.colorTheme': overview?'Solarized Light':'Default Dark Modern', 'editor.fontSize': 14,
  'security.workspace.trust.enabled': false, 'telemetry.telemetryLevel': 'off',
  'update.mode': 'none', 'extensions.autoUpdate': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.editorAssociations': {'*.ipynb':'jupyter-notebook'}
}));
await writeFile(path.join(profile,file),await readFile(path.join(out,file)));
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const child = spawn('/usr/share/code/code', ['--remote-debugging-port=0', '--password-store=basic',
  '--user-data-dir', profile, '--extensions-dir', path.join(profile, 'extensions'),
  '--skip-welcome', '--skip-release-notes', '--new-window', path.join(profile,file)], {env});
const endpoint = await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('VS Code debugging endpoint timed out')),30000);
  child.stderr.on('data',data=>{const match=String(data).match(/DevTools listening on (ws:\/\/[^\s]+)/); if(match){clearTimeout(timer);resolve(match[1]);}});
  child.once('exit',code=>{clearTimeout(timer);reject(new Error(`VS Code exited: ${code}`));});
});
const app = await chromium.connectOverCDP(endpoint);
try {
  const context=app.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page');
  await page.waitForSelector('.monaco-workbench', {timeout:45000});
  console.log(JSON.stringify({pages:context.pages().map(p=>p.url())}));
  await page.waitForSelector('.notebookOverlay', {timeout:30000}).catch(()=>{});
  if(!overview)await page.screenshot({path:path.join(out,'vscode-initial.png')});
  console.log(JSON.stringify({profile,frames:page.frames().map(f=>({name:f.name(),url:f.url()})),text:(await page.locator('body').innerText()).slice(-3000)},null,2));
  if(!overview)await writeFile(path.join(out,'vscode-main-dom.html'),await page.content());
  let outputFrame;
  for(let i=0;i<150;i++){
    for(const frame of page.frames())if(await frame.locator('table.dataframe').count())outputFrame=frame;
    if(outputFrame)break;
    await new Promise(r=>setTimeout(r,100));
  }
  if(!outputFrame)throw new Error('No rendered DataFrame in VS Code frames');
  const measurements=[{variant:'native',...(await outputFrame.evaluate(measureTable))}];
  await page.screenshot({path:path.join(out,overview?'vscode-overview.png':'vscode-ready.png')});
  for(const width of overview?[]:[420,560,780]){
    await outputFrame.evaluate(w=>{
      const table=document.querySelector('table.dataframe'),output=table.closest('.output');
      // The built-in HTML wrapper adds 8px padding and 1px border on each side.
      output.style.width=`${w+18}px`;
    },width);
    measurements.push({variant:'current',width,...(await outputFrame.evaluate(measureTable))});
    await outputFrame.locator('.output').screenshot({path:path.join(out,`vscode-${width}.png`)});
  }
  await writeFile(path.join(out,overview?'vscode-overview-measurements.json':'vscode-measurements.json'),JSON.stringify(measurements,null,2));
  console.log(JSON.stringify(measurements.map(m=>({width:m.width,table:m.table.width,height:m.table.height,font:m.table.css.fontSize,rowLabel:m.rows[1].cells[0].lines})),null,2));
  if(!overview)await writeFile(path.join(out,'vscode-output-dom.html'),await outputFrame.content());
} finally { await app.close(); child.kill(); }
