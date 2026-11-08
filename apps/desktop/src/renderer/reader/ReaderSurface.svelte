<script lang="ts">
  import ReaderFind from './ReaderFind.svelte';
  import { view } from '../workspace/workspace-view.svelte';
  import type { AppActions } from '../ports/ui-actions';
  import { resizePanelWithKeyboard, startPanelResize } from '../shell/panel-resize';

  let { actions }: { actions: AppActions } = $props();
  let frames = $state<HTMLDivElement>();
  const resize = { property: '--toc-panel-width' as const, direction: -1 as const,
    min: 180, max: () => innerWidth * .46 };

</script>

<section class="viewer-surface" aria-label="Rendered Markdown">
  <div class="reader-body">
    <div class="preview-frames" bind:this={frames}>
      <ReaderFind {actions} {frames} />
    </div>
    <aside class="toc-panel" aria-label="Document outline" hidden={!view.tocOpen}>
      <button class="panel-resize-handle panel-resize-left" type="button"
        aria-label="Resize Outline"
        onpointerdown={(event) => startPanelResize(event, resize)}
        onkeydown={(event) => resizePanelWithKeyboard(event, resize)}></button>
      <div class="toc-panel-title">
        <strong>Outline</strong><span class="toc-count">{view.headings.length || ''}</span>
      </div>
      <nav class="toc-list">
        {#if view.headings.length === 0}
          <p class="toc-empty">This document has no headings.</p>
        {:else}
          {#each view.headings as heading (heading.id)}
            <button class="toc-item" class:is-active={heading.id === view.activeHeadingId}
              type="button" style:padding-left={`${8 + (heading.level - 1) * 13}px`}
              aria-current={heading.id === view.activeHeadingId ? 'location' : 'false'}
              onclick={() => actions.scrollToHeading(heading.id)}>{heading.text}</button>
          {/each}
        {/if}
      </nav>
    </aside>
  </div>
  <div class="render-state" hidden={!view.rendering} data-variant={view.renderVariant}>
    <div class="spinner"></div><span>Typesetting document…</span>
  </div>
  <div class="render-error" hidden={!view.renderError} data-variant={view.renderErrorVariant}>
    <strong>Could not render the document.</strong>
    <span>{view.renderError}</span>
    <button type="button" onclick={actions.retryPreview}>Retry preview</button>
    <button type="button" onclick={actions.showRenderError}>View Source</button>
  </div>
</section>

<section class="editor-surface" aria-label="Markdown source editor">
  <div class="editor-host"></div>
</section>
