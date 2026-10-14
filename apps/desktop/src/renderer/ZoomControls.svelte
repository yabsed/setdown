<script lang="ts">
  let { label, percent, min = 50, max = 300, disabled = false, change }: {
    label: string; percent: number; min?: number; max?: number; disabled?: boolean;
    change(steps: number): void;
  } = $props();
</script>

<div class="page-zoom" role="group" aria-label={`${label} zoom`}>
  <button aria-label={`Zoom ${label.toLowerCase()} out`} title={`Zoom ${label.toLowerCase()} out`}
    disabled={disabled || percent <= min} onclick={() => change(-1)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
  </button>
  <button class="zoom-percent" aria-label={`Reset ${label.toLowerCase()} zoom`}
    title={`${label} zoom — click to reset to 100%`} {disabled} onclick={() => change(0)}>{Math.round(percent)}%</button>
  <button aria-label={`Zoom ${label.toLowerCase()} in`} title={`Zoom ${label.toLowerCase()} in`}
    disabled={disabled || percent >= max} onclick={() => change(1)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>
  </button>
</div>

<style>
  .page-zoom { display: flex; align-items: center; flex: 0 0 auto; border-left: 1px solid var(--app-border); margin-left: 3px; padding-left: 3px; }
  button { display: grid; place-items: center; min-width: 26px; height: 28px; padding: 5px; border: 0; border-radius: 7px; background: transparent; color: var(--app-muted-text); cursor: pointer; }
  button:hover { color: var(--app-text); background: var(--app-hover); }
  button:disabled { opacity: .35; cursor: default; }
  button:focus-visible { outline: 1px solid var(--app-muted-text); outline-offset: -1px; }
  svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
  .zoom-percent { min-width: 43px; padding: 0 3px; font: 11px/1 var(--app-font-family); font-variant-numeric: tabular-nums; }
</style>
