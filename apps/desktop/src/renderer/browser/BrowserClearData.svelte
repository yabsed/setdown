<script lang="ts">
  import type { AppActions } from '../ports/ui-actions';
  import type { BrowserDataCategory } from '../../protocol/browser';
  let { actions, close }: { actions: AppActions; close(): void } = $props();
  const options: Array<{ id: BrowserDataCategory; label: string; detail: string }> = [
    { id: 'history', label: 'Browsing history', detail: 'Visited pages and recently closed tabs' },
    { id: 'cookies', label: 'Cookies and site data', detail: 'Signs you out of most sites; open pages reload' },
    { id: 'cache', label: 'Cached files', detail: 'Pages may load more slowly once' },
    { id: 'downloads', label: 'Download list', detail: 'Downloaded files stay on disk' },
    { id: 'site-settings', label: 'Site settings', detail: 'Page permissions and per-site colors' },
    { id: 'passwords', label: 'Saved passwords', detail: 'Every saved login' },
  ];
  let selected = $state<Record<BrowserDataCategory, boolean>>({ history: true, cookies: true, cache: true, downloads: false, 'site-settings': false, passwords: false });
  let busy = $state(false), error = $state(''), done = $state('');
  const chosen = $derived(options.filter(option => selected[option.id]).map(option => option.id));
  async function clear() {
    busy = true; error = ''; done = '';
    try {
      const result = await actions.browserClearData(chosen);
      const names = (ids: BrowserDataCategory[]) => ids.map(id => options.find(option => option.id === id)!.label.toLowerCase()).join(', ');
      if (result.cleared.length) done = `Cleared ${names(result.cleared)}.`;
      if (result.failed.length) error = `Could not clear ${result.failed.map(failure => `${names([failure.category])} (${failure.error})`).join('; ')}.`;
    } catch (reason) { error = String(reason).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/, ''); }
    finally { busy = false; }
  }
</script>
<div class="clear-data" role="group" aria-label="Clear browsing data">
  <strong>Clear browsing data</strong>
  <small>For every site and all time. Bookmarks and extensions are kept.</small>
  {#each options as option (option.id)}
    <label><input type="checkbox" bind:checked={selected[option.id]} disabled={busy} /><span>{option.label}<small>{option.detail}</small></span></label>
  {/each}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if done}<p role="status">{done}</p>{/if}
  <div class="buttons"><button disabled={busy || !chosen.length} onclick={() => void clear()}>Clear data</button><button disabled={busy} onclick={close}>{done ? 'Done' : 'Cancel'}</button></div>
</div>
<style>
  .clear-data { display: flex; flex-direction: column; gap: 7px; margin: 0 12px 10px; padding: 10px; border: 1px solid var(--app-border); border-radius: 5px; overflow: auto; min-height: 0; }
  label { display: flex; align-items: flex-start; gap: 7px; cursor: pointer; } label span { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  input { margin: 2px 0 0; } small { opacity: .6; line-height: 1.5; } p { margin: 0; line-height: 1.6; overflow-wrap: anywhere; }
  .buttons { display: flex; gap: 4px; } button { flex: 1; border: 0; border-radius: 4px; padding: 6px; background: var(--app-hover); color: inherit; font: inherit; cursor: pointer; } button:disabled { opacity: .4; cursor: default; }
</style>
