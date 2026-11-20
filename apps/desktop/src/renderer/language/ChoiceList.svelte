<script lang="ts">
  import type { EnvironmentChoice } from './document-support';
  // The one form in which a person chooses what the analysis is based on, whichever language it
  // is: a Python environment, a build configuration, a TypeScript, a Go, a schema. What is in use
  // comes first with a mark; what is in effect without a choice is marked as recommended.
  let { label, choices, busy = false, choose }: { label: string; choices: EnvironmentChoice[]; busy?: boolean; choose(id: string): void } = $props();
  let query = $state('');
  const ordered = $derived([...choices.filter(choice => choice.current), ...choices.filter(choice => !choice.current)]);
  const words = $derived(query.toLocaleLowerCase().split(/\s+/).filter(Boolean));
  const shown = $derived(words.length ? ordered.filter(choice => words.every(word => `${choice.name} ${choice.detail ?? ''}`.toLocaleLowerCase().includes(word))) : ordered);
</script>

<div class="choice-list">
  {#if choices.length > 8}<input type="search" bind:value={query} placeholder="Type to narrow…" aria-label={`Narrow ${label}`} spellcheck="false" />{/if}
  <div role="radiogroup" aria-label={label} aria-busy={busy}>
    {#each shown as choice (choice.id)}
      <button type="button" role="radio" aria-checked={!!choice.current} disabled={busy || choice.unavailable} onclick={() => { if (!choice.current) choose(choice.id); }}>
        <span class="mark" aria-hidden="true">{choice.current ? '✓' : ''}</span>
        <span class="text"><strong>{choice.name}</strong>{#if choice.detail}<small>{choice.detail}</small>{/if}</span>
        {#if choice.unavailable}<em>Missing</em>{:else if choice.recommended}<em>Recommended</em>{/if}
      </button>
    {:else}<p>{query ? 'Nothing matches.' : 'Nothing to choose from was found.'}</p>{/each}
  </div>
</div>

<style>
  .choice-list { display: grid; gap: 6px; margin: 10px 0; min-width: 0; }
  input { box-sizing: border-box; width: 100%; padding: 6px 8px; color: inherit; background: var(--app-canvas); border: 1px solid var(--app-border); border-radius: 4px; font: inherit; }
  [role='radiogroup'] { display: grid; gap: 1px; max-height: 300px; overflow-y: auto; }
  button { display: grid; grid-template-columns: 14px 1fr auto; align-items: baseline; gap: 0 6px; width: 100%; padding: 6px; color: inherit; font: inherit; text-align: left; background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--app-hover); }
  button[aria-checked='true'] { border-color: var(--app-border); background: var(--app-canvas); cursor: default; }
  button:disabled { opacity: .6; cursor: default; }
  button:focus-visible, input:focus-visible { outline: 1px solid var(--app-focus-ring); }
  .text { display: grid; gap: 1px; min-width: 0; }
  strong { font-weight: 600; overflow-wrap: anywhere; }
  small, em, p { color: var(--app-muted-text); font-size: 11px; font-style: normal; overflow-wrap: anywhere; }
  p { margin: 4px 6px; }
</style>
