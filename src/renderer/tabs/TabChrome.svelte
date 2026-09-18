<script lang="ts">
  import { view, type AppActions } from '../view-state.svelte';
  let { actions }: { actions: AppActions } = $props();
</script>

<nav class="tab-strip" aria-label="열린 문서" hidden={view.tabs.length === 0}>
  <div class="tab-list" role="tablist">
    {#each view.tabs as tab (tab.id)}
      <button
        class="document-tab"
        class:is-dragging={view.draggedTabId === tab.id}
        type="button"
        role="tab"
        aria-selected={tab.active}
        title={tab.path}
        draggable="true"
        data-tab-id={tab.id}
        onclick={() => actions.activateTab(tab.id)}
        ondragstart={(event) => actions.startTabDrag(tab.id, event)}
        ondragend={actions.endTabDrag}
      >
        <span class="tab-name">{tab.name}</span>
        {#if tab.dirty}<span class="tab-dirty" aria-label="저장되지 않은 변경">•</span>{/if}
        <span
          class="tab-close"
          title="탭 닫기"
          role="button"
          tabindex="0"
          onclick={(event) => {
            event.stopPropagation();
            actions.closeTab(tab.id);
          }}
          onkeydown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            actions.closeTab(tab.id);
          }}
        >×</span>
      </button>
    {/each}
  </div>
  <div class="tab-actions">
    <button class="new-tab-button" type="button" title="새 문서 (Ctrl/Cmd+N)" aria-label="새 문서" onclick={actions.newDocument}>+</button>
    <button class="editor-action insert-table-button" type="button" title="표 삽입" aria-label="표 삽입" onclick={actions.openTable}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.75A1.75 1.75 0 0 1 5.75 3h12.5A1.75 1.75 0 0 1 20 4.75v14.5A1.75 1.75 0 0 1 18.25 21H5.75A1.75 1.75 0 0 1 4 19.25V4.75Zm1.5 3.75h4.75v-4H5.75a.25.25 0 0 0-.25.25V8.5Zm6.25 0h6.75V4.75a.25.25 0 0 0-.25-.25h-6.5v4Zm-6.25 1.5v4h4.75v-4H5.5Zm6.25 0v4h6.75v-4h-6.75ZM5.5 15.5v3.75c0 .14.11.25.25.25h4.5v-4H5.5Zm6.25 4h6.5a.25.25 0 0 0 .25-.25V15.5h-6.75v4Z"/></svg>
    </button>
    <button class="editor-action insert-link-button" type="button" title="링크 삽입 (Ctrl/Cmd+K)" aria-label="링크 삽입" onclick={actions.openLink}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 15.5 8 17a3.54 3.54 0 0 1-5-5l3-3a3.54 3.54 0 0 1 5 0 .75.75 0 0 1-1.06 1.06 2.04 2.04 0 0 0-2.88 0l-3 3a2.04 2.04 0 0 0 2.88 2.88l1.5-1.5A.75.75 0 1 1 9.5 15.5Zm5-7L16 7a3.54 3.54 0 0 1 5 5l-3 3a3.54 3.54 0 0 1-5 0 .75.75 0 0 1 1.06-1.06 2.04 2.04 0 0 0 2.88 0l3-3a2.04 2.04 0 0 0-2.88-2.88l-1.5 1.5A.75.75 0 1 1 14.5 8.5Zm1.03.97a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 0 1-1.06-1.06l5-5a.75.75 0 0 1 1.06 0Z"/></svg>
    </button>
    <button class="viewer-action toc-toggle" class:is-active={view.tocOpen} type="button"
      aria-expanded={view.tocOpen} title={view.tocOpen ? '목차 닫기' : '목차 열기'}
      aria-label={view.tocOpen ? '목차 닫기' : '목차 열기'} onclick={actions.toggleToc}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h2v2H4v-2Zm4 .25h12v1.5H8v-1.5ZM4 11h2v2H4v-2Zm4 .25h12v1.5H8v-1.5ZM4 16.5h2v2H4v-2Zm4 .25h12v1.5H8v-1.5Z"/></svg>
    </button>
    <span class="tab-action-divider" aria-hidden="true"></span>
    <button class="mode-toggle" type="button" hidden={view.surface === 'empty'}
      title={`${view.surface === 'viewer' ? '편집기로 전환' : 'Viewer로 전환'} (Ctrl/Cmd+E)`}
      aria-label={view.surface === 'viewer' ? '편집기로 전환' : 'Viewer로 전환'}
      onclick={actions.toggleSurface}>
      <svg class="mode-icon mode-icon-edit" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.862 3.487a2.25 2.25 0 0 1 3.182 3.182L8.41 18.303a2 2 0 0 1-.878.507l-3.42 1.026 1.026-3.42a2 2 0 0 1 .507-.878L16.862 3.487Zm1.06 1.06L6.705 15.765a.5.5 0 0 0-.127.22l-.538 1.792 1.792-.538a.5.5 0 0 0 .22-.127L19.104 5.608a.75.75 0 0 0-1.182-1.06Z"/></svg>
      <svg class="mode-icon mode-icon-view" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c4.75 0 8.27 3.13 9.66 6.35a1.62 1.62 0 0 1 0 1.3C20.27 15.87 16.75 19 12 19s-8.27-3.13-9.66-6.35a1.62 1.62 0 0 1 0-1.3C3.73 8.13 7.25 5 12 5Zm0 1.5c-4 0-7 2.63-8.28 5.45a.12.12 0 0 0 0 .1C5 14.87 8 17.5 12 17.5s7-2.63 8.28-5.45a.12.12 0 0 0 0-.1C19 9.13 16 6.5 12 6.5Zm0 2.25A3.25 3.25 0 1 1 12 15.25 3.25 3.25 0 0 1 12 8.75Zm0 1.5A1.75 1.75 0 1 0 12 13.75 1.75 1.75 0 0 0 12 10.25Z"/></svg>
    </button>
  </div>
</nav>
