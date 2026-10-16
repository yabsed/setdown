<script lang="ts">
  import { onMount } from 'svelte';
  import type { LocationSuggestionsPort } from '../../ports/desktop-port';
  import type { LocationSuggestionsContext } from '../../../protocol/desktop-api';
  import { applyShellTheme } from '../../theme';
  let { desktop }: { desktop: LocationSuggestionsPort } = $props();
  let context = $state<LocationSuggestionsContext>();
  const show = (value: LocationSuggestionsContext) => { if (value) { applyShellTheme(value.theme); context = value; } };
  onMount(() => {
    let current = true, received = false;
    const off = desktop.locationSuggestions.onShow(value => { received = true; show(value); });
    void desktop.locationSuggestions.context().then(value => { if (current && !received) show(value); });
    return () => { current = false; off(); };
  });
</script>
<div class="location-suggestions" role="listbox" aria-label="Bookmarks and history">
  {#each context?.rows ?? [] as item, index (item.url)}
    <button role="option" aria-selected={context?.selected === index} class:selected={context?.selected === index}
      onpointerdown={event => event.preventDefault()} onclick={() => desktop.locationSuggestions.choose(context!.token, index)}>
      <span>{item.bookmarked ? '★' : '↗'}</span><span class="suggestion-text"><strong>{item.title}</strong><small>{item.url}</small></span>
    </button>
  {/each}
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
</style>
