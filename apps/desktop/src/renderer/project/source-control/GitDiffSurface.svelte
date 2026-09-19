<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AppActions } from '../../view-state.svelte';
  import { project } from '../project-state.svelte';
  import GitDiffEditor from './GitDiffEditor.svelte';

  let { actions }: { actions: AppActions } = $props();
  let previewHost = $state<HTMLDivElement>();
  let observer: ResizeObserver | null = null;
  let axis = $derived.by(() => {
    const diff = project.gitDiff;
    if (!diff) return '';
    if (diff.staged) return `${diff.originalLabel} ↔ STAGED`;
    return diff.originalLabel === 'EMPTY'
      ? 'EMPTY ↔ CURRENT DOCUMENT'
      : 'STAGED ↔ CURRENT DOCUMENT';
  });
  let note = $derived.by(() => {
    const diff = project.gitDiff;
    if (!diff) return '';
    if (diff.staged) return 'Committed version compared with the staged Index.';
    return 'The staged Index is compared with the live document tab.';
  });
  function layout() {
    if (!previewHost || !project.gitDiffActive || project.gitDiffMode !== 'rendered'
      || !project.gitDiffPreviewReady) {
      actions.layoutProjectGitDiff(null);
      return;
    }
    const rect = previewHost.getBoundingClientRect();
    actions.layoutProjectGitDiff({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }

  $effect(() => {
    const active = project.gitDiffActive && (!!project.gitDiff || project.gitDiffLoading);
    const host = previewHost;
    const rendered = project.gitDiffMode === 'rendered';
    const ready = project.gitDiffPreviewReady;
    observer?.disconnect();
    observer = null;
    if (!active) return;
    if (host && rendered && ready) {
      observer = new ResizeObserver(layout);
      observer.observe(host);
      requestAnimationFrame(layout);
    } else actions.layoutProjectGitDiff(null);
  });

  onDestroy(() => {
    observer?.disconnect();
    actions.layoutProjectGitDiff(null);
  });
</script>

{#if project.gitDiffTabs.length}
  <section class="git-review" class:is-active={project.gitDiffActive}
    aria-hidden={!project.gitDiffActive} aria-label="Git diff review">
    {#if project.gitDiffActive && project.gitDiff}
      <header class="git-review-header">
        <span class="git-review-axis">{axis}</span>
        <span class="git-review-note">{note}</span>
      </header>
    {/if}
    <div class="git-review-body">
      <div class="git-diff-source-layer"
        class:is-active={project.gitDiffActive && project.gitDiffMode === 'source'
          && project.gitDiff?.originalText !== null && project.gitDiff?.modifiedText !== null}>
        <GitDiffEditor {actions} />
      </div>
      <div class="git-diff-preview-host"
        class:is-active={project.gitDiffActive && project.gitDiffMode === 'rendered'}
        class:is-frozen={project.gitDiffFrozen}
        style:background-image={project.gitDiffSnapshot
          ? `url("${project.gitDiffSnapshot}")` : undefined} bind:this={previewHost}>
        {#if project.gitDiffActive && project.gitDiffPreviewLoading && !project.gitDiffPreviewReady}
          <div class="git-review-state">Typesetting changes…</div>
        {/if}
        {#if project.gitDiffActive && !project.gitDiffPreviewLoading
          && !project.gitDiffPreviewReady && project.gitDiff}
          <div class="git-review-state">Rendered comparison is unavailable. Press the edit button for source.</div>
        {/if}
      </div>
      {#if project.gitDiffActive && project.gitDiffLoading && !project.gitDiff}
        <div class="git-review-state">Reading versions…</div>
      {:else if project.gitDiffActive
        && (project.gitDiff?.originalText === null || project.gitDiff?.modifiedText === null)}
        <div class="git-review-state">Binary differences cannot be displayed.</div>
      {/if}
    </div>
  </section>
{/if}
