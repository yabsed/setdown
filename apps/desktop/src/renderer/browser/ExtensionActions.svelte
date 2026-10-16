<script lang="ts">
  import type { BrowserExtensionAction } from '../../protocol/browser';
  import type { BrowserActions } from './browser-actions';
  import { browser } from './browser-state.svelte';
  let { actions, tabId }: { actions: BrowserActions; tabId: string } = $props();
  let items = $state<BrowserExtensionAction[]>([]);
  $effect(() => {
    void browser.revision;
    const id = tabId; let current = true;
    void actions.browserExtensionActions(id).then(result => { if (current) items = result; }).catch(() => { if (current) items = []; });
    return () => { current = false; };
  });
  function bounds(button: HTMLButtonElement) {
    const { x, y, width, height } = button.getBoundingClientRect(); return { x, y, width, height };
  }
</script>
<div class="extension-actions" aria-label="Extension actions" role="group">
  {#each items.filter(item => item.pinned).slice(0, 3) as item (item.id)}
    <button title={item.title} aria-label={item.title} disabled={!item.enabled} onclick={event => {
      void actions.browserActivateExtension(item.id, tabId, bounds(event.currentTarget)).catch(error => { browser.error = String(error); });
    }}>
      {#if item.icon}<img src={item.icon} alt="" />{:else}<span aria-hidden="true">{item.title.slice(0, 1)}</span>{/if}
      {#if item.badge}<span class="badge" style:background-color={item.color}>{item.badge.slice(0, 4)}</span>{/if}
    </button>
  {/each}
  {#if items.length}<button title="Extensions" aria-label="Extensions menu" onclick={event => {
    void actions.browserExtensionMenu(tabId, bounds(event.currentTarget)).catch(error => { browser.error = String(error); });
  }}>⋯</button>{/if}
</div>
<style>
  .extension-actions { display: flex; flex: 0 0 auto; gap: 1px; }
  button { position: relative; display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 5px; background: transparent; color: var(--app-text); cursor: pointer; }
  button:hover { background: var(--app-hover); } button:disabled { opacity: .4; cursor: default; }
  button:focus-visible { outline: 1px solid var(--app-muted-text); outline-offset: -1px; }
  img { width: 18px; height: 18px; object-fit: contain; }
  .badge { position: absolute; right: 0; bottom: 0; max-width: 27px; padding: 0 2px; border-radius: 2px; color: white; font: 9px/12px sans-serif; overflow: hidden; }
</style>
