<script lang="ts">
  import { tick } from 'svelte';
  import { nameSelection } from '../../core/files/picker-rules';
  let { initial, label, directory, submit, cancel }: {
    initial: string; label: string; directory: boolean; submit(value: string): void; cancel(): void;
  } = $props();
  let input = $state<HTMLInputElement>();
  let value = $state('');
  let composing = false;
  let started = false;
  $effect(() => {
    if (!input || started) return;
    started = true; value = initial;
    const element = input;
    void tick().then(() => {
      if (!element.isConnected) return;
      element.focus();
      const [start, end] = directory ? [0, initial.length] : nameSelection(initial);
      element.setSelectionRange(start, end);
    });
  });
</script>

<input class="folder-name-input" bind:this={input} bind:value aria-label={label} spellcheck="false" autocomplete="off"
  onclick={event => event.stopPropagation()} ondblclick={event => event.stopPropagation()}
  oncompositionstart={() => composing = true} oncompositionend={() => composing = false}
  onkeydown={event => {
    event.stopPropagation();
    // Korean IME: Enter/Escape that end a composition must not submit or cancel.
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') { event.preventDefault(); submit(value); }
    else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  }}
  onblur={() => { if (!value.trim() || value === initial) cancel(); }} />

<style>
  .folder-name-input { width: 100%; min-width: 0; height: calc(100% - 4px); padding: 0 6px; border: 1px solid var(--app-focus-ring, var(--app-muted-text));
    border-radius: 4px; background: var(--app-canvas); color: inherit; font: inherit; outline: none; }
</style>
