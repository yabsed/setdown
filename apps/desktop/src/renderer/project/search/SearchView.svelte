<script lang="ts">
  import type { AppActions } from '../../view-state.svelte';
  import { project } from '../project-state.svelte';
  import { groupSearchResults } from './search-groups';
  import { searchHighlightParts } from './search-highlight';
  import { searchScope } from './search-scope.svelte';
  let { actions }: { actions: AppActions } = $props();
  let input = $state<HTMLInputElement>();
  let groups = $derived(groupSearchResults(project.searchResults));
  $effect(() => { queueMicrotask(() => input?.focus()); });

  function selectScope(scope: 'markdown' | 'text') {
    if (scope === searchScope.value) return;
    searchScope.value = scope;
    project.expandedSearchGroups = [];
    actions.searchProject(project.searchQuery);
  }
</script>
<header class="side-view-title"><span>SEARCH</span></header>
{#if !project.folder}
  <div class="side-view-welcome"><p>Open a folder to search documents.</p>
    <button type="button" onclick={actions.chooseProjectFolder}>Open Folder</button></div>
{:else}
  <div class="project-search-box">
    <div class="search-scope" role="group" aria-label="Search scope">
      <button type="button" class:is-active={searchScope.value === 'markdown'}
        aria-pressed={searchScope.value === 'markdown'} onclick={() => selectScope('markdown')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3zM10 2.5v3h3"/><path d="m5 10 1.5-2 1.5 2 1.5-2v3.5"/></svg>
        Markdown
      </button>
      <button type="button" class:is-active={searchScope.value === 'text'}
        aria-pressed={searchScope.value === 'text'} onclick={() => selectScope('text')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3zM10 2.5v3h3M5 8h6M5 10.5h6"/></svg>
        All text
      </button>
    </div>
    <input bind:this={input} type="search" autocomplete="off" spellcheck="false"
      value={project.searchQuery} placeholder="Search files"
      aria-label="Search in folder" oninput={(event) => actions.searchProject(event.currentTarget.value)} />
  </div>
  <div class="search-summary">
    {#if project.searching}Searching…{:else if project.searchQuery}
      {project.searchResults.length} {project.searchResults.length === 1 ? 'result' : 'results'} in
      {groups.length} {groups.length === 1 ? 'file' : 'files'}
    {/if}
  </div>
  <div class="project-results" aria-live="polite">
    {#each groups as group (group.path)}
      {@const expanded = project.expandedSearchGroups.includes(group.path)}
      <section class="search-file-group">
        <button class="search-file-heading" type="button" title={group.path}
          aria-expanded={expanded} onclick={() => actions.toggleProjectSearchGroup(group.path)}>
          <svg class:expanded viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 5 5-5 5" /></svg>
          <strong>{group.name}</strong>{#if group.directory}<span>{group.directory}</span>{/if}<small>{group.results.length}</small>
        </button>
        {#if expanded}
          <div class="search-file-results">
            {#each group.results as result (`${result.path}:${result.surface}:${result.ordinal}`)}
              <button class="search-result" type="button"
                title={`${result.relativePath}:${result.line}${result.surface === 'editor' ? `:${result.column}` : ''}`}
                onclick={() => actions.openProjectSearchResult(result)}>
                <span class="result-position">{result.line}{result.surface === 'editor' ? `:${result.column}` : ''}</span>
                <span class="result-preview">
                  {#each searchHighlightParts(result.preview || ' ', project.searchQuery.trim()) as part}
                    {#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}
                  {/each}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  </div>
{/if}
<style>
  .search-scope {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin-bottom: 7px;
    border-bottom: 1px solid var(--app-border);
  }
  .search-scope button {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    height: 31px;
    padding: 0 7px;
    gap: 5px;
    overflow: hidden;
    color: var(--app-muted-text);
    border: 0;
    border-bottom: 2px solid transparent;
    outline: 0;
    background: transparent;
    font: inherit;
    font-size: 10px;
    white-space: nowrap;
    cursor: pointer;
  }
  .search-scope button:hover { color: var(--app-text); background: var(--app-hover); }
  .search-scope button:focus-visible { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  .search-scope button.is-active {
    color: var(--app-text);
    border-bottom-color: var(--app-text);
    font-weight: 600;
  }
  .search-scope svg {
    flex: 0 0 13px;
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.15;
  }
</style>
