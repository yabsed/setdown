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

<section class="viewer-surface" aria-label="렌더링된 Markdown">
  <div class="reader-body">
    <div class="preview-frames">
      <div class="preview-search" role="search" hidden={!view.findOpen || view.surface !== 'viewer'}>
        <input bind:this={findInput} bind:value={view.findQuery} type="search" autocomplete="off"
          spellcheck="false" aria-label="렌더링된 문서에서 찾기" placeholder="찾기…"
          oninput={() => actions.find(view.findQuery)} onkeydown={findKey} />
        <span class="find-count" aria-live="polite">
          {view.findMatches ? `${view.findActive} / ${view.findMatches}` : '0 / 0'}
        </span>
        <button class="find-previous" type="button" aria-label="이전 검색 결과"
          onclick={() => actions.find(view.findQuery, 'backward', true)}>↑</button>
        <button class="find-next" type="button" aria-label="다음 검색 결과"
          onclick={() => actions.find(view.findQuery, 'forward', true)}>↓</button>
        <button class="find-close" type="button" aria-label="검색 닫기" onclick={actions.closeFind}>×</button>
      </div>
    </div>
    <aside class="toc-panel" aria-label="문서 목차" hidden={!view.tocOpen || view.surface !== 'viewer'}>
      <div class="toc-panel-title">
        <strong>목차</strong><span class="toc-count">{view.headings.length || ''}</span>
      </div>
      <nav class="toc-list">
        {#if view.headings.length === 0}
          <p class="toc-empty">이 문서에는 제목이 없습니다.</p>
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
    <div class="spinner"></div><span>문서를 조판하고 있습니다…</span>
  </div>
  <div class="render-error" hidden={!view.renderError} data-variant={view.renderErrorVariant}>
    <strong>문서를 렌더링하지 못했습니다.</strong>
    <span>{view.renderError}</span>
    <button type="button" onclick={actions.showRenderError}>원문에서 확인</button>
  </div>
</section>

<section class="editor-surface" aria-label="Markdown 원문 편집기">
  <div class="editor-host"></div>
</section>
