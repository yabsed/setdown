<script lang="ts">
  import type { AppActions } from '../view-state.svelte';
  import type { BrowserPlace } from '../../protocol/browser';
  import { browser } from './browser-state.svelte';
  import BrowserDownloads from './BrowserDownloads.svelte';
  let { actions }: { actions: AppActions } = $props();
  let query = $state(''), section = $state<'bookmarks' | 'history' | 'downloads'>('bookmarks');
  let rows = $state<BrowserPlace[]>([]), error = $state(''), loading = $state(false), confirming = $state(false), deleting = $state(false);
  const activeDownloads = $derived(browser.downloads.filter(item => item.state === 'progressing').length);
  $effect(() => {
    const text = query, scope = section; void browser.revision;
    if (scope === 'downloads') return;
    let current = true; loading = true;
    const timer = setTimeout(() => void actions.browserPlaces(text, scope).then(result => {
      if (current) { rows = result; error = ''; }
    }).catch(reason => { if (current) error = String(reason); }).finally(() => { if (current) loading = false; }), 100);
    return () => { current = false; clearTimeout(timer); };
  });
  async function deleteHistory(url?: string) {
    deleting = true; error = '';
    try { await actions.browserDeleteHistory(url); confirming = false; }
    catch (reason) { error = String(reason); }
    finally { deleting = false; }
  }
  function select(value: typeof section) { section = value; query = ''; error = ''; confirming = false; }
</script>

<div class="browser-sidebar">
  <header><span>Browser</span><button aria-label="New web tab" title="New web tab (Ctrl/Cmd+T)" onclick={() => actions.newWebTab()}>+</button></header>
  <input aria-label={section === 'downloads' ? 'Search downloads' : 'Search bookmarks and history'} placeholder={`Search ${section}`} bind:value={query} />
  <nav aria-label="Browser library">
    <button class:selected={section === 'bookmarks'} aria-pressed={section === 'bookmarks'} onclick={() => select('bookmarks')}>Bookmarks</button>
    <button class:selected={section === 'history'} aria-pressed={section === 'history'} onclick={() => select('history')}>History</button>
    <button class:selected={section === 'downloads'} aria-pressed={section === 'downloads'} onclick={() => select('downloads')}>Downloads{#if activeDownloads}<span class="count">{activeDownloads}</span>{/if}</button>
  </nav>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if section === 'downloads'}
    <BrowserDownloads {actions} {query} />
  {:else}
  {#if section === 'history'}
    {#if confirming}
      <div class="history-confirm" role="group" aria-label="Confirm clear history">
        <span>Clear all browsing history?</span><small>Your bookmarks will be kept.</small>
        <div><button disabled={deleting} onclick={() => void deleteHistory()}>Clear all history</button><button disabled={deleting} onclick={() => { confirming = false; }}>Cancel</button></div>
      </div>
    {:else}<button class="clear-history" disabled={deleting} onclick={() => { confirming = true; }}>Clear history…</button>{/if}
  {/if}
  {#if !loading && !rows.length}<p class="empty">{section === 'bookmarks' ? 'Keep useful pages here with the star in the address bar.' : 'Your recently visited pages appear here.'}</p>{/if}
  <div class="places">
    {#each rows as place (place.url)}
      <div class="place">
        <button class="open-place" title={place.url} onclick={() => actions.newWebTab(place.url)}
          onauxclick={event => { if (event.button === 1) { event.preventDefault(); actions.newWebTab(place.url, true); } }}>
          <span class="place-title">{place.title || place.url}</span><small>{place.url}</small>
        </button>
        <button class="bookmark" aria-label={place.bookmarked ? `Remove bookmark: ${place.title}` : `Bookmark: ${place.title}`}
          onclick={() => void actions.browserBookmark(place.url, place.title, !place.bookmarked)}>{place.bookmarked ? '★' : '☆'}</button>
        {#if section === 'history'}<button class="delete-history" aria-label={`Delete history: ${place.title}`} title="Delete this visit" disabled={deleting}
          onclick={() => void deleteHistory(place.url)}>×</button>{/if}
      </div>
    {/each}
  </div>
  {/if}
</div>

<style>
  .browser-sidebar { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--app-text); font: 12px sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; font-weight: 600; }
  button { border: 0; border-radius: 5px; background: none; color: inherit; cursor: pointer; } button:hover { background: var(--app-hover); }
  header button { font-size: 20px; width: 27px; height: 27px; }
  input { margin: 0 12px 10px; padding: 7px 9px; min-width: 0; border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-canvas); color: inherit; font: inherit; }
  nav { display: flex; gap: 2px; margin: 0 8px 10px; } nav button { padding: 6px; font: inherit; opacity: .6; white-space: nowrap; } nav .selected { background: var(--app-hover); opacity: 1; }
  .count { margin-left: 4px; font-size: 10px; }
  .clear-history { align-self: flex-end; margin: 0 12px 6px; padding: 5px 7px; font: inherit; color: var(--app-muted-text); }
  .history-confirm { display: flex; flex-direction: column; gap: 7px; margin: 0 12px 10px; padding: 9px; border: 1px solid var(--app-border); border-radius: 5px; }
  .history-confirm button { padding: 6px; font: inherit; } button:disabled { opacity: .4; cursor: default; }
  .delete-history { width: 22px; height: 28px; font-size: 17px; opacity: .6; }
  .places { overflow: auto; min-height: 0; padding: 0 6px 12px; } .place { display: flex; align-items: center; gap: 3px; }
  .open-place { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 5px; text-align: left; padding: 9px 7px; }
  .place-title, small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .place-title { font: 12px sans-serif; } small { font: 10px sans-serif; opacity: .5; }
  .bookmark { width: 25px; height: 28px; opacity: .6; } .empty, p { margin: 10px 14px; line-height: 1.7; opacity: .65; }
</style>
