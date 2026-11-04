<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { BrowserFindAction, BrowserFindContext, BrowserFindOverlayApi } from '../../protocol/browser-find';
  import { applyShellTheme } from '../theme';

  let { api }: { api: BrowserFindOverlayApi } = $props();
  let context = $state<BrowserFindContext>(), query = $state('');
  let input: HTMLInputElement, composing = false;
  const label = $derived(context?.scope === 'markdown' ? 'Find in rendered document' : 'Find in web page');
  const current = $derived(context?.query === query);
  async function show(value: BrowserFindContext) {
    const focus = context?.focus !== value.focus;
    if (context?.theme !== value.theme) applyShellTheme(value.theme);
    // Counts can arrive after the next keystroke. Only an explicit open may
    // replace the local draft/caret or interrupt ownership of the input.
    if (focus) { query = value.query; composing = false; }
    context = value;
    if (focus) { await tick(); input?.focus({ preventScroll: true }); input?.select(); }
  }
  function action(command: BrowserFindAction['command']) {
    if (context) api.action({ token: context.token, id: context.id, query, command });
  }
  onMount(() => {
    let mounted = true, received = false;
    const off = api.onShow(value => { received = true; void show(value); });
    void api.context().then(value => { if (mounted && !received && value) void show(value); });
    return () => { mounted = false; off(); };
  });
</script>

<div class="web-find-panel" role="search" aria-label={label}>
  <input bind:this={input} bind:value={query} aria-label={label} placeholder="Find…" maxlength={context?.scope === 'markdown' ? 512 : 1000}
    autocomplete="off" spellcheck="false"
    oninput={() => { if (!composing) action('search'); }}
    oncompositionstart={() => { composing = true; }}
    oncompositionend={() => { composing = false; action('search'); }}
    onkeydown={event => {
      if (event.isComposing || composing) return;
      if (event.key === 'Enter') { event.preventDefault(); action(event.shiftKey ? 'previous' : 'next'); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); input.select(); }
    }} />
  <span class="find-count" aria-live="polite">{current ? context?.active ?? 0 : 0} / {current ? context?.matches ?? 0 : 0}</span>
  <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" onclick={() => action('previous')}>↑</button>
  <button type="button" aria-label="Next match" title="Next match (Enter)" onclick={() => action('next')}>↓</button>
  <button class="find-close" type="button" aria-label={context?.scope === 'markdown' ? 'Close search' : 'Close web search'} title="Close search (Esc)" onclick={() => action('close')}>×</button>
</div>
<svelte:window onkeydown={event => {
  if (event.key === 'Escape' && !event.isComposing && !composing) {
    event.preventDefault(); event.stopPropagation(); action('close');
  }
}} />

<style>
  :global(html), :global(body), :global(#app) { margin: 0; background: transparent !important; overflow: hidden; }
  :global(#app) { display: block; }
  .web-find-panel { box-sizing: border-box; display: flex; align-items: center; gap: 3px; height: 40px; margin: 8px;
    padding: 5px 6px 5px 10px; color: var(--app-text); border: 1px solid var(--app-border); border-radius: 3px;
    background: var(--app-raised-surface); box-shadow: 0 4px 12px var(--app-shadow); font: 13px var(--app-font-family); }
  input { flex: 1; width: 0; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; color: inherit; }
  input::placeholder { color: var(--app-subtle-text); }
  .find-count { flex: 0 0 auto; padding: 0 6px; color: var(--app-muted-text); font-size: 11px; font-variant-numeric: tabular-nums; }
  button { flex: 0 0 25px; width: 25px; height: 25px; padding: 0; color: var(--app-muted-text); border: 0; border-radius: 2px;
    background: transparent; cursor: pointer; }
  button:hover { color: var(--app-text); background: var(--app-hover); }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); }
  .find-close { font-size: 17px; }
</style>
