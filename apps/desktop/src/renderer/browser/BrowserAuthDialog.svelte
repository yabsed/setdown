<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { BrowserApi } from '../../protocol/browser';
  import { browser } from './browser-state.svelte';
  let { api }: { api: BrowserApi } = $props();
  let dialog: HTMLDialogElement;
  let username = $state(''), password = $state('');
  const id = $derived(browser.authId);
  const request = $derived(id ? browser.auth[id] : undefined);
  let shownToken: string | undefined;
  let covered = false;
  function cover(value: boolean) {
    if (covered === value) return;
    covered = value;
    window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: value }));
  }
  function answer(allow: boolean) {
    if (id && request) void api.authenticate(id, request.token, allow ? { username, password } : null)
      .catch(error => { browser.error = String(error); });
    username = ''; password = ''; browser.authId = null;
  }
  $effect(() => {
    if (request && request.token !== shownToken) {
      shownToken = request.token; username = ''; password = ''; cover(true);
      if (!dialog.open) dialog.showModal();
      queueMicrotask(() => dialog.querySelector<HTMLInputElement>('input')?.focus());
    } else if (!request && dialog.open) {
      dialog.close(); cover(false); shownToken = undefined; username = ''; password = '';
    }
  });
  onDestroy(() => cover(false));
</script>

<dialog bind:this={dialog} class="close-prompt-dialog" aria-labelledby="browser-auth-title"
  oncancel={event => { event.preventDefault(); answer(false); }} onclose={() => cover(false)}>
  <form class="close-prompt-form" onsubmit={event => { event.preventDefault(); answer(true); }}>
    <header><h2 id="browser-auth-title">Sign in to website</h2></header>
    <div class="close-prompt-body">
      <p class="origin">{request?.origin}</p>
      {#if request?.realm}<p>{request.realm}</p>{/if}
      <label>Username <input autocomplete="username" maxlength="4096" bind:value={username} /></label>
      <label>Password <input type="password" autocomplete="current-password" maxlength="4096" bind:value={password} /></label>
    </div>
    <footer><button type="button" onclick={() => answer(false)}>Cancel</button><button type="submit">Sign in</button></footer>
  </form>
</dialog>

<style>
  .origin { overflow-wrap: anywhere; }
  label { display: grid; gap: 6px; margin: 12px 0; }
  input { padding: 8px; color: var(--app-text); background: var(--app-canvas); border: 1px solid var(--app-border); border-radius: 4px; font: inherit; }
</style>
