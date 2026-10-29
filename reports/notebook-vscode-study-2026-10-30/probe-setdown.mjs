import { _electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureTable } from './measure.mjs';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../..');
const overview=process.argv.includes('--overview');
if(process.env.SETDOWN_ISOLATED_DISPLAY!=='1')throw new Error('Use isolated display');
const profile=await mkdtemp('/tmp/setdown-notebook-study-');
const require=createRequire(path.join(root,'apps/desktop/package.json'));
const {ELECTRON_RUN_AS_NODE,...env}=process.env;
const app=await _electron.launch({executablePath:require('electron'),chromiumSandbox:true,cwd:path.join(root,'apps/desktop'),args:['.',path.join(out,overview?'overview.ipynb':'fixture.ipynb')],env:{...env,XDG_CONFIG_HOME:profile},timeout:45000});
try {
 const page=await app.firstWindow();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1200,1050));
 await page.locator('.output-html table').waitFor();
 await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('preview-theme-solarized-light').click());
 if(overview)await page.locator('.cell-markdown h1').waitFor();
 await page.mouse.move(1,1);
 await page.screenshot({path:path.join(out,overview?'setdown-overview.png':'setdown-full.png')});
 const measurements=[];
 measurements.push({variant:'native',...(await page.evaluate(measureTable))});
 for(const width of overview?[]:[420,560,780]){
   await page.evaluate(w=>{const el=document.querySelector('.notebook-outputs');el.style.width=`${w+24}px`;el.style.boxSizing='border-box';},width);
   measurements.push({variant:'current',width,...(await page.evaluate(measureTable))});
   await page.locator('.notebook-outputs').screenshot({path:path.join(out,`setdown-${width}.png`)});
 }
 for(const variant of overview?[]:['normal-wrap','vscode-table-style']){
   const css=variant==='normal-wrap'?'.notebook-surface .output-html { overflow-wrap:normal; }':`
     .notebook-surface .output-html { overflow-wrap:normal;font-size:14px;line-height:normal; }
     .output-html :is(table,thead,tr,th,td,tbody){border:0!important;border-color:transparent;border-spacing:0;border-collapse:collapse;}
     .output-html table{margin:0;line-height:normal;font-variant-numeric:normal;}
     .output-html :is(table,th,tr){text-align:right;vertical-align:middle;}
     .output-html :is(th,td){padding:4px 8px;text-align:right;vertical-align:inherit;}
     .output-html td.notebook-number{white-space:normal;}
     .output-html thead{background:rgba(130,130,130,.16);}
     .output-html tbody th{font-weight:400;}
     .output-html tbody tr:nth-child(even){background:rgba(130,130,130,.08);}
     .output-html .dataframe tbody tr th:only-of-type{vertical-align:middle;}
     .output-html .dataframe tbody tr th{vertical-align:top;}
   `;
   const style=await page.addStyleTag({content:css});
   for(const width of [420,560,780]){
     await page.evaluate(w=>document.querySelector('.notebook-outputs').style.width=`${w+24}px`,width);
     measurements.push({variant,width,...(await page.evaluate(measureTable))});
     await page.locator('.notebook-outputs').screenshot({path:path.join(out,`setdown-${variant}-${width}.png`)});
   }
   await style.evaluate(el=>el.remove());
 }
 await writeFile(path.join(out,overview?'setdown-overview-measurements.json':'setdown-measurements.json'),JSON.stringify(measurements,null,2));
 console.log(JSON.stringify(measurements.map(m=>({variant:m.variant,width:m.width,table:m.table.width,height:m.table.height,font:m.table.css.fontSize,rowLabel:m.rows[1].cells[0].lines})),null,2));
} finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close();}
