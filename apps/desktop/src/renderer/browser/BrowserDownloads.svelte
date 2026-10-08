<script lang="ts">
  import type { AppActions } from '../view-state.svelte';
  import type { BrowserDownload, DownloadCommand } from '../../protocol/browser';
  import { browser } from './browser-state.svelte';
  let { actions, query }: { actions: AppActions; query: string } = $props();
  let error = $state('');
  const rows = $derived(browser.downloads.filter(item => `${item.name} ${item.url} ${item.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  function bytes(value: number) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  function status(item: BrowserDownload) {
    const size = item.total ? `${bytes(item.received)} / ${bytes(item.total)}` : bytes(item.received);
    return item.state === 'completed' ? `Completed · ${bytes(item.received)}`
      : item.state === 'cancelled' ? 'Cancelled'
      : item.state === 'interrupted' ? `Interrupted · ${size}`
      : `${item.paused ? 'Paused' : 'Downloading'} · ${size}`;
  }
  async function command(item: BrowserDownload, value: DownloadCommand) {
    error = '';
    try { await actions.browserDownloadCommand(item.id, value); }
    catch (reason) { error = String(reason); }
  }
</script>

<div class="downloads" aria-label="Downloads list">
  {#if error}<p role="alert">{error}</p>{/if}
  {#if !rows.length}<p class="empty">{query ? 'No matching downloads.' : 'Files downloaded from the web appear here.'}</p>{/if}
  {#each rows as item (item.id)}
    <article class="download" data-download-id={item.id} data-state={item.state}>
      <button class="filename" aria-label={`Open download: ${item.name}`} disabled={item.state !== 'completed'}
        title={item.path || item.url} onclick={() => void command(item, 'open')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4" /></svg><span>{item.name}</span>
      </button>
      <small class="status">{status(item)}</small>
      {#if item.state === 'progressing'}
        <progress aria-label={`Download progress: ${item.name}`} max={Math.max(1, item.total)} value={item.total ? item.received : undefined}></progress>
      {/if}
      <div class="actions">
        {#if item.state === 'progressing' || item.resumable}
          {#if item.paused || (item.state === 'interrupted' && item.resumable)}<button aria-label={`Resume download: ${item.name}`} onclick={() => void command(item, 'resume')}>Resume</button>
          {:else}<button aria-label={`Pause download: ${item.name}`} onclick={() => void command(item, 'pause')}>Pause</button>{/if}
          <button aria-label={`Cancel download: ${item.name}`} onclick={() => void command(item, 'cancel')}>Cancel</button>
        {:else}
          {#if item.state === 'completed'}<button aria-label={`Show download in folder: ${item.name}`} onclick={() => void command(item, 'show')}>Show in folder</button>{/if}
          <button aria-label={`Remove download: ${item.name}`} title="Remove from list; keep the file" onclick={() => void command(item, 'remove')}>Remove</button>
        {/if}
      </div>
    </article>
  {/each}
</div>

<style>
  .downloads { overflow: auto; min-height: 0; padding: 0 12px 12px; }
  .download { padding: 10px 0; border-bottom: 1px solid var(--app-border); }
  button { border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
  button:hover { background: var(--app-hover); }
  .filename { display: flex; align-items: center; gap: 8px; text-align: left; padding: 4px 0; max-width: 100%; }
  .filename:disabled { cursor: default; } .filename:disabled:hover { background: transparent; }
  .filename span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  svg { width: 15px; height: 15px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.5; }
  small { display: block; margin: 5px 0; font-size: 10px; color: var(--app-muted-text); font-variant-numeric: tabular-nums; }
  progress { display: block; width: 100%; height: 3px; margin: 8px 0; accent-color: var(--app-text); }
  .actions { display: flex; gap: 4px; margin-left: -5px; } .actions button { padding: 4px 5px; font-size: 10px; color: var(--app-muted-text); }
  p { margin: 10px 0; line-height: 1.7; color: var(--app-muted-text); }
</style>
