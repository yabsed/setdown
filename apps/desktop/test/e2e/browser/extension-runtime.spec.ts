import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
import { nativeInput } from '../../support/electron/native-input';

test('MV3 popup targets its web tab; worker grants, proxy, WebRTC, cookies and downloads have real effects', async () => {
  test.setTimeout(120_000);
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.url?.startsWith('http://proxy-target.invalid')) {
      if (req.url.endsWith('/auth') && req.headers['proxy-authorization'] !== 'Basic Zml4dHVyZTpzZWNyZXQ=') {
        res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Fixture proxy"' }); res.end(); return;
      }
      res.setHeader('Access-Control-Allow-Origin', '*'); res.end('through-extension-proxy'); return;
    }
    if (req.url === '/download') { res.setHeader('Content-Disposition', 'attachment; filename="conversation.md"'); res.end('# 대화\n\nA saved conversation.\n'); return; }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Extension target</title><h1>Conversation</h1>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
  const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-extension-runtime-'));
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const options = { args: ['.'], env: { ...env, DEBUG: 'electron-chrome-extensions:router', XDG_CONFIG_HOME: path.join(root, 'config') } };
  let app = await electron.launch(options);
  try {
    const userData = await app.evaluate(({ app }) => app.getPath('userData'));
    await disposeApplication(app);
    const extension = path.join(userData, 'extensions', 'runtime-fixture'); await mkdir(extension, { recursive: true });
    await writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Runtime Fixture', version: '1.0',
      permissions: ['storage', 'tabs', 'proxy', 'browsingData', 'downloads', 'declarativeNetRequest', 'webRequest', 'webRequestAuthProvider'], optional_permissions: ['privacy'],
      host_permissions: ['<all_urls>'], action: { default_title: 'Runtime Fixture', default_popup: 'popup.html' }, background: { service_worker: 'worker.js' },
      content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }] }));
    await writeFile(path.join(extension, 'content.js'), `document.documentElement.dataset.runtimeFixture='ready'; chrome.runtime.onMessage.addListener((message, sender, reply) => { if (message.op === 'identify') reply({ title: document.title, url: location.href }); if (message.op === 'export') { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['# 대화\\n\\nExport from conversation content.'],{type:'text/markdown'})); a.download='대화-export.md'; a.target='_blank'; document.body.append(a); a.click(); a.remove(); reply(true); } });`);
    await writeFile(path.join(extension, 'popup.html'), '<!doctype html><style>body{width:320px;height:200px}</style><input id="typing"><script src="popup.js"></script>');
    await writeFile(path.join(extension, 'popup.js'), `chrome.tabs.query({active:true,currentWindow:true}).then(async tabs => { const target = await chrome.tabs.sendMessage(tabs[0].id,{op:'identify'}); document.title = target.title; document.body.dataset.target = JSON.stringify({tab:tabs[0], target}); });`);
    await writeFile(path.join(extension, 'worker.js'), `
      const downloadEvents = [];
      chrome.downloads.onCreated.addListener(item => downloadEvents.push({type:'created',id:item.id}));
      chrome.downloads.onChanged.addListener(delta => downloadEvents.push({type:'changed',...delta}));
      chrome.webRequest.onAuthRequired.addListener((details, callback) => callback(details.isProxy ? {authCredentials:{username:'fixture',password:'secret'}} : {}), {urls:['<all_urls>']}, ['asyncBlocking']);
      async function run(m) {
        if(m.op==='downloadEvents') return downloadEvents;
        if(m.op==='window') return chrome.windows.create({url:m.url});
        if(m.op==='inspect') return {alias: browser===chrome, tabs:await chrome.tabs.query({active:true,currentWindow:true}), permissions:await chrome.permissions.getAll()};
        if(m.op==='permission') return chrome.permissions[m.method]({permissions:['privacy']});
        if(m.op==='privacy') return chrome.privacy.network.webRTCIPHandlingPolicy[m.method](m.details||{});
        if(m.op==='proxy') return chrome.proxy.settings[m.method](m.details||{});
        if(m.op==='fetch') return (await fetch(m.url)).text();
        if(m.op==='clearData') return chrome.browsingData.remove(m.options,m.data);
        if(m.op==='cookies') return chrome.browsingData.remove({origins:[m.origin]},{cookies:true});
        if(m.op==='download') return chrome.downloads.download(m.details);
        if(m.op==='search') return chrome.downloads.search({id:m.id});
        if(m.op==='callbackError') return new Promise(resolve => chrome.downloads.download({url:'file:///etc/passwd'}, () => resolve(chrome.runtime.lastError?.message || 'missing-error')));
        if(m.op==='dnr') return chrome.declarativeNetRequest.updateDynamicRules(m.details);
        if(m.op==='badge') return chrome.action.setBadgeText({tabId:m.tabId,text:m.text});
        if(m.op==='disableAction') return chrome.action.disable(m.tabId);
      }
      chrome.runtime.onMessage.addListener((m,s,reply)=> { run(m).then(value=>reply({value}), error=>reply({error:error.message})); return true; });
    `);
    await writeFile(path.join(userData, 'browser-extensions.json'), JSON.stringify([{ dir: 'runtime-fixture', enabled: true }]));
    await mkdir(path.join(root, 'downloads/chat'), { recursive: true });
    await writeFile(path.join(root, 'downloads/chat/대화.md'), 'Keep the existing file.');
    await mkdir(path.join(root, 'outside'));
    await symlink(path.join(root, 'outside'), path.join(root, 'downloads/shortcut'), 'junction');
    app = await electron.launch(options);
    let stderr = ''; app.process().stderr!.on('data', chunk => { stderr += String(chunk); });
    const page = await app.firstWindow(); await focusApplication(app);
    await app.evaluate(({ app, dialog }, root) => {
      app.setPath('downloads', `${root}/downloads`);
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    }, root);
    const extensions = await page.evaluate(() => window.marktex.browser.extensions());
    const fixture = extensions.find(item => item.name === 'Runtime Fixture')!; expect(fixture.error).toBeNull();
    await page.evaluate(url => window.marktex.openLink(url), `${origin}/article`);
    await expect(page.getByRole('tab', { name: /Extension target/ })).toHaveAttribute('aria-selected', 'true');
    const before = await page.getByRole('tab').count();
    const picker = async (owner: Page = page) => {
      const box = (await owner.getByRole('button', { name: 'Extensions menu', exact: true }).boundingBox())!;
      const window = await app.browserWindow(owner);
      const point = await window.evaluate((win, box) => {
        win.show(); win.focus();
        const root = win.getContentBounds(), zoom = win.webContents.getZoomFactor();
        return { x: root.x + (box.x + box.width / 2) * zoom, y: root.y + (box.y + box.height / 2) * zoom };
      }, box);
      await nativeInput({ click: point });
      await expect.poll(() => app.windows().some(window => window.url().endsWith('/extension-panel.html'))).toBe(true);
      return app.windows().find(window => window.url().endsWith('/extension-panel.html'))!;
    };
    const openAction = async (owner: Page = page) => {
      const panel = await picker(owner);
      const button = panel.getByRole('button', { name: 'Runtime Fixture', exact: true });
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      const point = await app.evaluate(({ BrowserWindow, WebContentsView }, box) => {
        for (const win of BrowserWindow.getAllWindows()) for (const view of win.contentView.children) {
          if (view instanceof WebContentsView && view.webContents.getURL().endsWith('/extension-panel.html')) {
            const root = win.getContentBounds(), bounds = view.getBounds(), zoom = view.webContents.getZoomFactor();
            return { x: root.x + bounds.x + (box.x + box.width / 2) * zoom, y: root.y + bounds.y + (box.y + box.height / 2) * zoom };
          }
        }
        throw Error('Extension strip is not attached to its owner.');
      }, box);
      await nativeInput({ click: point });
    };
    const geometry = () => app.evaluate(({ BrowserWindow, WebContentsView }, id) => {
      for (const parent of BrowserWindow.getAllWindows()) for (const view of parent.contentView.children) {
        if (view instanceof WebContentsView && view.webContents.getURL() === `chrome-extension://${id}/popup.html`) {
          return { bounds: view.getBounds(), zoom: parent.webContents.getZoomFactor(), windows: BrowserWindow.getAllWindows().length };
        }
      }
    }, fixture.id);

    await openAction();
    await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.getAllWebContents().some(wc => wc.getURL() === `chrome-extension://${id}/popup.html`), fixture.id)).toBe(true);
    const popupValue = (code: string) => app.evaluate(async ({ webContents }, args) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `chrome-extension://${args.id}/popup.html`)!;
      return wc?.executeJavaScript(args.code);
    }, { id: fixture.id, code });
    await expect.poll(() => popupValue('document.body.dataset.target || ""')).toContain('Extension target');
    const target = JSON.parse(await popupValue('document.body.dataset.target'));
    expect(target.target.url).toBe(`${origin}/article`); expect(await page.getByRole('tab').count()).toBe(before);
    const worker = (message: unknown) => popupValue(`chrome.runtime.sendMessage(${JSON.stringify(message)})`);
    const popupPage = app.windows().find(window => window.url() === `chrome-extension://${fixture.id}/popup.html`)!;
    await popupPage.locator('#typing').click(); await popupPage.keyboard.type('working'); await popupPage.keyboard.insertText('한글');
    await expect(popupPage.locator('#typing')).toHaveValue('working한글');
    const anchor = (await page.getByRole('button', { name: 'Extensions menu' }).boundingBox())!;
    await expect.poll(async () => (await geometry())?.bounds.y).toBe(Math.round(anchor.y + anchor.height + 6));
    expect((await geometry())?.windows).toBe(1);
    const inspected = await worker({ op: 'inspect' }); expect(inspected.value.alias).toBe(true);
    await worker({ op: 'badge', tabId: target.tab.id, text: '2' });
    const actionState = (owner: Page) => owner.evaluate(async id => { const tab = document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id'); return tab ? (await window.marktex.browser.extensionActions(tab)).find(item => item.id === id) : undefined; }, fixture.id);
    await expect.poll(() => actionState(page).then(item => item?.badge)).toBe('2');
    expect(inspected.value.tabs[0].id).toBe(target.tab.id); expect(inspected.value.tabs[0].windowId).toBe(target.tab.windowId);
    expect((await worker({ op: 'privacy', method: 'get' })).error).toContain('privacy permission');
    expect((await worker({ op: 'permission', method: 'request' })).value).toBe(true);
    expect((await worker({ op: 'permission', method: 'contains' })).value).toBe(true);
    expect((await worker({ op: 'privacy', method: 'set', details: { value: 'disable_non_proxied_udp' } })).error).toBeUndefined();
    expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getWebRTCIPHandlingPolicy(), target.tab.id)).toBe('disable_non_proxied_udp');
    expect((await worker({ op: 'permission', method: 'remove' })).value).toBe(true);
    expect((await worker({ op: 'permission', method: 'contains' })).value).toBe(false);
    expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getWebRTCIPHandlingPolicy(), target.tab.id)).toBe('default');
    const configured = await worker({ op: 'proxy', method: 'set', details: { value: { mode: 'fixed_servers', rules: { singleProxy: { scheme: 'http', host: '127.0.0.1', port }, bypassList: ['<-loopback>'] } } } });
    expect(configured.error).toBeUndefined();
    expect((await worker({ op: 'fetch', url: 'http://proxy-target.invalid/check' })).value).toBe('through-extension-proxy');
    expect(requests).toContain('http://proxy-target.invalid/check');
    const authenticated = await app.evaluate(async ({ webContents }, tabId) => webContents.fromId(tabId)!.executeJavaScript("fetch('http://proxy-target.invalid/auth').then(r => r.text())"), target.tab.id);
    expect(authenticated).toBe('through-extension-proxy');
    expect(stderr).not.toContain('authCredentials');
    expect(stderr).not.toContain("password: 'secret'");
    expect(requests.filter(url => url === 'http://proxy-target.invalid/auth').length).toBeGreaterThanOrEqual(2);
    expect((await worker({ op: 'proxy', method: 'get' })).value.levelOfControl).toBe('controlled_by_this_extension');
    await worker({ op: 'proxy', method: 'clear' });
    expect(await app.evaluate(async ({ session }) => session.fromPartition('persist:setdown-browser').resolveProxy('http://proxy-target.invalid'))).toBe('DIRECT');
    await app.evaluate(async ({ session }, origin) => {
      const cookies = session.fromPartition('persist:setdown-browser').cookies;
      await cookies.set({ url: origin, name: 'target-cookie', value: 'remove' });
      await cookies.set({ url: 'http://unrelated.test', name: 'unrelated-cookie', value: 'keep' });
    }, origin);
    await worker({ op: 'cookies', origin });
    const cookies = await app.evaluate(async ({ session }) => session.fromPartition('persist:setdown-browser').cookies.get({}));
    expect(cookies.some(cookie => cookie.name === 'target-cookie')).toBe(false); expect(cookies.some(cookie => cookie.name === 'unrelated-cookie')).toBe(true);
    await app.evaluate(async ({ session, webContents }, args) => {
      await session.fromPartition('persist:setdown-browser').cookies.set({ url: 'https://account.example.test', domain: '.example.test', name: 'parent-cookie', value: 'remove' });
      await webContents.fromId(args.tabId)!.executeJavaScript("localStorage.setItem('fixture-site', 'remove')");
    }, { tabId: target.tab.id });
    await popupValue("localStorage.setItem('fixture-extension', 'keep'); true");
    expect((await worker({ op: 'cookies', origin: 'https://*.prod.example.test' })).error).toBeUndefined();
    expect(await app.evaluate(async ({ session }) => (await session.fromPartition('persist:setdown-browser').cookies.get({ name: 'parent-cookie' })).length)).toBe(0);
    expect((await worker({ op: 'clearData', options: {}, data: { localStorage: true } })).error).toBeUndefined();
    expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript("localStorage.getItem('fixture-site')"), target.tab.id)).toBeNull();
    expect(await popupValue("localStorage.getItem('fixture-extension')")).toBe('keep');
    const downloaded = await worker({ op: 'download', details: { url: `${origin}/download`, filename: 'chat/대화.md' } });
    expect(downloaded.error).toBeUndefined(); expect(typeof downloaded.value).toBe('number');
    await expect.poll(async () => (await worker({ op: 'search', id: downloaded.value })).value?.[0]?.state).toBe('complete');
    expect(await readFile(path.join(root, 'downloads/chat/대화 (1).md'), 'utf8')).toContain('A saved conversation');
    expect(await readFile(path.join(root, 'downloads/chat/대화.md'), 'utf8')).toBe('Keep the existing file.');
    const downloadEvents = (await worker({ op: 'downloadEvents' })).value;
    expect(downloadEvents).toContainEqual({ type: 'created', id: downloaded.value });
    expect(downloadEvents).toContainEqual(expect.objectContaining({ type: 'changed', id: downloaded.value, state: { previous: 'in_progress', current: 'complete' } }));
    expect((await worker({ op: 'download', details: { url: `${origin}/download`, filename: 'shortcut/escape.md' } })).error).toContain('symbolic');
    expect((await worker({ op: 'callbackError' })).value).toContain('HTTP(S)');
    expect((await worker({ op: 'download', details: { url: `${origin}/download`, filename: '../escape.md' } })).error).toContain('filename');
    await worker({ op: 'dnr', details: { addRules: [{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: `${origin}/blocked`, resourceTypes: ['xmlhttprequest'] } }], removeRuleIds: [1] } });
    expect((await worker({ op: 'fetch', url: `${origin}/blocked` })).error).toBeTruthy();
    await worker({ op: 'dnr', details: { removeRuleIds: [1] } });
    expect((await worker({ op: 'fetch', url: `${origin}/blocked` })).value).toContain('Conversation');
    await app.evaluate(({ session }, filename) => {
      session.fromPartition('persist:setdown-browser').once('will-download', (_event, item) => item.setSavePath(filename));
    }, path.join(root, 'downloads/대화-export.md'));
    expect(await popupValue(`chrome.tabs.sendMessage(${target.tab.id},{op:'export'})`)).toBe(true);
    await expect.poll(() => page.evaluate(async () => (await window.marktex.browser.downloads()).some(row => row.name === '대화-export.md' && row.state === 'completed'))).toBe(true);
    expect(await readFile(path.join(root, 'downloads/대화-export.md'), 'utf8')).toContain('Export from conversation content.');
    await app.evaluate(({ webContents }, id) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `chrome-extension://${id}/popup.html`)!;
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    }, fixture.id);
    await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.getAllWebContents().some(wc => wc.getURL() === `chrome-extension://${id}/popup.html`), fixture.id)).toBe(false);
    await openAction();
    await expect.poll(() => popupValue('document.body.dataset.target || ""')).toContain('Extension target');
    await worker({ op: 'proxy', method: 'set', details: { value: { mode: 'fixed_servers', rules: { singleProxy: { host: '127.0.0.1', port } } } } });
    await page.evaluate(id => window.marktex.browser.setExtensionEnabled(id, false), fixture.id);
    await expect.poll(() => app.evaluate(async ({ session }) => session.fromPartition('persist:setdown-browser').resolveProxy('http://proxy-target.invalid'))).toBe('DIRECT');
    await expect(page.getByRole('button', { name: 'Runtime Fixture', exact: true })).toHaveCount(0);
    await page.evaluate(id => window.marktex.browser.setExtensionEnabled(id, true), fixture.id);
    await page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect.poll(() => app.evaluate(async ({ webContents }, origin) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `${origin}/article`);
      return wc && !wc.isLoading() ? wc.executeJavaScript("document.documentElement.dataset.runtimeFixture || ''").catch(() => '') : '';
    }, origin)).toBe('ready');
    await openAction();
    await expect.poll(() => popupValue('document.body.dataset.target || ""')).toContain('Extension target');
    await worker({ op: 'proxy', method: 'clear' });
    await popupValue(`void chrome.runtime.sendMessage({op:'window',url:${JSON.stringify(`${origin}/second`)}}); true`);
    await expect.poll(() => app.evaluate(({ BrowserWindow, session }) => BrowserWindow.getAllWindows().filter(win => win.webContents.session !== session.fromPartition('persist:setdown-browser')).length)).toBe(2);
    // Native window creation precedes its shell navigation and Playwright Page.
    await expect.poll(() => app.windows().some(window => window !== page && window.url() === page.url())).toBe(true);
    const second = app.windows().find(window => window !== page && window.url() === page.url())!;
    await expect(second.getByRole('tab', { name: /Extension target/ })).toHaveAttribute('aria-selected', 'true');
    await openAction(second);
    await expect.poll(() => popupValue('document.body.dataset.target || ""')).toContain('/second');
    const otherTarget = JSON.parse(await popupValue('document.body.dataset.target'));
    expect(otherTarget.tab.windowId).not.toBe(target.tab.windowId);
    expect((await worker({ op: 'inspect' })).value.tabs[0].id).toBe(otherTarget.tab.id);
    await worker({ op: 'badge', tabId: target.tab.id, text: '2' });
    await worker({ op: 'disableAction', tabId: otherTarget.tab.id });
    const disabledPanel = await picker(second);
    await expect(disabledPanel.getByRole('button', { name: 'Runtime Fixture', exact: true })).toBeDisabled();
    await disabledPanel.keyboard.press('Escape');
    const firstPanel = await picker(page);
    await expect(firstPanel.getByRole('button', { name: 'Runtime Fixture', exact: true })).toBeEnabled();
    await expect(firstPanel.getByRole('button', { name: 'Runtime Fixture', exact: true }).locator('.badge')).toHaveText('2');
    await expect(firstPanel.locator('header, .label')).toHaveCount(0);
    expect((await firstPanel.locator('body').boundingBox())!.height).toBeLessThanOrEqual(38);
    await firstPanel.screenshot({ path: '/tmp/setdown-extension-picker.png' });
    const nativeShot = await app.evaluate(async ({ BrowserWindow, WebContentsView }) => { const owner = BrowserWindow.getAllWindows().find(win => win.contentView.children.some(view => view instanceof WebContentsView && view.webContents.getURL().endsWith('/extension-panel.html')))!; return (await owner.capturePage()).toPNG().toString('base64'); });
    await writeFile('/tmp/setdown-extension-toolbar.png', Buffer.from(nativeShot, 'base64'));
    await firstPanel.keyboard.press('Escape');
    await page.evaluate(() => window.marktex.executeApplicationMenuItem('menu-zoom-in'));
    await expect.poll(() => page.evaluate(() => window.marktex.getZoom())).toMatchObject({ app: 110 });
    await openAction();
    const zoomAnchor = (await page.getByRole('button', { name: 'Extensions menu' }).boundingBox())!;
    await expect.poll(async () => { const value = await geometry(); return value ? Math.abs(value.bounds.y - Math.round((zoomAnchor.y + zoomAnchor.height) * value.zoom + 6)) : 100; }).toBeLessThanOrEqual(1);
    expect((await geometry())?.windows).toBe(2);

  } finally { await disposeApplication(app); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
