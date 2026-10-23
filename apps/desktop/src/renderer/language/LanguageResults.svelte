<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { LanguageCancellation } from './language-cancellation';
  import type { LanguageResult, LanguageResultsSource } from './language-results';
  import { isComposingInput } from '../editor/composition-guard';
  import { resultGroup, recordEditorResults, editorToolsNow } from '../editor/tools/tools-runtime';
  let { source, close }: { source: LanguageResultsSource; close(): void } = $props();
  let input: HTMLInputElement;
  let query = $state(''), rows = $state<LanguageResult[]>([]), busy = $state(false), error = $state('');
  let selection = $state(0), trail = $state<{ label: string; rows: LanguageResult[] }[]>([]);
  let request: LanguageCancellation | undefined, timer: ReturnType<typeof setTimeout> | undefined, live = true;
  async function load() {
    const group = resultGroup();
    request?.cancel(); const token = request = new LanguageCancellation();
    busy = true; error = ''; trail = [];
    try { const result = await source.load(query, token); if (live && !token.isCancellationRequested) {
      rows = result.slice(0, 1000); selection = 0; recordEditorResults(source.title, 'Language services', rows, query, group, result.length > 1000);
    } }
    catch (reason) { if (live && !token.isCancellationRequested) error = String(reason); }
    finally { if (live && request === token) busy = false; }
  }
  function changed() { request?.cancel(); clearTimeout(timer); timer = setTimeout(() => { void load(); }, 150); }
  async function open(row: LanguageResult) {
    editorToolsNow()?.rememberJump();
    try { await row.open(); close(); } catch (reason) { error = String(reason); }
  }
  async function children(row: LanguageResult) {
    if (!row.children || busy) return;
    busy = true; error = '';
    try { const next = await row.children(); if (live) { trail = [...trail, { label: row.label, rows }]; rows = next; selection = 0; } }
    catch (reason) { error = String(reason); }
    finally { busy = false; }
  }
  function back() { const previous = trail.at(-1); if (previous) { rows = previous.rows; trail = trail.slice(0, -1); selection = 0; } }
  function keydown(event: KeyboardEvent) {
    if (isComposingInput(event)) return;
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); selection = Math.max(0, Math.min(rows.length - 1, selection + (event.key === 'ArrowDown' ? 1 : -1)));
      void tick().then(() => document.getElementById(`language-result-${selection}`)?.scrollIntoView({ block: 'nearest' }));
    } else if (event.key === 'Enter' && event.target === input && rows[selection]) { event.preventDefault(); void open(rows[selection]); }
  }
  onMount(() => { input.focus(); void load(); const unsubscribe = source.subscribe?.(() => { void load(); }); return () => { unsubscribe?.(); live = false; request?.cancel(); clearTimeout(timer); }; });
</script>

<!-- This is an editor-local panel; it cannot cover or capture native browser views. -->
<div class="language-results" role="dialog" aria-label={source.title} aria-busy={busy} onkeydown={keydown} tabindex="-1">
  <header><strong>{source.title}</strong><button type="button" aria-label="Close language results" onclick={close}>×</button></header>
  <input bind:this={input} bind:value={query} oninput={changed} placeholder={source.searchable ? 'Search workspace symbols…' : 'Results for the current file'}
    readonly={!source.searchable} aria-label={source.searchable ? 'Search workspace symbols' : 'Language results'} />
  {#if trail.length}<button class="back" onclick={back}>← {trail.map(item => item.label).join(' / ')}</button>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="results" aria-label="Language results list">
    {#each rows as row, index}
      <div class:selected={selection === index} id={`language-result-${index}`} class="result">
        <button class="location" onclick={() => open(row)} title={row.detail}><span>{row.label}</span><small>{row.detail}</small></button>
        {#if row.children}<button class="expand" aria-label={`Explore ${row.label}`} onclick={() => children(row)}>›</button>{/if}
      </div>
    {:else}<p>{busy ? 'Loading…' : source.empty ?? 'No results.'}</p>{/each}
  </div>
</div>

<style>
  .language-results { position: absolute; z-index: 40; top: 8px; right: 16px; width: min(480px, calc(100% - 32px)); max-height: calc(100% - 24px); display: flex; flex-direction: column; color: var(--app-text); background: var(--app-raised-surface); border: 1px solid var(--app-border); box-shadow: 0 5px 20px var(--app-shadow); font-size: 13px; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; }
  header strong { font-size: 11px; font-weight: 600; text-transform: uppercase; }
  button { color: inherit; font: inherit; background: transparent; border: 0; cursor: pointer; }
  header button, .expand { width: 28px; height: 28px; }
  button:hover { background: var(--app-hover); }
  button:focus-visible, input:focus { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  input { margin: 0 12px 8px; padding: 6px 8px; border: 1px solid var(--app-border); color: var(--app-text); background: var(--app-surface); font: inherit; min-width: 0; }
  .results { overflow: auto; max-height: 360px; }
  .result { display: flex; align-items: center; }
  .result.selected { background: var(--app-selected); }
  .location { padding: 6px 12px; min-width: 0; flex: 1; text-align: left; display: flex; flex-direction: column; }
  .location span, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  small { color: var(--app-muted-text); font-size: 11px; margin-top: 3px; }
  p { padding: 8px 12px; margin: 0; color: var(--app-muted-text); }
  .back { text-align: left; padding: 6px 12px; border-bottom: 1px solid var(--app-border); }
</style>
