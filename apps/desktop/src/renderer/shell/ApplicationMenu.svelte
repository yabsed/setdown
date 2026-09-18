<script lang="ts">
  import { tick } from 'svelte';
  import type { ApplicationMenuEntry } from '../../protocol/desktop-api';
  import MenuItems from './MenuItems.svelte';

  let {
    load,
    execute,
  }: {
    load: (menuId: string) => Promise<ApplicationMenuEntry[]>;
    execute: (itemId: string) => void;
  } = $props();

  const menus = ['File', 'View', 'Edit', 'Window'] as const;
  let root: HTMLElement;
  let popup: HTMLElement;
  let submenuPopup: HTMLElement;
  let openId = $state<string | null>(null);
  let entries = $state<ApplicationMenuEntry[]>([]);
  let request = 0;
  let submenu = $state<{
    id: string;
    entries: ApplicationMenuEntry[];
    left: number;
    top: number;
  } | null>(null);

  const announce = (open: boolean) => window.dispatchEvent(
    new CustomEvent('setdown:native-overlay-visibility', { detail: open }),
  );

  function close() {
    request += 1;
    if (openId !== null) announce(false);
    openId = null;
    entries = [];
    submenu = null;
  }

  async function open(button: HTMLButtonElement) {
    const menuId = button.dataset.menuId!;
    if (openId === menuId) return close();
    if (openId === null) announce(true);
    openId = menuId;
    submenu = null;
    const ownRequest = ++request;
    const loaded = await load(menuId);
    if (ownRequest !== request || openId !== menuId) return;
    entries = loaded;
    await tick();
    const bounds = button.getBoundingClientRect();
    popup.style.left = `${Math.round(Math.min(bounds.left, Math.max(6, innerWidth - 292)))}px`;
    popup.style.top = `${Math.round(bounds.bottom + 2)}px`;
  }

  async function showSubmenu(entry: ApplicationMenuEntry, button: HTMLButtonElement) {
    if (!entry.submenu?.length) return;
    submenu = { id: entry.id, entries: entry.submenu, left: 0, top: 0 };
    await tick();
    const bounds = button.getBoundingClientRect();
    const popupBounds = submenuPopup.getBoundingClientRect();
    const right = bounds.right + 2;
    submenu = {
      ...submenu,
      left: Math.round(Math.max(6, right + popupBounds.width <= innerWidth - 6
        ? right
        : bounds.left - popupBounds.width - 2)),
      top: Math.round(Math.max(6, Math.min(bounds.top - 4, innerHeight - popupBounds.height - 6))),
    };
  }

  function choose(id: string) {
    execute(id);
    close();
  }

  function outside(event: PointerEvent) {
    const target = event.target as Node;
    if (!root.contains(target) && !popup.contains(target) && !submenuPopup.contains(target)) close();
  }

  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || openId === null) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={keydown} />

<nav bind:this={root} class="application-menu" aria-label="Application menu">
  {#each menus as label}
    <button
      type="button"
      data-menu-id={`application-menu-${label.toLowerCase()}`}
      class:is-open={openId === `application-menu-${label.toLowerCase()}`}
      aria-haspopup="menu"
      aria-expanded={openId === `application-menu-${label.toLowerCase()}`}
      onclick={(event) => open(event.currentTarget)}
      onpointerover={(event) => openId && openId !== event.currentTarget.dataset.menuId
        ? open(event.currentTarget)
        : undefined}
    >{label}</button>
  {/each}
</nav>

<div
  bind:this={popup}
  class="application-menu-popup"
  hidden={openId === null}
  onscroll={() => submenu = null}
>
  <MenuItems
    {entries}
    openSubmenuId={submenu?.id}
    onexecute={choose}
    onsubmenu={showSubmenu}
    onleafhover={() => submenu = null}
  />
</div>

<div
  bind:this={submenuPopup}
  class="application-submenu-popup"
  hidden={!submenu}
  style:left={`${submenu?.left ?? 0}px`}
  style:top={`${submenu?.top ?? 0}px`}
>
  <MenuItems
    entries={submenu?.entries ?? []}
    nested
    onexecute={choose}
    onsubmenu={() => undefined}
    onleafhover={() => undefined}
  />
</div>
