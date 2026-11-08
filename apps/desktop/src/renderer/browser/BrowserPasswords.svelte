<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppActions } from '../ports/ui-actions';
  import type { CredentialStatus } from '../../core/browser/credentials';
  let { actions }: { actions: AppActions } = $props();
  let status = $state<CredentialStatus>({ available: false, unlocked: false, accounts: [] }), error = $state(''), busy = $state(false), loaded = $state(false), query = $state('');
  const matches = $derived(status.accounts.filter(item => `${item.origin}\n${item.username}`.toLowerCase().includes(query.toLowerCase())));
  async function refresh() { try { status = await actions.browserPasswordStatus(); error = ''; } catch { status = { available: true, unlocked: false, accounts: [] }; error = 'Cannot open the password vault. The existing file was kept.'; } finally { loaded = true; } }
  async function run(operation: () => Promise<unknown>) { busy = true; error = ''; try { await operation(); await refresh(); } catch (reason) { error = String(reason); } finally { busy = false; } }
  onMount(() => { void refresh(); const timer = setInterval(() => { if (!document.hidden && !busy) void refresh(); }, 15000); return () => clearInterval(timer); });
</script>
<div class="passwords">
  <p>Local passwords are protected by your OS account. On an HTTPS login page, use the key button (or More page actions) to save or fill a login. Filling never submits the form.</p>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if loaded && !status.available}<p role="status">A protected OS password store is unavailable. Password saving is disabled.</p>
  {:else if loaded}
    <button disabled={busy} onclick={() => void run(status.unlocked ? actions.browserLockPasswords : actions.browserUnlockPasswords)}>{status.unlocked ? 'Lock password use' : 'Unlock password use…'}</button>
    {#if status.unlocked}
      <p>Allowed for up to 10 minutes, until screen lock or sleep. This app lock does not replace OS sign-in.</p>
      <input aria-label="Search saved accounts" placeholder="Search saved accounts" bind:value={query}/>
      <div class="accounts">{#each matches.slice(0,100) as account (account.id)}<div class="account"><span>{account.origin}<small>{account.username}</small></span><button disabled={busy} aria-label={`Delete password: ${account.origin} ${account.username}`} onclick={() => void run(() => actions.browserDeletePassword(account.id))}>Delete</button></div>{/each}</div>
      {#if matches.length > 100}<p>Showing the first 100 accounts. Narrow the search to find another account.</p>{/if}
      {#if !status.accounts.length}<p>No saved passwords.</p>{/if}
    {/if}
  {/if}
</div>
<style>
  .passwords { padding: 0 12px 12px; overflow: auto; min-height: 0; } p { line-height: 1.6; overflow-wrap: anywhere; }
  button, input { padding: 7px; border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-canvas); color: inherit; font: inherit; } button { cursor: pointer; } button:disabled { opacity: .5; }
  input { width: 100%; box-sizing: border-box; } .account { display: flex; gap: 6px; align-items: center; padding: 9px 0; } .account span { min-width: 0; overflow-wrap: anywhere; flex: 1; } small { display: block; opacity: .7; margin-top: 5px; }
</style>
