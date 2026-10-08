<script lang="ts">
  import type { AppActions } from '../view-state.svelte';
  import type { BrowserPlace } from '../../protocol/browser';
  import { browser } from './browser-state.svelte';
  let { actions }: { actions: AppActions } = $props();
  let query = $state(''), bookmarks = $state(true), rows = $state<BrowserPlace[]>([]), error = $state(''), loading = $state(false);
  $effect(() => {
    const text = query, only = bookmarks; void browser.revision;
    let current = true; loading = true;
    const timer = setTimeout(() => void actions.browserPlaces(text, only).then(result => {
      if (current) { rows = result; error = ''; }
    }).catch(reason => { if (current) error = String(reason); }).finally(() => { if (current) loading = false; }), 100);
    return () => { current = false; clearTimeout(timer); };
  });
</script>

<div class="browser-sidebar">
  <header><span>Browser</span><button aria-label="New web tab" title="New web tab (Ctrl/Cmd+T)" onclick={() => actions.newWebTab()}>+</button></header>
  <input aria-label="Search bookmarks and history" placeholder={bookmarks ? 'Search bookmarks' : 'Search history'} bind:value={query} />
  <nav aria-label="Browser library"><button class:selected={bookmarks} onclick={() => { bookmarks = true; }}>Bookmarks</button><button class:selected={!bookmarks} onclick={() => { bookmarks = false; }}>History</button></nav>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if !loading && !rows.length}<p class="empty">{bookmarks ? 'Keep useful pages here with the star in the address bar.' : 'Your recently visited pages appear here.'}</p>{/if}
  <div class="places">
    {#each rows as place (place.url)}
      <div class="place">
        <button class="open-place" title={place.url} onclick={() => actions.newWebTab(place.url)}
          onauxclick={event => { if (event.button === 1) { event.preventDefault(); actions.newWebTab(place.url, true); } }}>
          <span class="place-title">{place.title || place.url}</span><small>{place.url}</small>
        </button>
        <button class="bookmark" aria-label={place.bookmarked ? `Remove bookmark: ${place.title}` : `Bookmark: ${place.title}`}
          onclick={() => void actions.browserBookmark(place.url, place.title, !place.bookmarked)}>{place.bookmarked ? '★' : '☆'}</button>
      </div>
    {/each}
  </div>
</div>

<style>
  .browser-sidebar { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--app-text); font: 12px sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; font-weight: 600; }
  button { border: 0; border-radius: 5px; background: none; color: inherit; cursor: pointer; } button:hover { background: var(--app-hover); }
  header button { font-size: 20px; width: 27px; height: 27px; }
  input { margin: 0 12px 10px; padding: 7px 9px; min-width: 0; border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-canvas); color: inherit; font: inherit; }
  nav { display: flex; gap: 4px; margin: 0 12px 10px; } nav button { padding: 6px 9px; font: inherit; opacity: .6; } nav .selected { background: var(--app-hover); opacity: 1; }
  .places { overflow: auto; min-height: 0; padding: 0 6px 12px; } .place { display: flex; align-items: center; gap: 3px; }
  .open-place { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 5px; text-align: left; padding: 9px 7px; }
  .place-title, small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .place-title { font: 12px sans-serif; } small { font: 10px sans-serif; opacity: .5; }
  .bookmark { width: 25px; height: 28px; opacity: .6; } .empty, p { margin: 10px 14px; line-height: 1.7; opacity: .65; }
</style>
