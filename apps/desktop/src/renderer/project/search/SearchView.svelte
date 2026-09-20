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
</script>
<header class="side-view-title"><span>SEARCH</span></header>
{#if !project.folder}
  <div class="side-view-welcome"><p>Open a folder to search documents.</p>
    <button type="button" onclick={actions.chooseProjectFolder}>Open Folder</button></div>
{:else}
  <div class="project-search-box">
    <select aria-label="Search scope" value={searchScope.value} onchange={(event) => {
      searchScope.value = event.currentTarget.value === 'text' ? 'text' : 'markdown';
      project.expandedSearchGroups = [];
      actions.searchProject(project.searchQuery);
    }}>
      <option value="markdown">Markdown</option><option value="text">All Text Files</option>
    </select>
    <input bind:this={input} type="search" autocomplete="off" spellcheck="false"
      value={project.searchQuery} placeholder={searchScope.value === 'markdown' ? 'Search Markdown files' : 'Search text files'}
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
  select { width: 100%; margin-bottom: 6px; color: var(--app-text); background: var(--app-surface);
    border: 1px solid var(--app-border); padding: 4px; font: inherit; }
</style>
