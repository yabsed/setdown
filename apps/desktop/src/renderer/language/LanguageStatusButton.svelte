<script lang="ts">
  /** The language status of the current document, at the right of its location bar. */
  let { name, label = '', tone = 'neutral', expanded, narrow = false, element = $bindable(), onclick }:
    { name: string; label?: string; tone?: 'neutral' | 'warning' | 'busy'; expanded: boolean; narrow?: boolean; element?: HTMLButtonElement; onclick(): void } = $props();
</script>

<button bind:this={element} class="support-button" class:issue={tone === 'warning'} title={`${name}${label ? ` · ${label}` : ''}`}
  aria-label={`Language status: ${name}${label ? `, ${label}` : ''}`} aria-expanded={expanded} aria-haspopup="dialog" {onclick}>
  <!-- A labelled wait (a tool being fetched, a reconnect) can last minutes: its ring turns. An ordinary start stays still. -->
  {#if tone !== 'neutral'}<span class="indicator" class:turning={tone === 'busy' && !!label} aria-hidden="true">{tone === 'warning' ? '!' : label ? '' : '◌'}</span>{/if}
  <span class="language-name">{name}</span>{#if label && !narrow}<span class="support-label"> · {label}</span>{/if}<span aria-hidden="true">⌄</span>
</button>

<style>
  .support-button { display: flex; align-items: center; gap: 5px; flex: 0 1 auto; min-width: 48px; max-width: 250px; white-space: nowrap; height: 26px; border: 0; border-radius: 5px; padding: 0 7px; background: transparent; color: var(--app-muted-text); font: 11px var(--app-font-family); cursor: pointer; }
  .language-name, .support-label { overflow: hidden; text-overflow: ellipsis; }
  .indicator { flex: none; font-weight: 600; }
  .turning { box-sizing: border-box; width: 10px; height: 10px; border: 1.5px solid color-mix(in srgb, currentColor 30%, transparent); border-top-color: currentColor; border-radius: 50%;
    animation: support-turning .9s linear infinite; }
  @keyframes support-turning { to { transform: rotate(360deg); } }
  /* Without motion the ring still says "working"; it just does not turn. */
  @media (prefers-reduced-motion: reduce) { .turning { animation: none; } }
  .issue { color: var(--app-warning-text); }
  button:hover { background: var(--app-hover); }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); }
</style>
