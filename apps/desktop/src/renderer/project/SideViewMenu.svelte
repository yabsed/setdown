<script lang="ts">
  import { tick } from 'svelte';
  import { project } from './project-state.svelte';
  import NativeOverlay from '../shell/NativeOverlay.svelte';

  type MenuItem = { label: string; disabled?: boolean; run(): void };

  let { items, label = 'More Actions' }: { items: MenuItem[]; label?: string } = $props();
  let open = $state(false);
  let container: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let menu = $state<HTMLDivElement>();

  // Fixed positioning escapes the file list's scroll clipping while keeping
  // the menu in its owner's DOM/lifecycle (including hiding the sidebar).
  function positionMenu(node: HTMLDivElement) {
    const position = () => {
      const anchor = trigger.getBoundingClientRect();
      const { width, height } = node.getBoundingClientRect();
      const gap = 4, inset = 8;
      const below = anchor.bottom + gap;
      const top = below + height <= innerHeight - inset ? below : anchor.top - gap - height;
      node.style.left = `${Math.max(inset, Math.min(anchor.right - width, innerWidth - width - inset))}px`;
      node.style.top = `${Math.max(inset, Math.min(top, innerHeight - height - inset))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    observer.observe(node);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return { destroy() {
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    } };
  }

  function close(restoreFocus = false) {
    open = false;
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }

  async function toggle() {
    open = !open;
    if (open) {
      await tick();
      menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
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
    buttons[target]?.focus({ preventScroll: true });
  }
</script>

<svelte:window onpointerdown={(event) => {
  if (open && event.target instanceof Node && !container.contains(event.target)) close();
}} onkeydown={(event) => {
  if (!open || event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  else if (event.key === 'Tab') close();
}} />

<div class="side-view-overflow" bind:this={container}>
  <button class="side-view-more" type="button" title={label} aria-label={label}
    bind:this={trigger}
    aria-haspopup="menu" aria-expanded={open} onclick={(event) => {
      event.stopPropagation();
      void toggle();
    }}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/>
    </svg>
  </button>
  {#if open}
    {#if project.visible && project.open}<NativeOverlay />{/if}
    <div class="side-view-menu" bind:this={menu} use:positionMenu role="menu" aria-label={label} tabindex="-1" onkeydown={navigate}>
      {#each items as item}
        <button type="button" role="menuitem" disabled={item.disabled} onclick={() => run(item)}>{item.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .side-view-overflow { position: relative; display: inline-flex; flex: 0 0 24px; }
  .side-view-more {
    display: grid;
    place-items: center;
    flex: 0 0 24px;
    width: 24px;
    height: 24px;
    padding: 4px;
    color: var(--app-muted-text);
    border: 0;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
  }
  .side-view-more:hover, .side-view-more[aria-expanded="true"] { color: var(--app-text); background: var(--app-hover); }
  .side-view-more:focus-visible { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  .side-view-more svg { width: 16px; height: 16px; fill: currentColor; stroke: none; }
  .side-view-menu {
    position: fixed;
    z-index: 95;
    display: flex;
    flex-direction: column;
    width: max-content;
    min-width: 192px;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 4px;
    color: var(--app-text);
    border: 1px solid var(--app-strong-border);
    border-radius: 6px;
    background: var(--app-raised-surface);
    box-shadow: 0 6px 18px var(--app-shadow);
    font-size: 11px;
    letter-spacing: normal;
  }
  .side-view-menu button {
    display: block;
    flex: 0 0 auto;
    width: 100%;
    min-height: 28px;
    padding: 5px 10px;
    color: inherit;
    border: 0;
    border-radius: 3px;
    background: transparent;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .side-view-menu button:hover:not(:disabled), .side-view-menu button:focus-visible { background: var(--app-hover); outline: 0; }
  .side-view-menu button:disabled { color: var(--app-subtle-text); opacity: .48; cursor: default; }
</style>
