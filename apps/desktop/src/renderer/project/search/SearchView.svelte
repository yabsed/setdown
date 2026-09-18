<script lang="ts">
  import type { AppActions } from '../../view-state.svelte';
  import { project } from '../project-state.svelte';
  import { searchHighlightParts } from './search-highlight';

  let { actions }: { actions: AppActions } = $props();
  let input = $state<HTMLInputElement>();
  $effect(() => { queueMicrotask(() => input?.focus()); });
</script>

<header class="side-view-title"><span>SEARCH</span></header>
{#if !project.folder}
  <div class="side-view-welcome"><p>Open a folder to search Markdown documents.</p>
    <button type="button" onclick={actions.chooseProjectFolder}>Open Folder</button></div>
{:else}
  <div class="project-search-box">
    <input bind:this={input} type="search" autocomplete="off" spellcheck="false"
      value={project.searchQuery} placeholder="Search Markdown files" aria-label="Search in folder"
      oninput={(event) => actions.searchProject(event.currentTarget.value)} />
  </div>
  <div class="search-summary">
    {#if project.searching}Searching…{:else if project.searchQuery}{project.searchResults.length} results{/if}
  </div>
  <div class="project-results" aria-live="polite">
    {#each project.searchResults as result (`${result.path}:${result.surface}:${result.ordinal}`)}
      <button type="button" title={`${result.relativePath}:${result.line}${result.surface === 'editor' ? `:${result.column}` : ''}`}
        onclick={() => actions.openProjectSearchResult(result)}>
        <span class="result-title"><strong>{result.name}</strong><small>:{result.line}{result.surface === 'editor' ? `:${result.column}` : ''}</small></span>
        <span class="result-preview">
          {#each searchHighlightParts(result.preview || ' ', project.searchQuery.trim()) as part}
            {#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}
          {/each}
        </span>
        <span class="result-path">{result.relativePath}</span>
      </button>
    {/each}
  </div>
{/if}
