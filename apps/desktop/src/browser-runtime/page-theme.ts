import { ipcRenderer, webFrame } from 'electron';
import * as DarkReader from '@setdown/darkreader';
import { injectProxy } from '@setdown/darkreader-proxy';
import { siteFix } from '@setdown/darkreader-fixes';
import { themeProfile } from '../core/theme/theme-catalog';
import type { BrowserThemePolicy } from '../protocol/browser-theme';

let policy: BrowserThemePolicy | undefined;
let applied: string | null = null;
let enabling = false;
let proxyWork = Promise.resolve();
const runProxy = (script: string) => {
  proxyWork = proxyWork.then(() => webFrame.executeJavaScript(script)).then(() => {}).catch(() => {});
};
// A page CSP must not block the engine's bundled CSSOM observer. Only the
// synchronous enable() call can request it; website events cannot invoke code
// through this listener. No desktop or resource-fetch API enters the page world.
document.addEventListener('__darkreader__stylesheetProxy__arg', event => {
  if (!enabling) return;
  const flags = (event as CustomEvent).detail;
  runProxy(`(${injectProxy.toString()})(${flags?.enableStyleSheetsProxy === true},${flags?.enableCustomElementRegistryProxy === true})`);
});
let active = 0;
const waiting: Array<() => void> = [];
DarkReader.setFetchMethod(async url => {
  if (/^data:image\//i.test(url)) return fetch(url);
  const token = policy?.token;
  if (token === undefined || waiting.length >= 128) throw Error('Web theme resource queue is full.');
  if (active >= 6) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  try {
    if (policy?.token !== token) throw Error('The web theme changed.');
    const response = await ipcRenderer.invoke('browser:theme-fetch', { url, token });
    if (policy?.token !== token) throw Error('The web theme changed.');
    return new Response(new Uint8Array(response.bytes), { headers: { 'content-type': response.type } });
  } finally { const next = waiting.shift(); if (next) next(); else active--; }
});
function apply() {
  if (!policy || !document.documentElement) return;
  const signature = JSON.stringify([policy.token, policy.theme, policy.url]);
  if (signature === applied) return;
  // Updating enable() alone can retain previous palette caches. Both calls run
  // in the same task, preserving page identity, form state and scroll position.
  DarkReader.disable();
  runProxy('document.dispatchEvent(new CustomEvent("__darkreader__cleanUp"))');
  if (!policy.theme) { applied = signature; return; }
  const { appearance, palette } = themeProfile(policy.theme);
  enabling = true;
  try { DarkReader.enable({ mode: appearance === 'dark' ? 1 : 0, brightness: 100, contrast: 100,
    grayscale: 0, sepia: 0, useFont: false,
    darkSchemeBackgroundColor: palette.surface, darkSchemeTextColor: palette.text,
    lightSchemeBackgroundColor: palette.surface, lightSchemeTextColor: palette.text,
  }, siteFix(policy.url)); applied = signature; }
  finally { enabling = false; }
}
ipcRenderer.on('browser:theme-policy', (_event, value: BrowserThemePolicy) => { policy = value; apply(); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
window.addEventListener('pagehide', () => { policy = undefined; applied = null; DarkReader.disable(); });
