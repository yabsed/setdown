<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { LanguageInputSource } from './language-text';
  import { isComposingInput } from '../editor/composition-guard';
  let { source, finish }: { source: LanguageInputSource; finish(value?: string): void } = $props();
  let input: HTMLInputElement;
  // The prompt starts with the text it was given; what the person types afterwards is theirs.
  let value = $state(untrack(() => source.value ?? '')), problem = $state(''), checking = 0, timer: ReturnType<typeof setTimeout> | undefined;
  async function check(): Promise<boolean> {
    if (!source.validate) return true;
    const turn = ++checking, found = await source.validate(value).catch(reason => String(reason));
    if (turn !== checking) return false;
    problem = found ?? ''; return !found;
  }
  function changed() { clearTimeout(timer); timer = setTimeout(() => { void check(); }, 200); }
  async function keydown(event: KeyboardEvent) {
    // Enter and Escape that end a composition belong to the input method, not to this prompt.
    if (isComposingInput(event)) return;
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); finish(); }
    else if (event.key === 'Enter') { event.preventDefault(); clearTimeout(timer); if (value.trim() && await check()) finish(value); }
  }
  onMount(() => { input.focus(); input.select(); return () => clearTimeout(timer); });
</script>

<div class="language-input" role="dialog" aria-label={source.title}>
  <label>
    <strong>{source.title}</strong>
    <input bind:this={input} bind:value oninput={changed} onkeydown={keydown} placeholder={source.placeholder} spellcheck="false" aria-invalid={!!problem} />
  </label>
  {#if problem}<p role="alert">{problem}</p>{:else if source.prompt}<p>{source.prompt}</p>{/if}
</div>

<style>
  .language-input { position: absolute; z-index: 41; top: 8px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100% - 32px)); padding: 8px 12px 10px; color: var(--app-text); background: var(--app-raised-surface); border: 1px solid var(--app-border); box-shadow: 0 5px 20px var(--app-shadow); font-size: 13px; }
  label { display: flex; flex-direction: column; gap: 6px; }
  strong { font-size: 11px; font-weight: 600; text-transform: uppercase; }
  input { padding: 6px 8px; border: 1px solid var(--app-border); color: var(--app-text); background: var(--app-surface); font: inherit; font-family: var(--monaco-monospace-font, ui-monospace, monospace); min-width: 0; }
  input:focus { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  p { margin: 6px 0 0; color: var(--app-muted-text); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
  p[role='alert'] { color: var(--app-danger-text); }
</style>
