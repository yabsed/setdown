import { _electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.resolve('apps/desktop/package.json'));

if (process.env.SETDOWN_ISOLATED_DISPLAY !== '1') throw Error('Isolated display required');
const output = path.resolve(process.argv[2] ?? 'reports/browser-ui-implementation-2026-10-30/namu-final');
const profile = await mkdtemp('/tmp/setdown-namu-');
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
const app = await _electron.launch({ executablePath: require('electron'), cwd: path.resolve('apps/desktop'), args: ['.'], env: { ...env, XDG_CONFIG_HOME: profile } });
try {
  const shell = await app.firstWindow(); await shell.waitForSelector('.shell');
  await app.evaluate(({ app }) => { globalThis.themeLogs = []; app.on('web-contents-created', (_event, wc) => { wc.on('console-message', (_event, ...details) => globalThis.themeLogs.push({ id: wc.id, details })); wc.on('preload-error', (_event, path, error) => globalThis.themeLogs.push({ path, error: String(error) })); }); });
  await app.evaluate(({ Menu }) => { const item = Menu.getApplicationMenu().getMenuItemById('preview-theme-solarized-light'); item.click(); });
  await shell.evaluate(() => window.marktex.browser.extensions());
  await shell.evaluate(() => window.marktex.openLink('https://namu.wiki/w/%EB%AC%B4%ED%95%9C%EB%8F%84%EC%A0%84'));
  await new Promise(resolve => setTimeout(resolve, 12000));
  console.log('settings', await shell.evaluate(() => window.marktex.browser.themeSettings()));
  await mkdir(output,{recursive:true});
  for (const mode of ['solarized-light', 'solarized-dark', 'original']) {
    if (mode === 'original') await shell.evaluate(() => window.marktex.browser.updateThemeSettings({ mode: 'original' }));
    else await app.evaluate(({ Menu }, mode) => Menu.getApplicationMenu().getMenuItemById(`preview-theme-${mode}`).click(), mode);
    await new Promise(resolve => setTimeout(resolve, 1500));
  const result = await app.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('https://namu.wiki/'));
    if (!page) return { error: 'No Namuwiki page', pages: webContents.getAllWebContents().map(wc => wc.getURL()) };
    return { url: page.getURL(), html: await page.executeJavaScript('document.documentElement.outerHTML'),
      logs: globalThis.themeLogs, snapshot: await page.executeJavaScript(`({ title: document.title, text: document.body.innerText.slice(0,2000),
        styles: [...document.querySelectorAll('style,link[rel=stylesheet]')].map(e => { const s=e.sheet; let rules; try {rules=[...s.cssRules].map(r=>r.cssText)} catch(error){rules=[String(error)]} return {href:s?.href,owner:e.className,rules}; }),
        blocks: [...document.querySelectorAll('body,main,article,h1,input,table,td,a')].slice(0,100).map(e => { const s=getComputedStyle(e); return {tag:e.tagName,cls:e.className,text:e.textContent.slice(0,80),bg:s.backgroundColor,color:s.color,width:e.getBoundingClientRect().width}; }) })`),
      screenshot: (await page.capturePage()).toPNG().toString('base64') };
  });
  if(result.html) await writeFile(path.join(output,`${mode}.html`),result.html);
  if(result.screenshot) await writeFile(path.join(output,`${mode}.png`),Buffer.from(result.screenshot,'base64'));
  delete result.html; delete result.screenshot;
  await writeFile(path.join(output,`${mode}.json`),JSON.stringify(result,null,2));
  console.log(JSON.stringify({url:result.url,title:result.snapshot?.title,text:result.snapshot?.text?.slice(0,250),error:result.error}));
  }
} finally { await app.close(); await rm(profile,{recursive:true,force:true}); }
