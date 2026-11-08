<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { LocationSuggestionsPort } from '../../ports/desktop-port';
  import type { LocationSuggestionsContext } from '../../../protocol/desktop-api';
  import { applyShellTheme } from '../../theme';
  let { desktop }: { desktop: LocationSuggestionsPort } = $props();
  let context = $state<LocationSuggestionsContext>();
  let input = $state<HTMLInputElement>(), draft = $state(''), selected = $state(-1), composing = false;
  const show = (value: LocationSuggestionsContext) => {
    if (!value) return;
    const opening = value.token !== context?.token;
    applyShellTheme(value.theme); context = value; selected = value.selected;
    if (opening && value.panel) {
      draft = value.panel.draft;
      void tick().then(() => { if (context?.token === value.token) { input?.focus(); input?.select(); } });
    }
  };
  function edit() { if (context && !composing) desktop.locationSuggestions.panelAction({ token: context.token, type: 'edit', value: draft }); }
  function key(event: KeyboardEvent) {
    if (!context?.panel || composing || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); desktop.locationSuggestions.panelAction({ token: context.token, type: 'dismiss' }); }
    else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault(); desktop.locationSuggestions.panelAction({ token: context.token, type: 'submit', value: context.rows[selected]?.url ?? draft });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!context.rows.length) return;
      event.preventDefault(); selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + context.rows.length) % context.rows.length;
    }
  }
  onMount(() => {
    let current = true, received = false;
    const off = desktop.locationSuggestions.onShow(value => { received = true; show(value); });
    void desktop.locationSuggestions.context().then(value => { if (current && !received) show(value); });
    return () => { current = false; off(); };
  });
</script>
<svelte:window onkeydown={key} />
<div class="location-suggestions" class:panel={!!context?.panel}>
  {#if context?.panel}
    <header><strong>{context.panel.mode === 'address' ? 'Current address' : 'Page actions'}</strong>
      <button class="close" aria-label="Close address panel" onclick={() => desktop.locationSuggestions.panelAction({ token: context!.token, type: 'dismiss' })}>×</button></header>
    {#if context.panel.mode === 'address'}
      <div class="current-location"><span title={context.panel.location}>{context.panel.location || 'No address'}</span>
        <button aria-label="Copy current address" onclick={() => desktop.locationSuggestions.panelAction({ token: context!.token, type: 'copy' })}>Copy</button></div>
      <input bind:this={input} bind:value={draft} aria-label="Search or enter an address" placeholder="Search, URL, or file path" spellcheck="false" autocomplete="off"
        oninput={edit} oncompositionstart={() => { composing = true; }} oncompositionend={() => { composing = false; edit(); }} />
    {:else}
      <div role="menu" aria-label="Page actions">
        {#each context.panel.actions as action (action.id)}
          <button role="menuitem" disabled={action.disabled} onclick={() => desktop.locationSuggestions.panelAction({ token: context!.token, type: 'action', id: action.id })}>{action.label}</button>
        {/each}
      </div>
    {/if}
  {/if}
  <div role="listbox" aria-label="Bookmarks and history">
  {#each context?.rows ?? [] as item, index (item.url)}
    <button role="option" aria-selected={(context?.panel ? selected : context?.selected) === index} class:selected={(context?.panel ? selected : context?.selected) === index}
      onpointerdown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        // Commit before a native focus change can dismiss the address edit
        // and remove this row ahead of the mouse release/click event.
        event.preventDefault(); desktop.locationSuggestions.choose(context!.token, index);
      }}
      onclick={event => { if (event.detail === 0) desktop.locationSuggestions.choose(context!.token, index); }}>
      <span>{item.bookmarked ? '★' : '↗'}</span><span class="suggestion-text"><strong>{item.title}</strong><small>{item.url}</small></span>
    </button>
  {/each}
  </div>
</div>
<style>
  :global(html), :global(body), :global(#app) { margin: 0; background: transparent !important; overflow: hidden; }
  :global(#app) { display: block; }
  .location-suggestions { box-sizing: border-box; padding: 5px; border: 1px solid var(--app-border); border-radius: 0 0 8px 8px; background: var(--app-chrome); color: var(--app-text); max-height: 100vh; overflow: auto; }
  button { display: flex; align-items: center; gap: 10px; text-align: left; width: 100%; height: 46px; padding: 8px; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; font-size: 16px; }
  button:hover, .selected { background: var(--app-hover); }
  .suggestion-text { display: flex; flex-direction: column; min-width: 0; gap: 4px; }
  strong, small { font: 12px D2Coding, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { opacity: .55; font-size: 11px; }
  .panel { border-radius: 8px; padding: 12px; font: 12px var(--app-font-family); }
  header, .current-location { display:flex; align-items:center; gap:12px; }
  header { justify-content:space-between; }
  .current-location { border-bottom:1px solid var(--app-border); padding:8px 0 12px; }
  .current-location span { flex:1; min-width:0; overflow-wrap:anywhere; max-height:80px; overflow:auto; user-select:text; }
  header button, .current-location button { width:auto; height:28px; font:inherit; }
  input { width:100%; box-sizing:border-box; margin:12px 0; padding:10px; border:1px solid var(--app-accent); border-radius:5px; background:var(--app-canvas); color:var(--app-text); font:inherit; }
  button[role="menuitem"] { height:32px; font:inherit; }
  button:disabled { opacity:.4; }
</style>
