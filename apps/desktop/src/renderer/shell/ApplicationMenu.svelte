<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { applyShellTheme } from '../theme';
  import type { MenuOverlayContext } from '../../protocol/desktop-api';
  import type { ApplicationMenuEntry } from '../../protocol/desktop-api';
  import MenuItems from './MenuItems.svelte';

  let {
    load,
    execute,
    nativeLayer = false,
    overlay,
  }: {
    load: (menuId: string) => Promise<ApplicationMenuEntry[]>;
    execute: (itemId: string) => void;
    nativeLayer?: boolean;
    overlay: import('../../protocol/desktop-api').MarkTexApi['menuOverlay'];
  } = $props();

  const menus = ['File', 'View', 'Edit', 'Window'] as const;
  let root: HTMLElement;
  let popup: HTMLElement;
  let submenuPopups: HTMLElement[] = [];
  let openId = $state<string | null>(null);
  let entries = $state<ApplicationMenuEntry[]>([]);
  let request = 0;
  let nativeOpen = $state(false);
  let showGeneration = 0;
  let contextMode = $state(false);
  let placement = $state({ x: 0, y: 0 });
  let submenus = $state<{
    id: string;
    entries: ApplicationMenuEntry[];
    left: number;
    top: number;
  }[]>([]);

  const announce = (open: boolean) => window.dispatchEvent(
    new CustomEvent('setdown:native-overlay-visibility', { detail: open }),
  );

  function close() {
    request += 1;
    if (nativeLayer || nativeOpen) overlay.close();
    else if (openId !== null) announce(false);
    nativeOpen = false;
    openId = null;
    entries = [];
    submenus = [];
  }

  async function open(button: HTMLButtonElement) {
    const menuId = button.dataset.menuId!;
    if (openId === menuId) return close();
    if (!nativeLayer) {
      const bounds = root.getBoundingClientRect();
      if (await overlay.open(menuId, { x: bounds.left, y: bounds.top })) {
        nativeOpen = true; openId = menuId; return;
      }
    }
    if (openId === null && !nativeLayer) announce(true);
    openId = menuId;
    submenus = [];
    const ownRequest = ++request;
    const loaded = await load(menuId);
    if (ownRequest !== request || openId !== menuId) return;
    entries = loaded;
    await tick();
    const bounds = button.getBoundingClientRect();
    popup.style.left = `${Math.round(Math.min(bounds.left, Math.max(6, innerWidth - 292)))}px`;
    popup.style.top = `${Math.round(bounds.bottom + 2)}px`;
  }

  async function showSubmenu(entry: ApplicationMenuEntry, button: HTMLButtonElement, depth = 0) {
    if (!entry.enabled || !entry.submenu?.length) return;
    submenus = [...submenus.slice(0, depth), { id: entry.id, entries: entry.submenu, left: 0, top: 0 }];
    await tick();
    if (submenus[depth]?.id !== entry.id || !submenuPopups[depth]) return;
    const bounds = button.getBoundingClientRect();
    const popupBounds = submenuPopups[depth].getBoundingClientRect();
    const right = bounds.right + 2;
    submenus[depth] = {
      ...submenus[depth],
      left: Math.round(Math.max(6, right + popupBounds.width <= innerWidth - 6
        ? right : bounds.left - popupBounds.width - 2)),
      top: Math.round(Math.max(6, Math.min(bounds.top - 4, innerHeight - popupBounds.height - 6))),
    };
  }

  function choose(id: string) {
    execute(id);
    close();
  }

  function outside(event: PointerEvent) {
    const target = event.target as Node;
    if (!root.contains(target) && !popup.contains(target) && !submenuPopups.some(node => node?.contains(target))) close();
  }

  function keydown(event: KeyboardEvent) {
    if (openId === null) return;
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close(); return; }
    const current = document.activeElement as HTMLButtonElement | null;
    const list = current?.closest('[role="menu"]') ?? popup.querySelector('[role="menu"]');
    const buttons = [...(list?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!buttons.length) return;
    let index = buttons.indexOf(current!);
    if (event.key === 'ArrowDown') index = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') index = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = buttons.length - 1;
    else if (event.key === 'ArrowRight') {
      const depth = submenuPopups.findIndex(node => node?.contains(current)) + 1;
      const entry = (depth ? submenus[depth - 1].entries : entries).find(entry => entry.id === current?.dataset.menuItemId);
      if (entry?.submenu && current) void showSubmenu(entry, current, depth).then(() => submenuPopups[depth]?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
      else return;
    } else if (event.key === 'ArrowLeft' && submenus.length) {
      const depth = submenuPopups.findIndex(node => node?.contains(current));
      if (depth < 0) return;
      const id = submenus[depth].id; submenus = submenus.slice(0, depth);
      (depth ? submenuPopups[depth - 1] : popup).querySelector<HTMLButtonElement>(`[data-menu-item-id="${id}"]`)?.focus();
    } else return;
    event.preventDefault(); event.stopPropagation();
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) buttons[index]?.focus();
  }
  onMount(() => {
    if (!nativeLayer) return overlay.onClosed(() => {
      if (!nativeOpen) return;
      nativeOpen = false; openId = null; entries = []; submenus = []; request++;
    });
    const show = async (context: MenuOverlayContext) => {
      const generation = ++showGeneration;
      applyShellTheme(context.theme); placement = { x: context.x, y: context.y };
      contextMode = context.menuId.startsWith('context-menu-');
      openId = null; submenus = []; await tick();
      if (generation !== showGeneration) return;
      if (contextMode) {
        const loaded = await load(context.menuId);
        if (generation !== showGeneration) return;
        entries = loaded; openId = context.menuId; await tick();
        const bounds = popup.getBoundingClientRect();
        popup.style.left = `${Math.max(6, Math.min(context.x, innerWidth - bounds.width - 6))}px`;
        popup.style.top = `${Math.max(6, Math.min(context.y, innerHeight - bounds.height - 6))}px`;
        popup.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
        return;
      }
      const button = root.querySelector<HTMLButtonElement>(`[data-menu-id="${context.menuId}"]`);
      if (button) await open(button);
    };
    const unsubscribe = overlay.onShow(context => { void show(context); });
    void overlay.context().then(show);
    return unsubscribe;
  });
</script>

<svelte:window onpointerdown={outside} onkeydown={keydown} />

<nav bind:this={root} class="application-menu" aria-label="Application menu"
  style:display={contextMode ? 'none' : undefined}
  style:position={nativeLayer ? 'fixed' : undefined} style:left={nativeLayer ? `${placement.x}px` : undefined}
  style:top={nativeLayer ? `${placement.y}px` : undefined}>
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
  class:context-menu={contextMode}
  hidden={openId === null || nativeOpen}
  onscroll={() => submenus = []}
>
  <MenuItems
    {entries}
    openSubmenuId={submenus[0]?.id}
    onexecute={choose}
    onsubmenu={showSubmenu}
    onleafhover={() => submenus = []}
  />
</div>

{#each submenus as submenu, depth (submenu.id)}
  <div
    bind:this={submenuPopups[depth]}
    class="application-submenu-popup"
    class:context-menu={contextMode}
    style:left={`${submenu.left}px`}
    style:top={`${submenu.top}px`}
  >
    <MenuItems
      entries={submenu.entries}
      nested
      openSubmenuId={submenus[depth + 1]?.id}
      onexecute={choose}
      onsubmenu={(entry, button) => showSubmenu(entry, button, depth + 1)}
      onleafhover={() => submenus = submenus.slice(0, depth + 1)}
    />
  </div>
{/each}
