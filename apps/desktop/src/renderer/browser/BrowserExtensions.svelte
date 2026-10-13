<script lang="ts">
  import type { AppActions } from '../view-state.svelte';
  import type { BrowserExtensionInfo, ExtensionInstallKind } from '../../protocol/browser';
  import { browser } from './browser-state.svelte';
  let { actions }: { actions: AppActions } = $props();
  let rows = $state<BrowserExtensionInfo[]>([]), error = $state(''), busy = $state(false);
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
</script>

<div class="extensions">
  <div class="install">
    <button disabled={busy} onclick={() => install('archive')}>Install from file (.zip/.crx)…</button>
    <button disabled={busy} onclick={() => install('folder')}>Install from folder…</button>
  </div>
  <p class="hint">Extensions run with access to pages you visit. File-installed extensions do not update automatically; install a newer file to replace one.</p>
  {#if error}<p role="alert">{error}</p>{/if}
  {#each rows as item (item.id)}
    <div class="extension">
      <div class="extension-head">
        <span class="extension-name">{item.name}</span>
        <span class="extension-version">{item.version}</span>
        {#if item.builtin}<span class="badge">Built-in</span>{/if}
      </div>
      {#if item.description}<small>{item.description}</small>{/if}
      <small>Manifest V{item.manifestVersion} · {item.id}</small>
      {#if item.error}<p class="extension-error" role="alert">{item.error}</p>{/if}
      <div class="extension-actions">
        {#if item.hasPopup}<button disabled={busy || !item.enabled} onclick={() => void actions.browserOpenExtension(item.id, 'popup').catch(reason => { error = String(reason); })}>Popup</button>{/if}
        {#if item.hasOptions}<button disabled={busy || !item.enabled} onclick={() => void actions.browserOpenExtension(item.id, 'options').catch(reason => { error = String(reason); })}>Options</button>{/if}
        {#if !item.builtin}
          <button disabled={busy} aria-pressed={item.enabled}
            onclick={() => void run(() => actions.browserSetExtensionEnabled(item.id, !item.enabled))}>{item.enabled ? 'Disable' : 'Enable'}</button>
          <button disabled={busy} onclick={() => void run(() => actions.browserRemoveExtension(item.id))}>Remove</button>
        {/if}
      </div>
    </div>
  {/each}
  {#if !rows.length}<p class="empty">No extensions yet. uBlock Origin appears here once a web tab is open.</p>{/if}
</div>

<style>
  .extensions { overflow: auto; min-height: 0; min-width: 0; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 10px; }
  .install button { overflow-wrap: anywhere; } .extension { min-width: 0; }
  button { border: 0; border-radius: 5px; background: none; color: inherit; cursor: pointer; font: inherit; padding: 6px; }
  button:hover { background: var(--app-hover); } button:disabled { opacity: .4; cursor: default; }
  .install { display: flex; flex-direction: column; gap: 2px; } .install button { text-align: left; border: 1px solid var(--app-border); }
  .hint, .empty { margin: 0; line-height: 1.6; opacity: .6; } [role="alert"] { margin: 0; color: #b94f4f; }
  .extension { border: 1px solid var(--app-border); border-radius: 6px; padding: 9px; display: flex; flex-direction: column; gap: 6px; }
  .extension-head { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
  .extension-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .extension-version { opacity: .55; } .badge { font-size: 10px; opacity: .6; border: 1px solid var(--app-border); border-radius: 4px; padding: 1px 4px; }
  small { opacity: .55; overflow-wrap: anywhere; } .extension-error { margin: 0; }
  .extension-actions { display: flex; gap: 2px; flex-wrap: wrap; } .extension-actions button { border: 1px solid var(--app-border); }
</style>
