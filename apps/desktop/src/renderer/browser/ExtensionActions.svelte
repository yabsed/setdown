<script lang="ts">
  import type { BrowserActions } from './browser-actions';
  import { browser } from './browser-state.svelte';
  let { actions, tabId }: { actions: BrowserActions; tabId: string } = $props();
</script>
<button data-extension-tab={tabId} class="extensions-button" title="Extensions" aria-label="Extensions menu" aria-haspopup="dialog" onclick={event => {
  const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
  void actions.browserExtensionMenu(tabId, { x, y, width, height }).catch(error => { browser.error = String(error); });
}}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7V5a2.5 2.5 0 0 1 5 0v2h3a2 2 0 0 1 2 2v3h1a2.5 2.5 0 0 1 0 5h-1v3H5a1 1 0 0 1-1-1v-4h2a2.5 2.5 0 0 0 0-5H4V8a1 1 0 0 1 1-1Z"/></svg>
</button>
<style>
  button { display: grid; place-items: center; flex: 0 0 28px; width: 28px; height: 28px; padding: 5px; border: 0; border-radius: 7px; background: transparent; color: var(--app-muted-text); cursor: pointer; }
  button:hover { background: var(--app-hover); color: var(--app-text); }
  button:focus-visible { outline: 1px solid var(--app-muted-text); outline-offset: -1px; }
</style>
