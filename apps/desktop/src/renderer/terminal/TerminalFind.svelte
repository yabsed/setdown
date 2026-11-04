<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { SearchAddon } from '@xterm/addon-search';
  import type { Terminal } from '@xterm/xterm';

  let { terminal }: { terminal: Terminal } = $props();
  let visible = $state(false), query = $state(''), active = $state(0), matches = $state(0);
  let input = $state<HTMLInputElement>();
  let composing = false;
  const limit = 1000;
  const search = new SearchAddon({ highlightLimit: limit });
  const decorations = { matchBorder: '#c28a00', matchOverviewRuler: '#c28a00',
    activeMatchBorder: '#e06c00', activeMatchColorOverviewRuler: '#e06c00' };
  onMount(() => {
    terminal.loadAddon(search);
    const subscription = search.onDidChangeResults(result => {
      active = result.resultIndex + 1; matches = result.resultCount;
    });
    return () => { subscription.dispose(); search.dispose(); };
  });
  function find(previous = false, next = false) {
    if (composing) return;
    const options = { incremental: !next, decorations };
    if (previous) search.findPrevious(query, options); else search.findNext(query, options);
  }
  export async function open() {
    visible = true;
    await tick(); input?.focus({ preventScroll: true }); input?.select();
    find();
  }
  function close() {
    visible = false; composing = false;
    search.clearDecorations(); terminal.clearSelection(); terminal.focus();
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="terminal-find" role="search" aria-label="Find in terminal" onkeydown={event => {
    event.stopPropagation();
    if (composing || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Enter') { event.preventDefault(); find(event.shiftKey, true); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); input?.select(); }
  }}>
    <input bind:this={input} bind:value={query} aria-label="Find in terminal" placeholder="Find…" maxlength="1000"
      autocomplete="off" spellcheck="false" oninput={() => find()}
      oncompositionstart={() => { composing = true; }} oncompositionend={() => { composing = false; find(); }} />
    <span class="terminal-find-count" aria-live="polite">{active || (matches >= limit ? '–' : 0)} / {matches}{matches >= limit ? '+' : ''}</span>
    <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" onclick={() => find(true, true)}>↑</button>
    <button type="button" aria-label="Next match" title="Next match (Enter)" onclick={() => find(false, true)}>↓</button>
    <button type="button" aria-label="Close terminal search" title="Close search (Esc)" onclick={close}>×</button>
  </div>
{/if}

<style>
  .terminal-find { position: absolute; top: 8px; right: 8px; z-index: 3; box-sizing: border-box;
    display: flex; align-items: center; gap: 3px; width: min(376px, calc(100% - 16px)); height: 40px;
    padding: 5px 6px 5px 10px; color: var(--app-text); border: 1px solid var(--app-border); border-radius: 3px;
    background: var(--app-raised-surface); box-shadow: 0 4px 12px var(--app-shadow); font: 13px var(--app-font-family); }
  input { flex: 1; width: 0; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; color: inherit; }
  input::placeholder { color: var(--app-subtle-text); }
  .terminal-find-count { flex: 0 0 auto; padding: 0 6px; font-size: 11px; color: var(--app-muted-text); font-variant-numeric: tabular-nums; }
  button { flex: 0 0 25px; width: 25px; height: 25px; padding: 0; color: var(--app-muted-text); border: 0; border-radius: 2px; background: transparent; cursor: pointer; }
  button:hover { color: var(--app-text); background: var(--app-hover); }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); }
</style>
