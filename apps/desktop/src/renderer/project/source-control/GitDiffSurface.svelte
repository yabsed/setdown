<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { AppActions } from '../../view-state.svelte';
  import { project } from '../project-state.svelte';
  import GitDiffEditor from './GitDiffEditor.svelte';
  import { gitDiffViewport } from './git-diff-viewport';

  let { actions }: { actions: AppActions } = $props();
  let previewHost = $state<HTMLDivElement>();
  let observer: ResizeObserver | null = null;
  let active = $derived(project.gitDiffActive && (!!project.gitDiff || project.gitDiffLoading));
  let refreshing = $derived(project.gitDiffPreviewReady && (project.gitDiffPreviewLoading
    || !!project.gitDiffTabs.find((tab) => tab.id === project.activeGitDiffId)?.previewDirty));

  function layout() {
    if (!previewHost || !active) {
      actions.layoutProjectGitDiff(null);
      return;
    }
    const rect = previewHost.getBoundingClientRect();
    actions.layoutProjectGitDiff({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }
  $effect(() => {
    const enabled = active;
    const host = previewHost;
    observer?.disconnect();
    observer = null;
    if (enabled && host) {
      // Hidden source/preview layers occupy the same live box. Warm native
      // geometry before Esc; never resurrect geometry of an inactive review.
      observer = new ResizeObserver(() => untrack(layout));
      observer.observe(host);
      untrack(layout);
    } else untrack(() => actions.layoutProjectGitDiff(null));
  });
  $effect(() => {
    const source = previewHost?.parentElement?.querySelector('.git-diff-source-layer');
    if (!source) return;
    // Observe both Monaco panes without wrapping any input/composition handlers.
    // The port samples actual Monaco state on the next frame and again on Esc.
    const changed = () => gitDiffViewport.changed();
    const events = ['scroll', 'wheel', 'keyup', 'pointerup', 'input'];
    for (const event of events) source.addEventListener(event, changed, { capture: true, passive: true });
    return () => { for (const event of events) source.removeEventListener(event, changed, true); };
  });
  onDestroy(() => {
    observer?.disconnect();
    actions.layoutProjectGitDiff(null);
  });
</script>

{#if project.gitDiffTabs.length}
  <section class="git-review" class:is-active={project.gitDiffActive}
    aria-hidden={!project.gitDiffActive} aria-label="Git diff review">
    <div class="git-review-body">
      <div class="git-diff-source-layer"
        class:is-active={project.gitDiffActive && project.gitDiffMode === 'source'
          && project.gitDiff?.originalText !== null && project.gitDiff?.modifiedText !== null}>
        <GitDiffEditor {actions} />
      </div>
      <div class="git-diff-preview-host" aria-busy={refreshing}
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
