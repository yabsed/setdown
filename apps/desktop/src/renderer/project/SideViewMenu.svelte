<script lang="ts">
  import { tick } from 'svelte';

  type MenuItem = { label: string; disabled?: boolean; run(): void };

  let { items }: { items: MenuItem[] } = $props();
  let open = $state(false);
  let menu = $state<HTMLDivElement>();

  async function toggle() {
    open = !open;
    if (open) {
      await tick();
      menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  }

  function run(item: MenuItem) {
    open = false;
    item.run();
  }

  function navigate(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[target]?.focus();
  }
</script>

<svelte:window onclick={() => open = false} onkeydown={(event) => {
  if (event.key === 'Escape') open = false;
}} />

<div class="side-view-overflow">
  <button class="side-view-more" type="button" title="More Actions" aria-label="More Actions"
    aria-haspopup="menu" aria-expanded={open} onclick={(event) => {
      event.stopPropagation();
      void toggle();
    }}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/>
    </svg>
  </button>
  {#if open}
    <div class="side-view-menu" bind:this={menu} role="menu" tabindex="-1" onkeydown={navigate}>
      {#each items as item}
        <button type="button" role="menuitem" disabled={item.disabled} onclick={() => run(item)}>{item.label}</button>
      {/each}
    </div>
  {/if}
</div>
