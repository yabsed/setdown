<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AppActions } from '../../view-state.svelte';
  import { project } from '../project-state.svelte';
  import GitDiffEditor from './GitDiffEditor.svelte';

  let { actions }: { actions: AppActions } = $props();
  let previewHost = $state<HTMLDivElement>();
  let observer: ResizeObserver | null = null;
  function layout() {
    if (!previewHost || project.gitDiffMode !== 'rendered') {
      actions.layoutProjectGitDiff(null);
      return;
    }
    const rect = previewHost.getBoundingClientRect();
    actions.layoutProjectGitDiff({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }

  $effect(() => {
    const active = !!project.gitDiff || project.gitDiffLoading;
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

{#if project.gitDiff || project.gitDiffLoading}
  <section class="git-review" aria-label="Git diff review">
    {#if project.gitDiffLoading && !project.gitDiff}
      <div class="git-review-state">Reading versions…</div>
    {:else if project.gitDiff?.originalText === null || project.gitDiff?.modifiedText === null}
      <div class="git-review-state">Binary differences cannot be displayed.</div>
    {:else if project.gitDiffMode === 'source'}
      <GitDiffEditor />
    {:else}
      <div class="git-diff-preview-host" bind:this={previewHost}>
        {#if project.gitDiffPreviewLoading}<div class="git-review-state">Typesetting changes…</div>{/if}
        {#if !project.gitDiffPreviewLoading && !project.gitDiffPreviewReady}
          <div class="git-review-state">Rendered comparison is unavailable. Press the edit button for source.</div>
        {/if}
      </div>
    {/if}
  </section>
{/if}
