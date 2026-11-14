<script lang="ts">
  import type { AppActions } from '../ports/ui-actions';
  import { project } from '../project/project-state.svelte';
  let { actions }: { actions: AppActions } = $props();
</script>

<section class="empty-state">
  <img class="empty-mark" src="./setdown-mark.svg" alt="Setdown" />
  <div class="wordmark">Setdown</div>
  <h1>Write plain. Read beautifully.</h1>
  <p>Read Markdown beautifully, <br> then double-click anywhere to edit it.</p>
  <div class="empty-actions" role="group" aria-label="New tab">
    <button class="empty-tile is-primary empty-new" type="button" aria-label="New Document" title="New Markdown document (Ctrl/Cmd+N)" onclick={actions.newDocument}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4"/></svg>
      <span>Document</span>
    </button>
    <button class="empty-tile" type="button" aria-label="Open Web Page" title="New web tab (Ctrl/Cmd+T)" onclick={() => actions.newWebTab()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c-3 3.5-3 14.5 0 18M12 3c3 3.5 3 14.5 0 18"/></svg>
      <span>Web Page</span>
    </button>
    <button class="empty-tile" type="button" aria-label="Open Terminal" title="New terminal" onclick={() => actions.newTerminal()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 9l3.5 3L7 15M13 15h4"/></svg>
      <span>Terminal</span>
    </button>
    <button class="empty-tile empty-files" type="button" aria-label="Browse Files" title="New folder tab (Ctrl/Cmd+Shift+E)" onclick={() => actions.newFolderTab()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2.5h8A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>
      <span>Files</span>
    </button>
  </div>
  <div class="empty-links">
    <button class="empty-open" type="button" title="Open a file (Ctrl/Cmd+O)" onclick={actions.openDocument}>Open File</button>
    <span aria-hidden="true">·</span>
    <button class="empty-folder" type="button" title="Open a project folder" onclick={actions.chooseProjectFolder}>Open Folder</button>
  </div>
  {#if project.recentFolders.length}
    <section class="recent-folders" aria-label="Recent folders">
      <div class="recent-title">Recent folders</div>
      {#each project.recentFolders as folder (folder.path)}
        <button type="button" title={folder.path} onclick={() => actions.openProjectFolder(folder.path)}>
          <span>{folder.name}</span><small>{folder.path}</small>
        </button>
      {/each}
    </section>
  {/if}
  {#if project.error && !project.visible}<p role="alert">{project.error}</p>{/if}
</section>

<style>
  .empty-tile { display: flex; flex-direction: column; align-items: center; gap: 9px; width: 116px; padding: 16px 8px 13px; border: 1px solid var(--app-border); border-radius: 10px; background: var(--app-raised-surface); color: var(--app-text); font-size: 13px; cursor: pointer; }
  .empty-tile:hover { background: var(--app-hover); }
  .empty-tile:focus-visible, .empty-links button:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .empty-tile svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .empty-tile.is-primary { border-color: transparent; background: var(--app-text); color: var(--app-surface); }
  .empty-tile.is-primary:hover { filter: brightness(.86); }
  .empty-links { display: flex; align-items: center; gap: 4px; margin-top: 12px; color: var(--app-subtle-text); font-size: 12px; }
  .empty-links button { padding: 4px 7px; border: 0; border-radius: 4px; background: transparent; color: var(--app-muted-text); cursor: pointer; }
  .empty-links button:hover { background: var(--app-hover); color: var(--app-text); }
  .recent-folders { width: min(380px, 90%); max-height: 30vh; overflow: auto; margin-top: 24px; text-align: left; }
  .recent-title { margin: 0 8px 6px; color: var(--app-muted-text); font-size: 11px; }
  .recent-folders button { display: block; width: 100%; padding: 7px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--app-text); text-align: left; font: inherit; font-size: 12px; cursor: pointer; }
  .recent-folders button:hover { background: var(--app-hover); }
  span, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { margin-top: 2px; font-size: 10px; color: var(--app-muted-text); }
</style>
