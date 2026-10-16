import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import { patchExtensionPreload, secureExtensionInvocations } from './extension-preload.mjs';

const require = createRequire(import.meta.url);
const header = 'onHeadersReceived: new ExtensionEvent("webRequest.onHeadersReceived")';
const storage = 'managed: local,';
const freeze = 'Object.freeze(chrome);';
const fixture = `const chrome = { webRequest: { ${header} }, storage: { ${storage} local } }; ${freeze}`;

test('patched preload preserves native headers, disables managed storage and aliases browser before freezing', () => {
  const nativeHeaders = {};
  const local = {};
  const context = vm.createContext({ base: { onHeadersReceived: nativeHeaders }, local, browser: {} });
  vm.runInContext(patchExtensionPreload(fixture), context);
  assert.equal(context.browser.webRequest.onHeadersReceived, nativeHeaders);
  assert.equal(context.browser.storage.managed, undefined);
  assert.equal(context.browser.storage.local, local);
  assert.equal(Object.isFrozen(context.browser), true);
});

test('missing and ambiguous upstream patch sites require review', () => {
  for (const site of [header, storage, freeze]) {
    assert.throws(() => patchExtensionPreload(fixture.replace(site, '')), /Review the/);
    assert.throws(() => patchExtensionPreload(fixture + site), /Review the/);
  }
});

test('the installed compatibility library still matches every guarded patch', () => {
  const upstream = readFileSync(require.resolve('electron-chrome-extensions/preload'), 'utf8');
  const patched = patchExtensionPreload(upstream);
  assert.notEqual(patched, upstream);
  assert.throws(() => patchExtensionPreload(patched), /Review the/);
});

test('extensions without webRequest still initialize and additions preserve literal dollar expressions', () => {
  const context = vm.createContext({ base: undefined, local: {}, browser: {} });
  const addition = 'globalThis.literal = "$& $` $\\\'";';
  vm.runInContext(patchExtensionPreload(fixture, addition), context);
  assert.equal(context.browser.webRequest.onHeadersReceived, undefined);
  assert.equal(context.literal, "$& $` $'");
});

test('production additions compile and never enable upstream API payload logging', async () => {
  const { extensionAPI } = await import('./extension-api.mjs');
  const upstream = readFileSync(require.resolve('electron-chrome-extensions/preload'), 'utf8');
  const result = secureExtensionInvocations(patchExtensionPreload(upstream, extensionAPI));
  new vm.Script(result);
  assert.ok(!result.includes('console.log(fnName, args)'));
  assert.ok(!result.includes('console.log(fnName, "(result)", result)'));
});
