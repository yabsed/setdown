<script lang="ts">
  import { view, type AppActions } from '../view-state.svelte';

  let { actions }: { actions: AppActions } = $props();
  let findInput: HTMLInputElement;

  $effect(() => {
    if (!view.findOpen || view.surface !== 'viewer') return;
    queueMicrotask(() => {
      findInput?.focus({ preventScroll: true });
      findInput?.select();
    });
  });

  function findKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      actions.find(view.findQuery, event.shiftKey ? 'backward' : 'forward', true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      actions.closeFind();
    }
  }
</script>

<section class="viewer-surface" aria-label="Rendered Markdown">
  <div class="reader-body">
    <div class="preview-frames">
      <div class="preview-search" role="search" hidden={!view.findOpen || view.surface !== 'viewer'}>
        <input bind:this={findInput} bind:value={view.findQuery} type="search" autocomplete="off"
          spellcheck="false" aria-label="Find in rendered document" placeholder="Find…"
          oninput={() => actions.find(view.findQuery)} onkeydown={findKey} />
        <span class="find-count" aria-live="polite">
          {view.findMatches ? `${view.findActive} / ${view.findMatches}` : '0 / 0'}
        </span>
        <button class="find-previous" type="button" aria-label="Previous match"
          onclick={() => actions.find(view.findQuery, 'backward', true)}>↑</button>
        <button class="find-next" type="button" aria-label="Next match"
          onclick={() => actions.find(view.findQuery, 'forward', true)}>↓</button>
        <button class="find-close" type="button" aria-label="Close search" onclick={actions.closeFind}>×</button>
      </div>
    </div>
    <aside class="toc-panel" aria-label="Document outline" hidden={!view.tocOpen || view.surface !== 'viewer'}>
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
    <button type="button" onclick={actions.showRenderError}>View Source</button>
  </div>
</section>

<section class="editor-surface" aria-label="Markdown source editor">
  <div class="editor-host"></div>
</section>
