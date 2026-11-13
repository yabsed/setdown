<script lang="ts">
  import type { AppActions } from '../ports/ui-actions';
  import type { BrowserPasswordList } from '../../core/browser/passwords';
  import { browser } from './browser-state.svelte';
  let { actions, query }: { actions: AppActions; query: string } = $props();
  let list = $state<BrowserPasswordList>({ entries: [], neverSave: [], persistent: true, warning: null });
  let error = $state(''), status = $state(''), busy = $state(false), adding = $state(false), removing = $state('');
  // A revealed password is held only while its row shows it.
  let revealed = $state<Record<string, string>>({});
  let url = $state(''), username = $state(''), password = $state('');
  // The entry being edited. Its password field starts empty: the saved one is not fetched to change it.
  let editing = $state(''), editUser = $state(''), editPassword = $state('');
  const message = (reason: unknown) => String(reason).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/, '');
  $effect(() => {
    void browser.passwordRevision;
    let current = true;
    void actions.browserPasswords().then(value => { if (current) { list = value; revealed = {}; removing = ''; editing = ''; editPassword = ''; } })
      .catch(reason => { if (current) error = message(reason); });
    return () => { current = false; };
  });
  const rows = $derived(list.entries.filter(entry => `${entry.origin} ${entry.username}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  async function run(task: () => Promise<unknown>) {
    busy = true; error = ''; status = '';
    try { await task(); } catch (reason) { error = message(reason); } finally { busy = false; }
  }
  const reveal = (id: string) => run(async () => {
    if (revealed[id] !== undefined) { delete revealed[id]; return; }
    revealed[id] = await actions.browserRevealPassword(id);
  });
  const copy = (id: string) => run(async () => { await navigator.clipboard.writeText(await actions.browserRevealPassword(id)); status = 'Password copied.'; });
  const remove = (id: string) => run(async () => { await actions.browserRemovePassword(id); });
  function edit(id: string, user: string) { editing = id; editUser = user; editPassword = ''; removing = ''; error = ''; }
  const saveEdit = (id: string, user: string) => run(async () => {
    const changes: { username?: string; password?: string } = {};
    if (editUser.trim() !== user) changes.username = editUser;
    if (editPassword) changes.password = editPassword;
    if (changes.username !== undefined || changes.password !== undefined) { await actions.browserUpdatePassword(id, changes); status = 'Saved.'; }
    editing = ''; editPassword = '';
  });
  const add = () => run(async () => {
    await actions.browserAddPassword({ url, username, password });
    url = ''; username = ''; password = ''; adding = false;
  });
  const importFile = () => run(async () => {
    const result = await actions.browserImportPasswords();
    if (result) status = `Imported ${result.added} new and updated ${result.updated}; skipped ${result.skipped}.`;
  });
  const exportFile = () => run(async () => {
    const result = await actions.browserExportPasswords();
    if (result) status = `Exported ${result.passwords} passwords to ${result.path}`;
  });
</script>
<div class="passwords">
  <div class="transfer">
    <button disabled={busy} onclick={() => { adding = !adding; error = ''; }}>{adding ? 'Cancel' : 'Add…'}</button>
    <button disabled={busy} onclick={() => void importFile()}>Import passwords…</button>
    <button disabled={busy || !list.entries.length} onclick={() => void exportFile()}>Export passwords…</button>
  </div>
  {#if !list.persistent}<p class="notice" role="note">No system keyring is available, so passwords are kept only until Setdown quits. Nothing is written to disk.</p>{/if}
  {#if list.warning}<p class="notice" role="alert">{list.warning}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if status}<p role="status">{status}</p>{/if}
  {#if adding}
    <form class="add" aria-label="Add a password" onsubmit={event => { event.preventDefault(); void add(); }}>
      <input aria-label="Website" placeholder="example.com" bind:value={url} spellcheck="false" autocomplete="off" required />
      <input aria-label="User name" placeholder="User name" bind:value={username} spellcheck="false" autocomplete="off" />
      <input aria-label="Password" placeholder="Password" type="password" bind:value={password} autocomplete="new-password" required />
      <button type="submit" disabled={busy}>Save</button>
    </form>
  {/if}
  <div class="items">
    {#each rows as entry (entry.id)}
      <div class="item" role="group" aria-label={`${entry.username || 'No user name'} on ${entry.origin}`}>
        <div class="login"><span class="site" title={entry.origin}>{entry.origin.replace(/^https:\/\//, '')}</span>
          <small>{entry.username || '(no user name)'}{#if revealed[entry.id] !== undefined} · <code>{revealed[entry.id]}</code>{/if}</small></div>
        {#if editing === entry.id}
          <form class="edit" aria-label={`Edit login for ${entry.origin}`} onsubmit={event => { event.preventDefault(); void saveEdit(entry.id, entry.username); }}>
            <input aria-label="User name" placeholder="User name" bind:value={editUser} spellcheck="false" autocomplete="off" />
            <input aria-label="New password" placeholder="New password (empty keeps it)" type="password" bind:value={editPassword} autocomplete="new-password" />
            <div><button type="submit" disabled={busy}>Save</button><button type="button" disabled={busy} onclick={() => { editing = ''; editPassword = ''; }}>Cancel</button></div>
          </form>
        {:else if removing === entry.id}
          <button disabled={busy} onclick={() => void remove(entry.id)}>Remove</button><button disabled={busy} onclick={() => { removing = ''; }}>Keep</button>
        {:else}
          <button disabled={busy} aria-label={revealed[entry.id] !== undefined ? 'Hide password' : 'Show password'} title={revealed[entry.id] !== undefined ? 'Hide password' : 'Show password'} onclick={() => void reveal(entry.id)}>{revealed[entry.id] !== undefined ? 'Hide' : 'Show'}</button>
          <button disabled={busy} aria-label="Copy password" title="Copy password" onclick={() => void copy(entry.id)}>Copy</button>
          <button disabled={busy} aria-label="Edit login" title="Change the user name or password" onclick={() => edit(entry.id, entry.username)}>Edit</button>
          <button disabled={busy} aria-label="Remove password" title="Remove this saved password" onclick={() => { removing = entry.id; }}>×</button>
        {/if}
      </div>
    {/each}
    {#if !rows.length}<p>{list.entries.length ? 'No saved password matches.' : 'Passwords you choose to save appear here.'}</p>{/if}
    {#if list.neverSave.length}
      <h3>Never saved</h3>
      {#each list.neverSave as origin (origin)}
        <div class="item"><div class="login"><span class="site" title={origin}>{origin.replace(/^https:\/\//, '')}</span></div>
          <button disabled={busy} aria-label={`Ask again for ${origin}`} title="Offer to save passwords for this site again" onclick={() => void run(() => actions.browserAllowPasswordSaving(origin))}>Ask again</button></div>
      {/each}
    {/if}
  </div>
</div>
<style>
  .passwords { display: flex; flex-direction: column; min-height: 0; gap: 6px; padding: 0 8px 10px; }
  button { border: 0; border-radius: 4px; padding: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; } button:hover { background: var(--app-hover); } button:disabled { opacity: .5; cursor: default; }
  .transfer { display: flex; flex-wrap: wrap; gap: 3px; }
  .add { display: flex; flex-direction: column; gap: 5px; padding: 8px; border: 1px solid var(--app-border); border-radius: 5px; }
  .add input { min-width: 0; padding: 6px 8px; border: 1px solid var(--app-border); border-radius: 4px; background: var(--app-canvas); color: inherit; font: inherit; }
  .items { overflow: auto; min-height: 0; } .item { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
  .edit { flex: 1 1 100%; display: flex; flex-direction: column; gap: 5px; margin: 0 7px 8px; } .edit div { display: flex; gap: 3px; }
  .edit input { min-width: 0; padding: 6px 8px; border: 1px solid var(--app-border); border-radius: 4px; background: var(--app-canvas); color: inherit; font: inherit; }
  .login { flex: 1; display: flex; flex-direction: column; min-width: 0; gap: 4px; padding: 8px 7px; }
  .site, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { opacity: .65; } code { user-select: all; }
  h3 { margin: 12px 7px 2px; font: 600 11px var(--app-font-family); opacity: .6; text-transform: uppercase; }
  p { margin: 0; padding: 4px; line-height: 1.6; overflow-wrap: anywhere; } .notice { opacity: .8; }
</style>
