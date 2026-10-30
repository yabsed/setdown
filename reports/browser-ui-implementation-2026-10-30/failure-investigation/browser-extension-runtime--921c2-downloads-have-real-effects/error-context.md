# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser/extension-runtime.spec.ts >> MV3 popup targets its web tab; worker grants, proxy, WebRTC, cookies and downloads have real effects
- Location: test/e2e/browser/extension-runtime.spec.ts:9:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test';
  2   | import { createServer } from 'node:http';
  3   | import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
  4   | import os from 'node:os';
  5   | import path from 'node:path';
  6   | import { electron, disposeApplication, focusApplication } from '../../support/electron/electron-app';
  7   | import { nativeInput } from '../../support/electron/native-input';
  8   | 
  9   | test('MV3 popup targets its web tab; worker grants, proxy, WebRTC, cookies and downloads have real effects', async () => {
  10  |   test.setTimeout(120_000);
  11  |   const requests: string[] = [];
  12  |   const server = createServer((req, res) => {
  13  |     requests.push(req.url ?? '');
  14  |     if (req.url?.startsWith('http://proxy-target.invalid')) {
  15  |       if (req.url.endsWith('/auth') && req.headers['proxy-authorization'] !== 'Basic Zml4dHVyZTpzZWNyZXQ=') {
  16  |         res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Fixture proxy"' }); res.end(); return;
  17  |       }
  18  |       res.setHeader('Access-Control-Allow-Origin', '*'); res.end('through-extension-proxy'); return;
  19  |     }
  20  |     if (req.url === '/download') { res.setHeader('Content-Disposition', 'attachment; filename="conversation.md"'); res.end('# 대화\n\nA saved conversation.\n'); return; }
  21  |     res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Extension target</title><h1>Conversation</h1>');
  22  |   });
  23  |   await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  24  |   const port = (server.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
  25  |   const root = await mkdtemp(path.join(os.tmpdir(), 'setdown-extension-runtime-'));
  26  |   const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  27  |   const options = { args: ['.'], env: { ...env, DEBUG: 'electron-chrome-extensions:router', XDG_CONFIG_HOME: path.join(root, 'config') } };
  28  |   let app = await electron.launch(options);
  29  |   try {
  30  |     const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  31  |     await disposeApplication(app);
  32  |     const extension = path.join(userData, 'extensions', 'runtime-fixture'); await mkdir(extension, { recursive: true });
  33  |     await writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Runtime Fixture', version: '1.0',
  34  |       permissions: ['storage', 'tabs', 'proxy', 'browsingData', 'downloads', 'declarativeNetRequest', 'webRequest', 'webRequestAuthProvider'], optional_permissions: ['privacy'],
  35  |       host_permissions: ['<all_urls>'], action: { default_title: 'Runtime Fixture', default_popup: 'popup.html' }, background: { service_worker: 'worker.js' },
  36  |       content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }] }));
  37  |     await writeFile(path.join(extension, 'content.js'), `document.documentElement.dataset.runtimeFixture='ready'; chrome.runtime.onMessage.addListener((message, sender, reply) => { if (message.op === 'identify') reply({ title: document.title, url: location.href }); if (message.op === 'export') { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['# 대화\\n\\nExport from conversation content.'],{type:'text/markdown'})); a.download='대화-export.md'; a.target='_blank'; document.body.append(a); a.click(); a.remove(); reply(true); } });`);
  38  |     await writeFile(path.join(extension, 'popup.html'), '<!doctype html><style>body{width:320px;height:200px}</style><input id="typing"><script src="popup.js"></script>');
  39  |     await writeFile(path.join(extension, 'popup.js'), `chrome.tabs.query({active:true,currentWindow:true}).then(async tabs => { const target = await chrome.tabs.sendMessage(tabs[0].id,{op:'identify'}); document.title = target.title; document.body.dataset.target = JSON.stringify({tab:tabs[0], target}); });`);
  40  |     await writeFile(path.join(extension, 'worker.js'), `
  41  |       const downloadEvents = [];
  42  |       chrome.downloads.onCreated.addListener(item => downloadEvents.push({type:'created',id:item.id}));
  43  |       chrome.downloads.onChanged.addListener(delta => downloadEvents.push({type:'changed',...delta}));
  44  |       chrome.webRequest.onAuthRequired.addListener((details, callback) => callback(details.isProxy ? {authCredentials:{username:'fixture',password:'secret'}} : {}), {urls:['<all_urls>']}, ['asyncBlocking']);
  45  |       async function run(m) {
  46  |         if(m.op==='downloadEvents') return downloadEvents;
  47  |         if(m.op==='window') return chrome.windows.create({url:m.url});
  48  |         if(m.op==='inspect') return {alias: browser===chrome, tabs:await chrome.tabs.query({active:true,currentWindow:true}), permissions:await chrome.permissions.getAll()};
  49  |         if(m.op==='permission') return chrome.permissions[m.method]({permissions:['privacy']});
  50  |         if(m.op==='privacy') return chrome.privacy.network.webRTCIPHandlingPolicy[m.method](m.details||{});
  51  |         if(m.op==='proxy') return chrome.proxy.settings[m.method](m.details||{});
  52  |         if(m.op==='fetch') return (await fetch(m.url)).text();
  53  |         if(m.op==='clearData') return chrome.browsingData.remove(m.options,m.data);
  54  |         if(m.op==='cookies') return chrome.browsingData.remove({origins:[m.origin]},{cookies:true});
  55  |         if(m.op==='download') return chrome.downloads.download(m.details);
  56  |         if(m.op==='search') return chrome.downloads.search({id:m.id});
  57  |         if(m.op==='callbackError') return new Promise(resolve => chrome.downloads.download({url:'file:///etc/passwd'}, () => resolve(chrome.runtime.lastError?.message || 'missing-error')));
  58  |         if(m.op==='dnr') return chrome.declarativeNetRequest.updateDynamicRules(m.details);
  59  |         if(m.op==='badge') return chrome.action.setBadgeText({tabId:m.tabId,text:m.text});
  60  |         if(m.op==='disableAction') return chrome.action.disable(m.tabId);
  61  |       }
  62  |       chrome.runtime.onMessage.addListener((m,s,reply)=> { run(m).then(value=>reply({value}), error=>reply({error:error.message})); return true; });
  63  |     `);
  64  |     await writeFile(path.join(userData, 'browser-extensions.json'), JSON.stringify([{ dir: 'runtime-fixture', enabled: true }]));
  65  |     await mkdir(path.join(root, 'downloads/chat'), { recursive: true });
  66  |     await writeFile(path.join(root, 'downloads/chat/대화.md'), 'Keep the existing file.');
  67  |     await mkdir(path.join(root, 'outside'));
  68  |     await symlink(path.join(root, 'outside'), path.join(root, 'downloads/shortcut'), 'junction');
  69  |     app = await electron.launch(options);
  70  |     let stderr = ''; app.process().stderr!.on('data', chunk => { stderr += String(chunk); });
  71  |     const page = await app.firstWindow(); await focusApplication(app);
  72  |     await app.evaluate(({ app, dialog }, root) => {
  73  |       app.setPath('downloads', `${root}/downloads`);
  74  |       dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
  75  |     }, root);
  76  |     const extensions = await page.evaluate(() => window.marktex.browser.extensions());
  77  |     const fixture = extensions.find(item => item.name === 'Runtime Fixture')!; expect(fixture.error).toBeNull();
  78  |     await page.evaluate(url => window.marktex.openLink(url), `${origin}/article`);
  79  |     await expect(page.getByRole('tab', { name: /Extension target/ })).toHaveAttribute('aria-selected', 'true');
  80  |     const before = await page.getByRole('tab').count();
  81  |     const picker = async (owner: Page = page) => {
  82  |       const box = (await owner.getByRole('button', { name: 'Extensions menu', exact: true }).boundingBox())!;
  83  |       const window = await app.browserWindow(owner);
  84  |       const point = await window.evaluate((win, box) => {
  85  |         win.show(); win.focus();
  86  |         const root = win.getContentBounds(), zoom = win.webContents.getZoomFactor();
  87  |         return { x: root.x + (box.x + box.width / 2) * zoom, y: root.y + (box.y + box.height / 2) * zoom };
  88  |       }, box);
  89  |       await nativeInput({ click: point });
> 90  |       await expect.poll(() => app.windows().some(window => window.url().endsWith('/extension-panel.html'))).toBe(true);
      |                                                                                                             ^ Error: expect(received).toBe(expected) // Object.is equality
  91  |       return app.windows().find(window => window.url().endsWith('/extension-panel.html'))!;
  92  |     };
  93  |     const openAction = async (owner: Page = page) => {
  94  |       const panel = await picker(owner);
  95  |       const button = panel.getByRole('button', { name: 'Runtime Fixture', exact: true });
  96  |       await expect(button).toBeVisible();
  97  |       const box = (await button.boundingBox())!;
  98  |       const point = await app.evaluate(({ BrowserWindow, WebContentsView }, box) => {
  99  |         for (const win of BrowserWindow.getAllWindows()) for (const view of win.contentView.children) {
  100 |           if (view instanceof WebContentsView && view.webContents.getURL().endsWith('/extension-panel.html')) {
  101 |             const root = win.getContentBounds(), bounds = view.getBounds(), zoom = view.webContents.getZoomFactor();
  102 |             return { x: root.x + bounds.x + (box.x + box.width / 2) * zoom, y: root.y + bounds.y + (box.y + box.height / 2) * zoom };
  103 |           }
  104 |         }
  105 |         throw Error('Extension strip is not attached to its owner.');
  106 |       }, box);
  107 |       await nativeInput({ click: point });
  108 |     };
  109 |     const geometry = () => app.evaluate(({ BrowserWindow, WebContentsView }, id) => {
  110 |       for (const parent of BrowserWindow.getAllWindows()) for (const view of parent.contentView.children) {
  111 |         if (view instanceof WebContentsView && view.webContents.getURL() === `chrome-extension://${id}/popup.html`) {
  112 |           return { bounds: view.getBounds(), zoom: parent.webContents.getZoomFactor(), windows: BrowserWindow.getAllWindows().length };
  113 |         }
  114 |       }
  115 |     }, fixture.id);
  116 | 
  117 |     await openAction();
  118 |     await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.getAllWebContents().some(wc => wc.getURL() === `chrome-extension://${id}/popup.html`), fixture.id)).toBe(true);
  119 |     const popupValue = (code: string) => app.evaluate(async ({ webContents }, args) => {
  120 |       const wc = webContents.getAllWebContents().find(wc => wc.getURL() === `chrome-extension://${args.id}/popup.html`)!;
  121 |       return wc?.executeJavaScript(args.code);
  122 |     }, { id: fixture.id, code });
  123 |     await expect.poll(() => popupValue('document.body.dataset.target || ""')).toContain('Extension target');
  124 |     const target = JSON.parse(await popupValue('document.body.dataset.target'));
  125 |     expect(target.target.url).toBe(`${origin}/article`); expect(await page.getByRole('tab').count()).toBe(before);
  126 |     const worker = (message: unknown) => popupValue(`chrome.runtime.sendMessage(${JSON.stringify(message)})`);
  127 |     const popupPage = app.windows().find(window => window.url() === `chrome-extension://${fixture.id}/popup.html`)!;
  128 |     await popupPage.locator('#typing').click(); await popupPage.keyboard.type('working'); await popupPage.keyboard.insertText('한글');
  129 |     await expect(popupPage.locator('#typing')).toHaveValue('working한글');
  130 |     const anchor = (await page.getByRole('button', { name: 'Extensions menu' }).boundingBox())!;
  131 |     await expect.poll(async () => (await geometry())?.bounds.y).toBe(Math.round(anchor.y + anchor.height + 6));
  132 |     expect((await geometry())?.windows).toBe(1);
  133 |     const inspected = await worker({ op: 'inspect' }); expect(inspected.value.alias).toBe(true);
  134 |     await worker({ op: 'badge', tabId: target.tab.id, text: '2' });
  135 |     const actionState = (owner: Page) => owner.evaluate(async id => { const tab = document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id'); return tab ? (await window.marktex.browser.extensionActions(tab)).find(item => item.id === id) : undefined; }, fixture.id);
  136 |     await expect.poll(() => actionState(page).then(item => item?.badge)).toBe('2');
  137 |     expect(inspected.value.tabs[0].id).toBe(target.tab.id); expect(inspected.value.tabs[0].windowId).toBe(target.tab.windowId);
  138 |     expect((await worker({ op: 'privacy', method: 'get' })).error).toContain('privacy permission');
  139 |     expect((await worker({ op: 'permission', method: 'request' })).value).toBe(true);
  140 |     expect((await worker({ op: 'permission', method: 'contains' })).value).toBe(true);
  141 |     expect((await worker({ op: 'privacy', method: 'set', details: { value: 'disable_non_proxied_udp' } })).error).toBeUndefined();
  142 |     expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getWebRTCIPHandlingPolicy(), target.tab.id)).toBe('disable_non_proxied_udp');
  143 |     expect((await worker({ op: 'permission', method: 'remove' })).value).toBe(true);
  144 |     expect((await worker({ op: 'permission', method: 'contains' })).value).toBe(false);
  145 |     expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getWebRTCIPHandlingPolicy(), target.tab.id)).toBe('default');
  146 |     const configured = await worker({ op: 'proxy', method: 'set', details: { value: { mode: 'fixed_servers', rules: { singleProxy: { scheme: 'http', host: '127.0.0.1', port }, bypassList: ['<-loopback>'] } } } });
  147 |     expect(configured.error).toBeUndefined();
  148 |     expect((await worker({ op: 'fetch', url: 'http://proxy-target.invalid/check' })).value).toBe('through-extension-proxy');
  149 |     expect(requests).toContain('http://proxy-target.invalid/check');
  150 |     const authenticated = await app.evaluate(async ({ webContents }, tabId) => webContents.fromId(tabId)!.executeJavaScript("fetch('http://proxy-target.invalid/auth').then(r => r.text())"), target.tab.id);
  151 |     expect(authenticated).toBe('through-extension-proxy');
  152 |     expect(stderr).not.toContain('authCredentials');
  153 |     expect(stderr).not.toContain("password: 'secret'");
  154 |     expect(requests.filter(url => url === 'http://proxy-target.invalid/auth').length).toBeGreaterThanOrEqual(2);
  155 |     expect((await worker({ op: 'proxy', method: 'get' })).value.levelOfControl).toBe('controlled_by_this_extension');
  156 |     await worker({ op: 'proxy', method: 'clear' });
  157 |     expect(await app.evaluate(async ({ session }) => session.fromPartition('persist:setdown-browser').resolveProxy('http://proxy-target.invalid'))).toBe('DIRECT');
  158 |     await app.evaluate(async ({ session }, origin) => {
  159 |       const cookies = session.fromPartition('persist:setdown-browser').cookies;
  160 |       await cookies.set({ url: origin, name: 'target-cookie', value: 'remove' });
  161 |       await cookies.set({ url: 'http://unrelated.test', name: 'unrelated-cookie', value: 'keep' });
  162 |     }, origin);
  163 |     await worker({ op: 'cookies', origin });
  164 |     const cookies = await app.evaluate(async ({ session }) => session.fromPartition('persist:setdown-browser').cookies.get({}));
  165 |     expect(cookies.some(cookie => cookie.name === 'target-cookie')).toBe(false); expect(cookies.some(cookie => cookie.name === 'unrelated-cookie')).toBe(true);
  166 |     await app.evaluate(async ({ session, webContents }, args) => {
  167 |       await session.fromPartition('persist:setdown-browser').cookies.set({ url: 'https://account.example.test', domain: '.example.test', name: 'parent-cookie', value: 'remove' });
  168 |       await webContents.fromId(args.tabId)!.executeJavaScript("localStorage.setItem('fixture-site', 'remove')");
  169 |     }, { tabId: target.tab.id });
  170 |     await popupValue("localStorage.setItem('fixture-extension', 'keep'); true");
  171 |     expect((await worker({ op: 'cookies', origin: 'https://*.prod.example.test' })).error).toBeUndefined();
  172 |     expect(await app.evaluate(async ({ session }) => (await session.fromPartition('persist:setdown-browser').cookies.get({ name: 'parent-cookie' })).length)).toBe(0);
  173 |     expect((await worker({ op: 'clearData', options: {}, data: { localStorage: true } })).error).toBeUndefined();
  174 |     expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript("localStorage.getItem('fixture-site')"), target.tab.id)).toBeNull();
  175 |     expect(await popupValue("localStorage.getItem('fixture-extension')")).toBe('keep');
  176 |     const downloaded = await worker({ op: 'download', details: { url: `${origin}/download`, filename: 'chat/대화.md' } });
  177 |     expect(downloaded.error).toBeUndefined(); expect(typeof downloaded.value).toBe('number');
  178 |     await expect.poll(async () => (await worker({ op: 'search', id: downloaded.value })).value?.[0]?.state).toBe('complete');
  179 |     expect(await readFile(path.join(root, 'downloads/chat/대화 (1).md'), 'utf8')).toContain('A saved conversation');
  180 |     expect(await readFile(path.join(root, 'downloads/chat/대화.md'), 'utf8')).toBe('Keep the existing file.');
  181 |     const downloadEvents = (await worker({ op: 'downloadEvents' })).value;
  182 |     expect(downloadEvents).toContainEqual({ type: 'created', id: downloaded.value });
  183 |     expect(downloadEvents).toContainEqual(expect.objectContaining({ type: 'changed', id: downloaded.value, state: { previous: 'in_progress', current: 'complete' } }));
  184 |     expect((await worker({ op: 'download', details: { url: `${origin}/download`, filename: 'shortcut/escape.md' } })).error).toContain('symbolic');
  185 |     expect((await worker({ op: 'callbackError' })).value).toContain('HTTP(S)');
  186 |     expect((await worker({ op: 'download', details: { url: `${origin}/download`, filename: '../escape.md' } })).error).toContain('filename');
  187 |     await worker({ op: 'dnr', details: { addRules: [{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: `${origin}/blocked`, resourceTypes: ['xmlhttprequest'] } }], removeRuleIds: [1] } });
  188 |     expect((await worker({ op: 'fetch', url: `${origin}/blocked` })).error).toBeTruthy();
  189 |     await worker({ op: 'dnr', details: { removeRuleIds: [1] } });
  190 |     expect((await worker({ op: 'fetch', url: `${origin}/blocked` })).value).toContain('Conversation');
```