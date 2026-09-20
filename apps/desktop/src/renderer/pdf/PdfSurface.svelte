<script lang="ts">
  import { onMount } from 'svelte';
  import type { DocumentSnapshot } from '../../core/document/document';
  import type { ReadingPosition, PdfReadingPosition } from '../../core/reading/reading-position';
  import type { DesktopPort } from '../ports/desktop-port';
  import { PdfRuntime, type OutlineItem } from './pdf-runtime';

  let { document, initialPosition, desktop, onposition }: { document: DocumentSnapshot;
    initialPosition?: ReadingPosition; desktop: DesktopPort; onposition(position: PdfReadingPosition): void } = $props();
  let host: HTMLDivElement;
  let runtime: PdfRuntime;
  let page = $state(1);
  let count = $state(0);
  let zoom = $state('page-width');
  let error = $state('');
  let outline = $state<OutlineItem[]>([]);
  let outlineOpen = $state(false);
  let query = $state('');
  let matches = $state('');
  let searchInput: HTMLInputElement;
  let password = $state('');
  let passwordPrompt = $state('');
  let unlock: ((value: string) => void) | undefined;

  onMount(() => {
    runtime = new PdfRuntime({ host, document, desktop,
      initial: initialPosition?.kind === 'pdf' ? initialPosition : undefined,
      changed: (position) => { zoom = String(position.zoom); onposition(position); },
      status: (current, total) => { page = current; count = total; passwordPrompt = ''; },
      outline: (items) => outline = items, matches: (current, total) => matches = `${current} / ${total}`,
      password: (update, incorrect) => { unlock = update; passwordPrompt = incorrect ? 'Incorrect password. Try again.' : 'This PDF requires a password.'; },
      error: (message) => error = message });
    void runtime.open();
    const focusFind = () => { searchInput?.focus(); searchInput?.select(); };
    window.addEventListener('setdown:pdf-find', focusFind);
    return () => { window.removeEventListener('setdown:pdf-find', focusFind); runtime.dispose(); };
  });

  function findKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); runtime.find(query, event.shiftKey, true); }
    if (event.key === 'Escape') { query = ''; runtime.find(''); searchInput.blur(); }
  }
</script>

<section class="pdf-surface" aria-label="PDF reader" data-pdf-page={page} data-pdf-pages={count}>
  <div class="pdf-toolbar">
    <button type="button" aria-label="PDF outline" aria-expanded={outlineOpen} onclick={() => outlineOpen = !outlineOpen}>☷</button>
    <button type="button" aria-label="Previous PDF page" disabled={page <= 1} onclick={() => runtime.page(page - 1)}>‹</button>
    <input type="number" aria-label="PDF page number" min="1" max={count || 1} value={page}
      onchange={(event) => runtime.page(Number(event.currentTarget.value))} />
    <span>/ {count || '…'}</span>
    <button type="button" aria-label="Next PDF page" disabled={!count || page >= count} onclick={() => runtime.page(page + 1)}>›</button>
    <select aria-label="PDF zoom" value={zoom} onchange={(event) => {
      const value = event.currentTarget.value; runtime.zoom(Number(value) || value as PdfReadingPosition['zoom']);
    }}>
      <option value="page-width">Fit width</option><option value="page-fit">Fit page</option><option value="auto">Automatic</option>
      {#each [.5, .75, 1, 1.25, 1.5, 2, 3, 4] as scale}<option value={String(scale)}>{scale * 100}%</option>{/each}
    </select>
    <button type="button" aria-label="Rotate PDF" onclick={() => runtime.rotate()}>↻</button>
    <input class="pdf-search" type="search" placeholder="Find in PDF…" aria-label="Find in PDF" bind:this={searchInput}
      bind:value={query} oninput={() => runtime.find(query)} onkeydown={findKey} />
    <span class="pdf-matches" aria-live="polite">{query ? matches : ''}</span>
    <button type="button" aria-label="Previous PDF match" disabled={!query} onclick={() => runtime.find(query, true, true)}>↑</button>
    <button type="button" aria-label="Next PDF match" disabled={!query} onclick={() => runtime.find(query, false, true)}>↓</button>
  </div>
  <div class="pdf-body">
    {#if outlineOpen}
      <nav class="pdf-outline" aria-label="PDF document outline">
        {#each outline as item}<button type="button" style:padding-left={`${12 + item.depth * 12}px`}
          disabled={!item.dest} onclick={() => runtime.destination(item.dest)}>{item.title}</button>{/each}
        {#if !outline.length}<p>No outline in this PDF.</p>{/if}
      </nav>
    {/if}
    <div class="pdf-host" bind:this={host}></div>
    {#if !count && !error && !passwordPrompt}<div class="pdf-message" role="status">Opening PDF…</div>{/if}
    {#if error}<div class="pdf-message" role="alert"><strong>Could not open this PDF.</strong><p>{error}</p></div>{/if}
    {#if passwordPrompt}
      <form class="pdf-message" onsubmit={(event) => { event.preventDefault(); unlock?.(password); password = ''; }}>
        <p>{passwordPrompt}</p><input type="password" aria-label="PDF password" bind:value={password} />
        <button type="submit">Unlock PDF</button>
      </form>
    {/if}
  </div>
</section>

<style>
  .pdf-surface { grid-column: 2; grid-row: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--app-canvas); }
  .pdf-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 6px 10px; border-bottom: 1px solid var(--app-border); font-size: 12px; background: var(--app-chrome); }
  button, input, select { color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 3px; padding: 4px 6px; font: inherit; }
  button { cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  input[type="number"] { width: 62px; }
  .pdf-search { margin-left: auto; width: 155px; }
  .pdf-matches { min-width: 36px; }
  .pdf-body { display: flex; flex: 1; min-height: 0; position: relative; }
  .pdf-host { flex: 1; min-width: 0; position: relative; background: var(--app-chrome); }
  .pdf-outline { flex: 0 0 200px; overflow: auto; border-right: 1px solid var(--app-border); }
  .pdf-outline button { display: block; width: 100%; border: 0; background: transparent; text-align: left; font-size: 12px; }
  .pdf-outline p { padding: 10px; font-size: 12px; }
  .pdf-message { position: absolute; top: 35%; left: 50%; transform: translateX(-50%); padding: 18px; max-width: 90%; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 6px; font-size: 13px; }
</style>
