<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { LocationSuggestionsPort } from '../../ports/desktop-port';
  import type { LocationSuggestionsContext } from '../../../protocol/desktop-api';
  import { applyShellTheme } from '../../theme';
  import { stepSuggestion } from './suggestion-selection';
  let { desktop }: { desktop: LocationSuggestionsPort } = $props();
  let context = $state<LocationSuggestionsContext>();
  let input = $state<HTMLInputElement>(), draft = $state(''), selected = $state(-1), composing = false;
  // The panel's own input follows LocationBar: it shows the selected row's address, else this typed text.
  let typed = '';
  // The rows come from the shell, which learns of each edit of this field by message. `sent` counts
  // them: the rows are those of the typed text once the shell has taken in the last one and answered it.
  let sent = 0;
  const answered = (value: LocationSuggestionsContext) => !!value.panel && value.panel.edit === sent && !value.panel.pending;
  // Arrow presses made before that. They walk the rows of the typed text when those arrive.
  let held = 0;
  function select(steps: number) {
    selected = stepSuggestion(selected, context!.rows.length, steps);
    draft = selected >= 0 ? context!.rows[selected].url : typed;
  }
  const show = (value: LocationSuggestionsContext) => {
    if (!value) return;
    const opening = value.token !== context?.token;
    if (!opening && value.panel && selected >= 0) draft = typed;
    applyShellTheme(value.theme); context = value; selected = value.selected;
    if (opening) held = sent = 0;
    if (opening && value.panel) {
      draft = typed = value.panel.draft;
      void tick().then(() => { if (context?.token === value.token) { input?.focus(); input?.select(); } });
    }
    if (held && answered(value)) { const steps = held; held = 0; select(steps); }
  };
  function edit() {
    const changed = draft !== typed;
    typed = draft; selected = -1; held = 0;
    // Sent while an input method composes too, so the rows follow Hangul as they follow Latin typing.
    if (context && changed) desktop.locationSuggestions.panelAction({ token: context.token, type: 'edit', value: draft, edit: ++sent });
  }
  function key(event: KeyboardEvent) {
    if (!context?.panel || composing || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); desktop.locationSuggestions.panelAction({ token: context.token, type: 'dismiss' }); }
    else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault(); desktop.locationSuggestions.panelAction({ token: context.token, type: 'submit', value: context.rows[selected]?.url ?? draft });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (!answered(context)) { event.preventDefault(); held += step; }
      else if (context.rows.length) { event.preventDefault(); select(step); }
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
    {#if context.panel.mode === 'address'}
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
  button:hover { background: var(--app-hover); }
  /* The row the arrow keys chose is outlined: a background tint cannot be told apart in dark themes. */
  .selected { outline: 1px solid var(--app-text); outline-offset: -1px; }
  .suggestion-text { display: flex; flex-direction: column; min-width: 0; gap: 4px; }
  strong, small { font: 12px var(--app-font-family); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { opacity: .55; font-size: 11px; }
  .panel { border-radius: 8px; padding: 8px; font: 12px var(--app-font-family); }
  .panel [role="listbox"]:not(:empty) { margin-top:6px; }
  input { width:100%; height:25px; box-sizing:border-box; margin:0; padding:0 9px; border:1px solid transparent; border-radius:5px; background:var(--app-canvas); color:var(--app-text); font:12px/1.4 var(--app-font-family); outline:none; }
  input:focus { border-color:var(--app-muted-text); }
  button[role="menuitem"] { height:32px; font:inherit; }
  button:disabled { opacity:.4; }
</style>
