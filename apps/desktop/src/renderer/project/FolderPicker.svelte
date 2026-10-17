<script lang="ts">
  import { tick } from 'svelte';
  import type { AppActions } from '../ports/ui-actions';
  import NativeOverlay from '../shell/NativeOverlay.svelte';
  import { project } from './project-state.svelte';

  let { actions }: { actions: AppActions } = $props();
  let open = $state(false);
  let container: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let menu = $state<HTMLDivElement>();
  function dismiss(focus = false) { open = false; if (focus) trigger?.focus(); }
  async function toggle() {
    open = !open;
    if (!open) return;
    void actions.refreshRecentProjectFolders();
    await tick();
    if (open) (menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLButtonElement>('button'))?.focus();
  }
  function choose(path: string | null) {
    dismiss(true);
    if (path !== null && path === project.folder?.path) return;
    if (path === null) void actions.closeProjectFolder();
    else void actions.openProjectFolder(path);
  }
  function navigate(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); return; }
    if (event.key === 'Tab') { dismiss(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
</script>

<svelte:window onpointerdown={event => { if (open && !container.contains(event.target as Node)) dismiss(); }} />

<div class="folder-picker" bind:this={container}>
  <button class="folder-trigger" type="button" bind:this={trigger} aria-label="Workspace folder"
    title={project.folder?.path ?? 'No folder selected'} aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5h6l2 2h8v10H2V5Z"/></svg>
    <span>{project.folder?.name ?? 'None'}</span>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>
  </button>
  {#if open}
    <NativeOverlay />
    <div class="folder-menu" role="menu" aria-label="Choose workspace folder" tabindex="-1" bind:this={menu} onkeydown={navigate}>
      <button type="button" role="menuitemradio" aria-checked={!project.folder} onclick={() => choose(null)}>
        <span>None</span><small>Keep open files, without a folder</small>
      </button>
      <div class="menu-label" role="presentation">Recent folders</div>
      {#each project.recentFolders as folder (folder.path)}
        <button type="button" role="menuitemradio" aria-checked={project.folder?.path === folder.path}
          title={folder.path} onclick={() => choose(folder.path)}>
          <span>{folder.name}</span><small>{folder.path}</small>
        </button>
      {:else}<div class="menu-label" role="presentation">No recent folders</div>{/each}
      <button class="browse" type="button" role="menuitem" onclick={() => { dismiss(true); actions.chooseProjectFolder(); }}>Open Folder…</button>
    </div>
  {/if}
</div>

<style>
  .folder-picker { position: relative; flex: 0 0 auto; margin: 8px 8px 0; }
  .folder-trigger { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 7px 8px; border: 1px solid var(--app-border); border-radius: 5px; background: transparent; color: var(--app-text); font: inherit; font-size: 12px; cursor: pointer; }
  .folder-trigger span { flex: 1; overflow: hidden; text-overflow: ellipsis; text-align: left; white-space: nowrap; }
  svg { flex: 0 0 16px; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.4; }
  .folder-menu { position: absolute; z-index: 95; top: calc(100% + 4px); left: 0; width: 100%; min-width: 200px; max-height: min(460px, calc(100vh - 160px)); overflow: auto; padding: 4px; box-sizing: border-box; border: 1px solid var(--app-strong-border); border-radius: 5px; background: var(--app-raised-surface); box-shadow: 0 6px 18px var(--app-shadow); }
  .folder-menu button { display: block; width: 100%; padding: 7px 8px; border: 0; border-radius: 3px; background: transparent; color: var(--app-text); text-align: left; font: inherit; font-size: 12px; cursor: pointer; }
  .folder-menu button[aria-checked="true"] { background: var(--app-hover); }
  .folder-menu button:hover, .folder-trigger:hover { background: var(--app-hover); }
  .folder-menu span, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { margin-top: 3px; font-size: 10px; color: var(--app-muted-text); }
  .menu-label { padding: 8px; font-size: 10px; color: var(--app-muted-text); }
  .browse { margin-top: 4px; }
</style>
