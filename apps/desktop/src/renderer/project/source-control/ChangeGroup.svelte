<script lang="ts">
  import type { GitChange } from '../../../protocol/desktop-api';
  import { project } from '../project-state.svelte';

  let {
    title,
    changes,
    primaryLabel,
    primary,
    discard,
    review,
    open,
    expanded,
    toggle,
  }: {
    title: string;
    changes: GitChange[];
    primaryLabel: string;
    primary(paths: string[]): void;
    discard?: (paths: string[]) => void;
    review(path: string): void;
    open(path: string): void;
    expanded: boolean;
    toggle(): void;
  } = $props();

  const markdown = (filePath: string) => /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(filePath);
  const base = (candidate: string) => candidate.split(/[\\/]/).at(-1) ?? candidate;
  const directory = (candidate: string) => candidate.replace(/[\\/][^\\/]+$/, '');
  let contentId = $derived(`git-change-group-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`);
</script>

{#if changes.length}
  <section class="scm-group">
    <header class="scm-heading">
      <button class="scm-heading-toggle" type="button" aria-expanded={expanded}
        aria-controls={contentId} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
        onclick={toggle}>
        <svg class:is-open={expanded} viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
        <strong>{title}</strong><span>{changes.length}</span>
      </button>
      <button type="button" title={`${primaryLabel} All`} aria-label={`${primaryLabel} All`}
        disabled={project?.gitBusy} onclick={() => primary(changes.map((change) => change.filePath))}>
        {primaryLabel === 'Stage' ? '+' : '−'}
      </button>
      {#if discard}
        <button type="button" title="Discard All Changes" aria-label="Discard All Changes"
          onclick={() => discard?.(changes.map((change) => change.filePath))}>↶</button>
      {/if}
    </header>
    {#if expanded}
    <div id={contentId} class="git-changes">
      {#each changes as change (`${title}:${change.path}`)}
        <div class="git-change" title={change.path}>
          <button class="git-change-open" type="button" onclick={() => review(change.filePath)}>
            <span>{base(change.path)}</span>
            {#if directory(change.path) !== change.path}<small>{directory(change.path)}</small>{/if}
          </button>
          <div class="git-change-actions">
            <button type="button" title={primaryLabel} aria-label={`${primaryLabel} ${change.path}`}
              onclick={() => primary([change.filePath])}>{primaryLabel === 'Stage' ? '+' : '−'}</button>
            {#if discard}<button type="button" title="Discard Changes" aria-label={`Discard ${change.path}`}
              onclick={() => discard?.([change.filePath])}>↶</button>{/if}
            {#if markdown(change.path)}<button type="button" title="Open File" aria-label={`Open ${change.path}`}
              onclick={() => open(change.filePath)}>↗</button>{/if}
          </div>
          <b class:is-conflict={change.conflict}>{change.status}</b>
        </div>
      {/each}
    </div>
    {/if}
  </section>
{/if}
