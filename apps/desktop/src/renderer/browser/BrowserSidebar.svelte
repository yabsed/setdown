<script lang="ts">
  import type { AppActions } from '../ports/ui-actions';
  import type { BrowserPlace } from '../../protocol/browser';
  import { browser } from './browser-state.svelte';
  import BrowserDownloads from './BrowserDownloads.svelte';
  import BrowserExtensions from './BrowserExtensions.svelte';
  import BrowserAppearance from './BrowserAppearance.svelte';
  let { actions }: { actions: AppActions } = $props();
  let query = $state(''), section = $state<'bookmarks' | 'history' | 'downloads' | 'extensions' | 'appearance'>('bookmarks');
  let rows = $state<BrowserPlace[]>([]), error = $state(''), loading = $state(false), confirming = $state(false), deleting = $state(false);
  const activeDownloads = $derived(browser.downloads.filter(item => item.state === 'progressing').length);
  $effect(() => {
    const text = query, scope = section; void browser.revision;
    if (scope === 'downloads' || scope === 'extensions' || scope === 'appearance') return;
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
  <nav aria-label="Browser library">
    <button class:selected={section === 'bookmarks'} aria-pressed={section === 'bookmarks'} onclick={() => select('bookmarks')}>Bookmarks</button>
    <button class:selected={section === 'history'} aria-pressed={section === 'history'} onclick={() => select('history')}>History</button>
    <button class:selected={section === 'downloads'} aria-pressed={section === 'downloads'} onclick={() => select('downloads')}>Downloads{#if activeDownloads}<span class="count">{activeDownloads}</span>{/if}</button>
    <button class:selected={section === 'extensions'} aria-pressed={section === 'extensions'} onclick={() => select('extensions')}>Extensions</button>
    <button class:selected={section === 'appearance'} aria-pressed={section === 'appearance'} onclick={() => select('appearance')}>Appearance</button>
  </nav>
  {#if section !== 'extensions' && section !== 'appearance'}<input aria-label={section === 'downloads' ? 'Search downloads' : 'Search bookmarks and history'} placeholder={`Search ${section}`} bind:value={query} />{/if}
  {#if section === 'appearance'}<BrowserAppearance {actions}/>{:else if section === 'extensions'}
    <BrowserExtensions {actions} />
  {:else if section === 'downloads'}
    <BrowserDownloads {actions} {query} />
  {:else}
  {#if error}<p role="alert">{error}</p>{/if}
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
  .browser-sidebar { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; color: var(--app-text); font: 12px var(--app-font-family); }
  header { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; font-weight: 600; }
  button { border: 0; border-radius: 5px; background: none; color: inherit; cursor: pointer; } button:hover { background: var(--app-hover); }
  header button { font-size: 20px; width: 27px; height: 27px; }
  input { margin: 0 12px 10px; padding: 7px 9px; min-width: 0; border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-canvas); color: inherit; font: inherit; }
  /* Four sections cannot share one nowrap row at sidebar widths; wrap to a
     second row instead of overflowing past the panel into the native view. */
  nav { display: flex; flex-wrap: wrap; gap: 2px; margin: 0 8px 10px; min-width: 0; }
  nav button { flex: 1 1 40%; min-width: 0; padding: 6px; font: inherit; opacity: .6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  nav .selected { background: var(--app-hover); opacity: 1; }
  .count { margin-left: 4px; font-size: 10px; }
  .clear-history { align-self: flex-end; margin: 0 12px 6px; padding: 5px 7px; font: inherit; color: var(--app-muted-text); }
  .history-confirm { display: flex; flex-direction: column; gap: 7px; margin: 0 12px 10px; padding: 9px; border: 1px solid var(--app-border); border-radius: 5px; }
  .history-confirm button { padding: 6px; font: inherit; } button:disabled { opacity: .4; cursor: default; }
  .delete-history { width: 22px; height: 28px; font-size: 17px; opacity: .6; }
  .places { overflow: auto; min-height: 0; padding: 0 6px 12px; } .place { display: flex; align-items: center; gap: 3px; }
  .open-place { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 5px; text-align: left; padding: 9px 7px; }
  .place-title, small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .place-title { font: 12px var(--app-font-family); } small { font: 10px var(--app-font-family); opacity: .5; }
  .bookmark { width: 25px; height: 28px; opacity: .6; } .empty, p { margin: 10px 14px; line-height: 1.7; opacity: .65; }
</style>
