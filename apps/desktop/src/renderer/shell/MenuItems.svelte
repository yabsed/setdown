<script lang="ts">
  import type { ApplicationMenuEntry } from '../../protocol/desktop-api';

  let {
    entries,
    nested = false,
    openSubmenuId = null,
    onexecute,
    onsubmenu,
    onleafhover,
  }: {
    entries: ApplicationMenuEntry[];
    nested?: boolean;
    openSubmenuId?: string | null;
    onexecute: (id: string) => void;
    onsubmenu: (entry: ApplicationMenuEntry, button: HTMLButtonElement) => void;
    onleafhover: () => void;
  } = $props();

  const accelerator = (value?: string) => value
    ?.replace(/CmdOrCtrl|CommandOrControl/g, /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl')
    .replace(/\+Plus$/, '++') ?? '';
</script>

<ul class={nested ? 'product-submenu' : 'product-menu-root'} role="menu">
  {#each entries as entry (entry.id)}
    {#if entry.type === 'separator'}
      <li class="product-menu-separator" role="none"></li>
    {:else}
      <li
        class:is-submenu-open={openSubmenuId === entry.id}
        class:has-submenu={!!entry.submenu?.length}
        class="product-menu-row"
        role="none"
        onpointerenter={() => entry.submenu?.length ? undefined : onleafhover()}
      >
        <button
          type="button"
          data-menu-item-id={entry.id}
          disabled={!entry.enabled}
          role={entry.type === 'radio' ? 'menuitemradio' : entry.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'}
          aria-checked={entry.type === 'radio' || entry.type === 'checkbox' ? !!entry.checked : undefined}
          onclick={(event) => entry.submenu?.length
            ? onsubmenu(entry, event.currentTarget)
            : onexecute(entry.id)}
          onpointerenter={(event) => entry.submenu?.length
            ? onsubmenu(entry, event.currentTarget)
            : undefined}
        >
          <span class="product-menu-marker">{entry.type === 'radio' && entry.checked ? '•' : entry.type === 'checkbox' && entry.checked ? '✓' : ''}</span>
          <span class="product-menu-label">{entry.label}</span>
          <span class="product-menu-accelerator">{accelerator(entry.accelerator)}</span>
          <span class="product-menu-arrow">{entry.submenu?.length ? '›' : ''}</span>
        </button>
      </li>
    {/if}
  {/each}
</ul>
