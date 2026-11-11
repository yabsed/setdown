<script lang="ts">
  import { view } from '../workspace/workspace-view.svelte';
  import type { AppActions } from '../ports/ui-actions';
  let { actions }: { actions: AppActions } = $props();
  const name = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || path;
  // One row per open file-manager tab, like terminal sessions. File choosers are transient and not listed.
  const folders = $derived(view.folderTabs.filter(tab => !tab.picker).map(tab => ({ ...tab,
    active: view.tabs.some(item => item.id === tab.id && item.active),
    visible: view.groups.some(group => group.activeId === tab.id) })));
</script>
<section class="folder-sessions" aria-label="File manager tabs">
  <header class="side-view-title">
    <span>FILES</span>
    <button aria-label="New file manager tab" title="New file manager tab (Ctrl/Cmd+Shift+E)" onclick={() => actions.newFolderTab()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
    </button>
  </header>
  {#if !folders.length}
    <p class="empty">No open file managers.</p>
    <button class="create" onclick={() => actions.newFolderTab()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      <span>Browse files</span>
    </button>
  {/if}
  <div class="sessions">
  {#each folders as tab (tab.id)}
    <div class="session" class:active={tab.active} class:visible={tab.visible}>
      <button class="select" title={tab.path} aria-pressed={tab.active} onclick={() => actions.activateTab(tab.id)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10.5h-17z"/></svg>
        <span class="name">{name(tab.path)}</span><small>{tab.path}</small>
      </button>
      <button class="close" title="Close file manager tab" aria-label={`Close file manager ${name(tab.path)}`} onclick={() => actions.closeTab(tab.id)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
    </div>
  {/each}
  </div>
</section>
<style>
  .folder-sessions { display: flex; flex: 1; flex-direction: column; min-height: 0; font-size: 11px; }
  button { border: 0; background: transparent; color: var(--app-text); font: inherit; cursor: pointer; }
  button:hover { background: var(--app-hover); }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  svg { flex-shrink: 0; width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }
  .sessions { flex: 1; min-height: 0; overflow: auto; padding: 3px 0 12px; }
  .session { display: flex; align-items: center; height: 23px; }
  .session:hover { background: var(--app-hover); }
  .session.active { background: color-mix(in srgb, var(--app-focus-ring) 14%, var(--app-hover)); }
  .select { display: flex; align-items: center; text-align: left; gap: 4px; flex: 1; min-width: 0; height: 23px; padding: 0 4px 0 14px; }
  .name, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name { flex: 0 1 auto; min-width: 0; max-width: 50%; }
  .session.visible .name { font-weight: 600; }
  small { flex: 1; min-width: 0; margin-left: 4px; color: var(--app-muted-text); font: inherit; direction: rtl; text-align: left; }
  .close { display: grid; place-items: center; flex-shrink: 0; width: 20px; height: 20px; padding: 4px; margin-right: 4px; opacity: 0; }
  .close svg { width: 12px; height: 12px; }
  .session:hover .close, .session:focus-within .close, .session.active .close { opacity: 1; }
  .empty { margin: 10px 14px 6px; color: var(--app-muted-text); line-height: 23px; }
  .create { display: flex; align-items: center; gap: 4px; flex-shrink: 0; height: 23px; padding: 0 14px; text-align: left; }
</style>
