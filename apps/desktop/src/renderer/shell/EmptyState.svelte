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
  <div class="empty-actions">
    <button class="primary-button empty-new" type="button" onclick={actions.newDocument}>New Document</button>
    <button class="secondary-button empty-open" type="button" onclick={actions.openDocument}>Open File</button>
    <button class="secondary-button empty-folder" type="button" onclick={actions.chooseProjectFolder}>Open Folder</button>
    <button class="secondary-button" type="button" onclick={() => actions.newWebTab()}>Open Web Page</button>
  </div>
  <span class="shortcut">Ctrl/Cmd+N · Ctrl/Cmd+O</span>
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
  .recent-folders { width: min(380px, 90%); max-height: 30vh; overflow: auto; margin-top: 24px; text-align: left; }
  .recent-title { margin: 0 8px 6px; color: var(--app-muted-text); font-size: 11px; }
  .recent-folders button { display: block; width: 100%; padding: 7px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--app-text); text-align: left; font: inherit; font-size: 12px; cursor: pointer; }
  .recent-folders button:hover { background: var(--app-hover); }
  span, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { margin-top: 2px; font-size: 10px; color: var(--app-muted-text); }
</style>
