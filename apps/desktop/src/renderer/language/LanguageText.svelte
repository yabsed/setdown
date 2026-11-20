<script lang="ts">
  import { onMount } from 'svelte';
  import type { LanguageTextSource } from './language-text';
  let { source, html, close }: { source: LanguageTextSource; html?: string; close(): void } = $props();
  let panel: HTMLDivElement;
  let copied = $state(false);
  const picture = $derived(source.image ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source.text)}` : undefined);
  async function copy() { try { await navigator.clipboard.writeText(source.text); copied = true; setTimeout(() => { copied = false; }, 1500); } catch { /* The text stays selectable. */ } }
  function keydown(event: KeyboardEvent) { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); } }
  onMount(() => { panel.focus(); });
</script>

<!-- An editor-local panel, like the language results: it cannot cover or capture native views. -->
<div class="language-text" role="dialog" aria-label={source.title} bind:this={panel} onkeydown={keydown} tabindex="-1">
  <header>
    <strong>{source.title}</strong>
    <span>
      <button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      <button type="button" aria-label="Close" onclick={close}>×</button>
    </span>
  </header>
  {#if picture}
    <div class="body"><img src={picture} alt={source.title} /></div>
  {:else if html}
    <!-- Monaco's colorizer escapes the text and adds only its own token spans. -->
    <pre class="body">{@html html}</pre>
  {:else}
    <pre class="body">{source.text}</pre>
  {/if}
</div>

<style>
  .language-text { position: absolute; z-index: 40; top: 8px; right: 16px; bottom: 8px; width: min(760px, calc(100% - 32px)); display: flex; flex-direction: column; color: var(--app-text); background: var(--app-raised-surface); border: 1px solid var(--app-border); box-shadow: 0 5px 20px var(--app-shadow); font-size: 13px; }
  .language-text:focus { outline: none; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--app-border); }
  header strong { font-size: 11px; font-weight: 600; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header span { display: flex; flex: none; gap: 4px; }
  button { color: inherit; font: inherit; background: transparent; border: 0; cursor: pointer; min-width: 28px; height: 28px; padding: 0 8px; }
  button:hover { background: var(--app-hover); }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  .body { flex: 1; min-height: 0; margin: 0; padding: 10px 12px; overflow: auto; user-select: text; }
  pre { font-family: var(--monaco-monospace-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 12px; line-height: 1.5; white-space: pre; tab-size: 4; }
  img { max-width: none; background: #fff; }
</style>
