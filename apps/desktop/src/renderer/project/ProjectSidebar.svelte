<script lang="ts">
  import { project, type ProjectView } from './project-state.svelte';
  import type { AppActions } from '../view-state.svelte';
  import { resizePanelWithKeyboard, startPanelResize } from '../shell/panel-resize';
  import { searchHighlightParts } from './search-highlight';

  let { actions }: { actions: AppActions } = $props();
  let searchInput = $state<HTMLInputElement>();

  const markdown = (filePath: string) => /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(filePath);
  const resize = { property: '--project-sidebar-width' as const, direction: 1 as const,
    min: 220, max: () => innerWidth * .46 };

  function select(view: ProjectView) {
    actions.selectProjectView(view);
    if (view === 'search') queueMicrotask(() => searchInput?.focus());
  }
</script>

<aside class="project-sidebar" aria-label="Folder tools" hidden={!project.open}>
  <nav class="activity-bar" aria-label="Folder views">
    <button type="button" class:is-active={project.activeView === 'explorer'}
      aria-label="Explorer" title="Explorer" onclick={() => select('explorer')}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 3.5h9l3 3v12h-12v-15Zm9 0v3h3M7.5 7h-5v13.5h11v-2"/>
      </svg>
    </button>
    <button type="button" class:is-active={project.activeView === 'search'}
      aria-label="Search" title="Search" onclick={() => select('search')}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>
      </svg>
    </button>
    <button type="button" class:is-active={project.activeView === 'git'}
      aria-label="Source Control" title="Source Control" onclick={() => select('git')}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/>
        <path d="M6 7v10M8 6.5c4.5 0 2.5 5.5 8 3"/>
      </svg>
    </button>
  </nav>

  <section class="side-view" aria-label={project.activeView}>
    <header class="side-view-title">
      <span>{project.activeView === 'explorer' ? 'EXPLORER' : project.activeView === 'search' ? 'SEARCH' : 'SOURCE CONTROL'}</span>
      {#if project.activeView === 'explorer'}
        <button type="button" title="Open Folder" aria-label="Open Folder" onclick={actions.chooseProjectFolder}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10h-17v-12Zm8.5 5v5m-2.5-2.5h5"/></svg>
        </button>
        <button type="button" title="Refresh Explorer" aria-label="Refresh Explorer"
          disabled={!project.folder} onclick={actions.refreshProjectExplorer}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7v5h-5M5 17v-5h5M18.3 12A6.5 6.5 0 0 0 7 7.6L5 10m14 4-2 2.4A6.5 6.5 0 0 1 5.7 12"/></svg>
        </button>
      {:else if project.activeView === 'git'}
        <button type="button" title="Refresh Source Control" aria-label="Refresh Source Control"
          disabled={!project.folder || project.gitLoading} onclick={actions.refreshProjectGit}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7v5h-5M5 17v-5h5M18.3 12A6.5 6.5 0 0 0 7 7.6L5 10m14 4-2 2.4A6.5 6.5 0 0 1 5.7 12"/></svg>
        </button>
      {/if}
    </header>

    {#if !project.folder}
      <div class="side-view-welcome">
        <p>Open a folder to browse Markdown documents.</p>
        <button type="button" onclick={actions.chooseProjectFolder}>Open Folder</button>
      </div>
    {:else if project.activeView === 'explorer'}
      <div class="explorer-root" title={project.folder.path}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 4 4 4-4 4"/></svg>
        <strong>{project.folder.name.toLocaleUpperCase()}</strong>
      </div>
      <div class="explorer-tree" role="tree" aria-label={project.folder.name}>
        {#each project.entries as entry (entry.path)}
          <button type="button" role="treeitem" class="explorer-row"
            class:is-muted={entry.kind === 'file'} disabled={entry.kind === 'file'}
            aria-selected="false"
            aria-expanded={entry.kind === 'directory' ? entry.expanded : undefined}
            style:padding-left={`${8 + entry.depth * 13}px`} title={entry.path}
            onclick={() => entry.kind === 'directory'
              ? actions.toggleProjectDirectory(entry.path)
              : actions.openProjectFile(entry.path)}>
            {#if entry.kind === 'directory'}
              <svg class="tree-chevron" class:is-open={entry.expanded} viewBox="0 0 16 16" aria-hidden="true"><path d="m5 4 4 4-4 4"/></svg>
              <svg class="tree-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4.5h5l1.5 2h6.5v7h-13v-9Z"/></svg>
            {:else}
              <span class="tree-chevron"></span>
              <svg class="tree-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5h6l4 4v9H3v-13Zm6 0v4h4"/></svg>
            {/if}
            <span>{entry.name}</span>
            {#if entry.loading}<span class="tree-progress">…</span>{/if}
          </button>
        {/each}
      </div>
    {:else if project.activeView === 'search'}
      <div class="project-search-box">
        <input bind:this={searchInput} type="search" autocomplete="off" spellcheck="false"
          value={project.searchQuery} placeholder="Search Markdown files" aria-label="Search in folder"
          oninput={(event) => actions.searchProject(event.currentTarget.value)} />
      </div>
      <div class="search-summary">
        {#if project.searching}Searching…{:else if project.searchQuery}{project.searchResults.length} results{/if}
      </div>
      <div class="project-results" aria-live="polite">
        {#each project.searchResults as result (`${result.path}:${result.line}`)}
          <button type="button" title={`${result.relativePath}:${result.line}`}
            onclick={() => actions.openProjectFile(result.path)}>
            <span class="result-title"><strong>{result.name}</strong><small>:{result.line}</small></span>
            <span class="result-preview">
              {#each searchHighlightParts(result.preview || ' ', project.searchQuery.trim()) as part}
                {#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}
              {/each}
            </span>
            <span class="result-path">{result.relativePath}</span>
          </button>
        {/each}
      </div>
    {:else}
      {#if project.gitLoading && !project.git}
        <p class="side-view-message">Reading repository…</p>
      {:else if !project.git?.repository}
        <p class="side-view-message">The open folder is not a Git repository.</p>
      {:else}
        <div class="git-branch">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="5" r="1.5"/><path d="M4 4.5v7M5.5 4c3 0 2 3 5 2.5"/></svg>
          <span>{project.git.branch}</span>
        </div>
        <div class="scm-heading"><strong>CHANGES</strong><span>{project.git.changes.length}</span></div>
        <div class="git-changes">
          {#each project.git.changes as change (`${change.status}:${change.path}`)}
            <button type="button" disabled={!markdown(change.path)} title={change.path}
              onclick={() => actions.openProjectFile(change.filePath)}>
              <span>{change.path}</span>
              {#if change.staged}<small>S</small>{/if}
              <b>{change.status}</b>
            </button>
          {/each}
          {#if project.git.changes.length === 0}<p class="side-view-message">No changes.</p>{/if}
        </div>
      {/if}
    {/if}

    {#if project.error}<p class="project-error">{project.error}</p>{/if}
  </section>
  <button class="panel-resize-handle panel-resize-right" type="button"
    aria-label="Resize Folder Tools"
    onpointerdown={(event) => startPanelResize(event, resize)}
    onkeydown={(event) => resizePanelWithKeyboard(event, resize)}></button>
</aside>
