<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import NotebookIcon from './NotebookIcon.svelte';
  let { label, children, onopen }: { label: string; children: Snippet; onopen?(): void } = $props();
  let trigger: HTMLButtonElement, popup: HTMLDivElement, open = $state(false);
  function close(restore = true) { popup.hidePopover(); if (restore && trigger.isConnected) trigger.focus(); }
  async function toggle() {
    if (open) { close(); return; }
    onopen?.(); popup.showPopover(); await tick();
    const anchor = trigger.getBoundingClientRect(), bounds = trigger.closest('.notebook-surface')!.getBoundingClientRect(), size = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(bounds.left + 4, Math.min(anchor.right - size.width, bounds.right - size.width - 4))}px`;
    popup.style.top = `${Math.max(bounds.top + 4, Math.min(anchor.bottom + 3, bounds.bottom - size.height - 4))}px`;
    popup.querySelector<HTMLElement>('button:not(:disabled), select, input')?.focus();
  }
  function keydown(event: KeyboardEvent) {
    event.stopPropagation(); if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !(event.target instanceof HTMLSelectElement)) {
      event.preventDefault(); const items = [...popup.querySelectorAll<HTMLElement>('button:not(:disabled), select, input')];
      const index = items.indexOf(document.activeElement as HTMLElement);
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  }
</script>
<button class="notebook-menu-trigger" type="button" bind:this={trigger} aria-label={label} title={label} aria-expanded={open} onclick={toggle}><NotebookIcon name="more" /></button>
<!-- Keyboard handling is scoped to the controls in this native popover. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="notebook-menu" data-notebook-menu popover="auto" role="group" aria-label={label} bind:this={popup}
  ontoggle={event => open = event.newState === 'open'} onkeydown={keydown}
  onclick={event => { if ((event.target as Element).closest('button')) close(false); }}>
  {@render children()}
</div>
<style>
  .notebook-menu-trigger { display: inline-flex; justify-content: center; align-items: center; width: 24px; height: 24px; padding: 3px; color: inherit; background: transparent; border: 0; border-radius: 3px; cursor: pointer; }
  .notebook-menu-trigger:hover { background: var(--app-hover); }
  .notebook-menu-trigger:focus-visible { outline: 1px solid var(--app-focus-ring); }
  .notebook-menu { position: fixed; inset: auto; margin: 0; padding: 5px; min-width: 200px; max-width: min(320px, calc(100vw - 16px)); max-height: 70vh; overflow: auto; color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 5px; box-shadow: 0 4px 14px #0004; font: 13px/1.5 var(--notebook-ui-font); }
  .notebook-menu :global(button) { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 28px; padding: 4px 8px; border: 0; border-radius: 3px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .notebook-menu :global(button:hover), .notebook-menu :global(button:focus-visible) { background: var(--app-hover); outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  .notebook-menu :global(label) { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 8px; }
  .notebook-menu :global(select) { min-width: 0; max-width: 170px; font: inherit; color: inherit; background: var(--app-surface); border: 1px solid var(--app-border); padding: 3px; }
  .notebook-menu :global(hr) { margin: 4px 0; border: 0; border-top: 1px solid var(--app-border); }
</style>
