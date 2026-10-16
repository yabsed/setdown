<script lang="ts">
  import type { AppActions } from '../ports/ui-actions';
  import type { BrowserExtensionInfo, ExtensionInstallKind } from '../../protocol/browser';
  import { browser } from './browser-state.svelte';
  import { webStoreId, webStoreURL } from '../../core/browser/web-store';
  let { actions }: { actions: AppActions } = $props();
  let rows = $state<BrowserExtensionInfo[]>([]), error = $state(''), busy = $state(false);
  let storeInput = $state(''), showStore = $state(false), showInstall = $state(false), expanded = $state<string | null>(null);
  $effect(() => {
    void browser.revision;
    let current = true;
    void actions.browserExtensions().then(result => { if (current) { rows = result; error = ''; } })
      .catch(reason => { if (current) error = String(reason); });
    return () => { current = false; };
  });
  async function run(task: () => Promise<BrowserExtensionInfo[]>) {
    busy = true; error = '';
    try { rows = await task(); }
    catch (reason) { error = String(reason); }
    finally { busy = false; }
  }
  const install = (kind: ExtensionInstallKind) => void run(() => actions.browserInstallExtension(kind));
  function installStore(input = storeInput) {
    try {
      const id = webStoreId(input);
      void run(() => actions.browserInstallExtension('web-store', id));
    } catch (reason) { error = String(reason); }
  }
</script>

<div class="extensions">
  <button class="add-extension" aria-expanded={showInstall} onclick={() => { showInstall = !showInstall; }}><span aria-hidden="true">＋</span> Add extension</button>
  {#if showInstall}<div class="install">
    <button disabled={busy} aria-expanded={showStore} onclick={() => { showStore = !showStore; }}>Install from Chrome Web Store…</button>
    {#if showStore}
      <form onsubmit={event => { event.preventDefault(); if (!busy) installStore(); }}>
        <input aria-label="Chrome Web Store link or extension ID" placeholder="Paste store link or extension ID" maxlength="4096" bind:value={storeInput} disabled={busy} />
        <button type="submit" disabled={busy || !storeInput.trim()}>Install extension</button>
        <button type="button" onclick={() => actions.newWebTab('https://chromewebstore.google.com/')}>Browse Chrome Web Store</button>
      </form>
    {/if}
    <button disabled={busy} onclick={() => install('archive')}>Install from file (.zip/.crx)…</button>
    <button disabled={busy} onclick={() => install('folder')}>Install from folder…</button>
  </div>{/if}
  {#if busy}<p class="hint" role="status">Preparing extension installation…</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#each rows as item (item.id)}
    <div class="extension" class:disabled={!item.enabled}>
      <div class="extension-head">
        <span class="extension-icon" aria-hidden="true">{#if item.icon}<img src={item.icon} alt="" />{:else}<span>{item.name.slice(0, 1)}</span>{/if}</span>
        <div class="extension-copy"><span class="extension-name" title={item.name}>{item.name}</span>
          <small class="description" title={item.description}>{item.description || (item.builtin ? 'Built-in protection' : `Version ${item.version}`)}</small>
        </div>
        {#if item.builtin}<span class="builtin" title="Built-in extension">Built-in</span>
        {:else}<button class="toggle" class:on={item.enabled} disabled={busy} role="switch" aria-checked={item.enabled} aria-label={`Enable ${item.name}`}
          onclick={() => void run(() => actions.browserSetExtensionEnabled(item.id, !item.enabled))}><span></span></button>{/if}
        <button class="more" aria-label={`More actions for ${item.name}`} aria-expanded={expanded === item.id}
          onclick={() => { expanded = expanded === item.id ? null : item.id; }}>⋯</button>
      </div>
      {#if item.error}<p class="extension-error" role="alert">{item.error}</p>{/if}
      {#if expanded === item.id}
        <div class="extension-actions">
          {#if item.hasPopup}<button disabled={busy || !item.enabled} onclick={() => void actions.browserOpenExtension(item.id, 'popup').catch(reason => { error = String(reason); })}>Open extension</button>{/if}
          {#if item.hasOptions}<button disabled={busy || !item.enabled} onclick={() => void actions.browserOpenExtension(item.id, 'options').catch(reason => { error = String(reason); })}>Options</button>{/if}
          {#if !item.builtin}
            {#if item.webStoreId}
              <button disabled={busy} onclick={() => installStore(item.webStoreId)}>Update from Web Store</button>
              <button onclick={() => actions.newWebTab(webStoreURL(item.webStoreId!))}>View in Web Store</button>
            {/if}
            <button class="remove" disabled={busy} onclick={() => void run(() => actions.browserRemoveExtension(item.id))}>Remove</button>
          {/if}
          <small class="extension-version">{item.version}</small>
          <small class="identifier">Manifest V{item.manifestVersion} · {item.id}</small>
        </div>
      {/if}
    </div>
  {/each}
  {#if !rows.length}<p class="empty">No extensions yet. uBlock Origin appears here once a web tab is open.</p>{/if}
</div>

<style>
  .extensions { overflow: auto; min-height: 0; min-width: 0; padding: 2px 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  button { border: 0; border-radius: 6px; background: none; color: inherit; cursor: pointer; font: inherit; padding: 7px; }
  button:hover { background: var(--app-hover); } button:disabled { opacity: .4; cursor: default; }
  button:focus-visible { outline: 1px solid var(--app-text); outline-offset: -2px; }
  .add-extension { display: flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--app-border); font-size: 12px; }
  .add-extension span { font-size: 17px; }
  .install { display: flex; flex-direction: column; gap: 2px; padding: 4px; border: 1px solid var(--app-border); border-radius: 8px; }
  .install button { text-align: left; overflow-wrap: anywhere; }
  form { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px; min-width: 0; }
  input { box-sizing: border-box; width: 100%; min-width: 0; padding: 6px; border: 1px solid var(--app-border); border-radius: 5px; color: inherit; background: var(--app-canvas); font: inherit; }
  .hint, .empty { margin: 0; line-height: 1.6; opacity: .6; } [role="alert"] { margin: 0; color: #b94f4f; font-size: 11px; overflow-wrap: anywhere; }
  .extension { border: 1px solid var(--app-border); border-radius: 10px; padding: 10px 8px; min-width: 0; }
  .extension-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .extension-icon { width: 30px; height: 30px; flex: 0 0 30px; display: grid; place-items: center; border-radius: 7px; background: var(--app-hover); font-size: 18px; }
  .extension-icon img { width: 28px; height: 28px; object-fit: contain; }
  .disabled .extension-icon { opacity: .45; filter: grayscale(1); }
  .extension-copy { min-width: 0; flex: 1; display: grid; gap: 4px; }
  .extension-name { font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .description { opacity: .6; font-size: 11px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .toggle { width: 29px; height: 17px; flex: 0 0 29px; padding: 2px; border-radius: 12px; background: var(--app-muted-text, #888); }
  .toggle span { display: block; width: 13px; height: 13px; border-radius: 50%; background: white; transition: transform .12s; }
  .toggle.on { background: #7961db; } .toggle.on span { transform: translateX(12px); }
  .more { padding: 0; width: 22px; height: 26px; flex: 0 0 22px; font-size: 18px; }
  .builtin { font-size: 9px; opacity: .55; }
  .extension-actions { margin-top: 10px; padding-top: 6px; border-top: 1px solid var(--app-border); display: flex; flex-direction: column; gap: 2px; }
  .extension-actions button { text-align: left; font-size: 12px; } .remove { color: #bf555b; }
  .extension-version, .identifier { opacity: .5; font-size: 10px; padding: 2px 7px; overflow-wrap: anywhere; }
</style>
