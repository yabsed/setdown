<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { view, type AppActions } from '../view-state.svelte';
  import { project } from '../project/project-state.svelte';
  import { browser } from './browser-state.svelte';
  import type { BrowserPlace } from '../../protocol/browser';
  import { fileLocation } from '../../core/document/file-location';
  let { actions, groupId }: { actions: AppActions; groupId: string } = $props();
  const group = $derived(view.groups.find(g => g.id === groupId));
  const tab = $derived(view.tabs.find(t => t.id === group?.activeId));
  const review = $derived(groupId === view.focusedGroupId && project.gitDiffActive ? project.gitDiff : null);
  const web = $derived(!review && tab?.kind === 'web' ? tab.page : undefined);
  const location = $derived(review ? fileLocation(review.filePath) : tab?.kind === 'web' ? tab.path : tab ? fileLocation(tab.path) : '');
  let input = $state<HTMLInputElement>(), finder = $state<HTMLInputElement>();
  let editing = $state(false), draft = $state(''), suggestions = $state<BrowserPlace[]>([]), selected = $state(-1), bookmarked = $state(false);
  let generation = 0, composing = false, timer: ReturnType<typeof setTimeout>;
  let error = $state('');
  let selectOnClick = false;
  let activeTabId: string | undefined;
  const finding = $derived(!!web && browser.findId === tab?.id);
  $effect(() => {
    const id = tab?.id;
    if (id === activeTabId) return;
    activeTabId = id;
    // The same input serves every tab; release the outgoing tab's edit/selection.
    input?.blur();
    if (input) input.setSelectionRange(input.value.length, input.value.length);
    blur();
  });
  $effect(() => { if (!editing) draft = location === 'about:blank' ? '' : location; });
  $effect(() => {
    const url = web?.url; void browser.revision;
    bookmarked = false;
    if (url?.startsWith('http')) void actions.browserPlaces(url, 'bookmarks').then(rows => { if (web?.url === url) bookmarked = rows.some(p => p.url === url); }).catch(() => {});
  });
  const suggesting = $derived(editing && suggestions.length > 0);
  $effect(() => {
    if (suggesting) {
      window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: true }));
      return () => window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: false }));
    }
  });
  function search() {
    clearTimeout(timer); const request = ++generation;
    if (composing) return;
    timer = setTimeout(() => void actions.browserPlaces(draft).then(rows => {
      if (request === generation && editing) { suggestions = rows.slice(0, 8); selected = -1; }
    }).catch(() => { if (request === generation) suggestions = []; }), 100);
  }
  async function go(value = selected >= 0 ? suggestions[selected].url : draft) {
    editing = false; suggestions = []; generation++; error = '';
    try { await actions.navigateLocation(groupId, value); }
    catch (reason) { error = String(reason); }
  }
  function blur() { editing = false; suggestions = []; generation++; clearTimeout(timer); }
  async function focus() { if (groupId !== view.focusedGroupId) return; await tick(); input?.focus(); input?.select(); }
  onMount(() => {
    const find = async () => { if (groupId === view.focusedGroupId && web && tab) { browser.findId = tab.id; await tick(); finder?.focus(); finder?.select(); } };
    window.addEventListener('setdown:focus-location', focus);
    window.addEventListener('setdown:browser-find', find);
    return () => { clearTimeout(timer); window.removeEventListener('setdown:focus-location', focus); window.removeEventListener('setdown:browser-find', find); };
  });
</script>

<div class="location-bar" data-group-id={groupId} class:loading={web?.loading}>
  <button aria-label="Back" title="Back (Alt+Left)" disabled={!tab?.canGoBack || !!review} onclick={() => actions.navigateHistory(tab!.id, -1)}>←</button>
  <button aria-label="Forward" title="Forward (Alt+Right)" disabled={!tab?.canGoForward || !!review} onclick={() => actions.navigateHistory(tab!.id, 1)}>→</button>
  {#if web}
    <button aria-label={web.loading ? 'Stop loading' : 'Reload page'} title={web.loading ? 'Stop loading' : 'Reload page'}
      onclick={() => actions.browserCommand(tab!.id, web.loading ? 'stop' : 'reload')}>{web.loading ? '×' : '↻'}</button>
  {:else}<span class="location-kind" aria-hidden="true">{review ? '±' : '⌂'}</span>{/if}
  {#if finding}
    <input bind:this={finder} aria-label="Find in web page" placeholder="Find in page" bind:value={browser.query}
      oninput={() => actions.browserFind(tab!.id, browser.query)}
      onkeydown={event => { if (event.key === 'Enter') actions.browserFind(tab!.id, browser.query, !event.shiftKey, true); else if (event.key === 'Escape') { browser.findId = null; actions.browserFind(tab!.id, ''); } }} />
    <span class="find-count">{browser.active}/{browser.matches}</span>
    <button aria-label="Close web search" onclick={() => { browser.findId = null; actions.browserFind(tab!.id, ''); }}>×</button>
  {:else}
    <input bind:this={input} aria-label="Address or file path" placeholder="Search or enter an address" spellcheck="false" autocomplete="off"
      bind:value={draft} title={location} onfocus={() => { editing = true; input?.select(); search(); }} onblur={blur}
      onpointerdown={() => { selectOnClick = document.activeElement !== input; }}
      onmouseup={event => { if (selectOnClick) { event.preventDefault(); input?.select(); selectOnClick = false; } }}
      oninput={search} oncompositionstart={() => { composing = true; clearTimeout(timer); generation++; }} oncompositionend={() => { composing = false; search(); }}
      onkeydown={event => {
        if (event.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); void go(); }
        else if (event.key === 'Escape') { blur(); input?.blur(); if (web) actions.browserCommand(tab!.id, 'focus'); }
        else if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); selected = (selected + 1) % suggestions.length; }
        else if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); selected = (selected + suggestions.length - 1) % suggestions.length; }
      }} />
    {#if web}
      <button aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark page'} title={bookmarked ? 'Remove bookmark' : 'Bookmark page'}
        disabled={!web.url.startsWith('http')} class:bookmarked onclick={() => void actions.browserBookmark(web.url, web.title, !bookmarked)}>{bookmarked ? '★' : '☆'}</button>
      <button class="protection" class:failed={web.protection === 'error'} aria-label="uBlock Origin" title={web.protection === 'ready' ? 'uBlock Origin — site controls' : 'uBlock Origin is starting'}
        disabled={web.protection !== 'ready'} onclick={() => actions.browserCommand(tab!.id, 'protection')}>uBO</button>
    {/if}
  {/if}
  {#if web}
    <div class="page-zoom" role="group" aria-label="Website zoom">
      <button aria-label="Zoom website out" title="Zoom website out" disabled={web.zoomPercent <= 50} onclick={() => actions.browserCommand(tab!.id, 'zoom-out')}>−</button>
      <button class="zoom-percent" aria-label="Reset website zoom" title="Website zoom — click to reset to 100%" onclick={() => actions.browserCommand(tab!.id, 'zoom-reset')}>{web.zoomPercent}%</button>
      <button aria-label="Zoom website in" title="Zoom website in" disabled={web.zoomPercent >= 300} onclick={() => actions.browserCommand(tab!.id, 'zoom-in')}>+</button>
    </div>
  {/if}
  {#if editing && suggestions.length}
    <div class="location-suggestions" role="listbox" aria-label="Bookmarks and history">
      {#each suggestions as item, index (item.url)}
        <button role="option" aria-selected={selected === index} class:selected={selected === index}
          onpointerdown={event => event.preventDefault()} onclick={() => void go(item.url)}>
          <span>{item.bookmarked ? '★' : '↗'}</span><span class="suggestion-text"><strong>{item.title}</strong><small>{item.url}</small></span>
        </button>
      {/each}
    </div>
  {/if}
  {#if error || (browser.error && groupId === view.focusedGroupId)}
    <span class="location-error" role="alert">{error || browser.error}<button aria-label="Dismiss browser error" onclick={() => { error = ''; browser.error = ''; }}>×</button></span>
  {/if}
</div>

<style>
  .location-bar { position: relative; z-index: 15; display: flex; align-items: center; gap: 3px; height: 34px; padding: 3px 9px; box-sizing: border-box; background: var(--app-chrome); border-bottom: 1px solid var(--app-border); color: var(--app-text); }
  button { border: 0; border-radius: 5px; background: transparent; color: inherit; min-width: 26px; height: 26px; cursor: pointer; font-size: 16px; }
  button:hover { background: var(--app-hover); } button:disabled { opacity: .35; cursor: default; }
  input { width: 0; flex: 1; height: 25px; padding: 0 9px; border: 1px solid transparent; border-radius: 5px; background: var(--app-canvas); color: inherit; font: 12px/1.4 sans-serif; outline: none; text-overflow: ellipsis; }
  input:focus { border-color: var(--app-muted-text); } .location-kind { width: 20px; text-align: center; opacity: .5; }
  .protection { font: 600 10px/1 sans-serif; letter-spacing: -.3px; } .failed, .location-error { color: #b94f4f; }
  .bookmarked { color: var(--app-text); } .find-count { font: 11px sans-serif; }
  .loading { box-shadow: inset 0 -2px var(--app-muted-text); }
  .page-zoom { display: flex; align-items: center; flex-shrink: 0; border-left: 1px solid var(--app-border); padding-left: 3px; }
  .page-zoom button { min-width: 22px; }
  .page-zoom .zoom-percent { min-width: 41px; padding: 0 3px; font: 11px/1 sans-serif; font-variant-numeric: tabular-nums; }
  .location-suggestions { position: absolute; top: 33px; left: 9px; right: 9px; padding: 5px; border: 1px solid var(--app-border); border-radius: 0 0 8px 8px; background: var(--app-chrome); box-shadow: 0 8px 24px #0002; }
  .location-suggestions button { display: flex; align-items: center; gap: 10px; text-align: left; width: 100%; height: auto; padding: 8px; }
  .location-suggestions .selected { background: var(--app-hover); }
  .suggestion-text { display: flex; flex-direction: column; min-width: 0; gap: 4px; }
  strong, small { font: 12px sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { opacity: .55; font-size: 11px; }
  .location-error { position: absolute; top: 34px; left: 10px; right: 10px; background: var(--app-chrome); padding: 8px; font-size: 12px; }
</style>
