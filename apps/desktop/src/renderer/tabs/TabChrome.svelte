<script lang="ts">
  import { view, type AppActions } from '../view-state.svelte';
  import { project } from '../project/project-state.svelte';
  import { isMarkdownPath } from '../editor/markdown-editor-port';
  let { actions }: { actions: AppActions } = $props();

  let markdown = $derived(isMarkdownPath(view.tabs.find((tab) => tab.active)?.path ?? ''));
  let canRender = $derived(project.gitDiffActive
    ? !!project.gitDiff && isMarkdownPath(project.gitDiff.filePath)
      && project.gitDiff.originalText !== null && project.gitDiff.modifiedText !== null
    : markdown);
  let canInsert = $derived(project.gitDiffActive
    ? project.gitDiffMode === 'source' && !!project.gitDiff && !project.gitDiff.staged && !project.gitDiff.history
      && project.gitDiff.originalText !== null && project.gitDiff.modifiedText !== null
      && isMarkdownPath(project.gitDiff.filePath)
    : markdown && view.surface === 'editor');

  const base = (candidate: string) => candidate.split(/[\\/]/).at(-1) ?? candidate;
</script>

<nav class="tab-strip" aria-label="Open documents">
  <div class="tab-list" role="tablist">
    {#each view.tabs as tab (tab.id)}
      <button class="document-tab" class:is-dragging={view.draggedTabId === tab.id}
        type="button" role="tab" aria-selected={tab.active && !project.gitDiffActive}
        title={tab.path} draggable="true" data-tab-id={tab.id}
        onclick={() => actions.activateTab(tab.id)}
        ondragstart={(event) => actions.startTabDrag(tab.id, event)} ondragend={actions.endTabDrag}>
        <span class="tab-name">{tab.name}</span>
        {#if tab.dirty}<span class="tab-dirty" aria-label="Unsaved changes">•</span>{/if}
        <span class="tab-close" title="Close tab" role="button" tabindex="0"
          onclick={(event) => { event.stopPropagation(); actions.closeTab(tab.id); }}
          onkeydown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault(); event.stopPropagation(); actions.closeTab(tab.id);
          }}>×</span>
      </button>
    {/each}
    {#each project.gitDiffTabs as diffTab (diffTab.id)}
      <button class="document-tab git-diff-tab" type="button" role="tab"
        aria-selected={project.gitDiffActive && project.activeGitDiffId === diffTab.id}
        title={diffTab.filePath} onclick={() => actions.activateProjectGitDiff(diffTab.id)}>
        <span class="tab-name">{base(diffTab.filePath)} ({diffTab.history ? diffTab.history.head.slice(0, 8) : diffTab.staged ? 'Index' : 'Working Tree'})</span>
        <span class="tab-close" title="Close diff" role="button" tabindex="0"
          onclick={(event) => { event.stopPropagation(); actions.closeProjectGitDiff(diffTab.id); }}
          onkeydown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault(); event.stopPropagation(); actions.closeProjectGitDiff(diffTab.id);
          }}>×</span>
      </button>
    {/each}
  </div>
  <div class="tab-actions">
    <button class="new-tab-button" type="button" title="New document (Ctrl/Cmd+N)" aria-label="New document" onclick={actions.newDocument}>+</button>
    <button class="editor-action insert-table-button" class:review-editor-action={project.gitDiffActive} type="button" hidden={!canInsert}
      title="Insert table" aria-label="Insert table" onclick={actions.openTable}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.75A1.75 1.75 0 0 1 5.75 3h12.5A1.75 1.75 0 0 1 20 4.75v14.5A1.75 1.75 0 0 1 18.25 21H5.75A1.75 1.75 0 0 1 4 19.25V4.75Zm1.5 3.75h4.75v-4H5.75a.25.25 0 0 0-.25.25V8.5Zm6.25 0h6.75V4.75a.25.25 0 0 0-.25-.25h-6.5v4Zm-6.25 1.5v4h4.75v-4H5.5Zm6.25 0v4h6.75v-4h-6.75ZM5.5 15.5v3.75c0 .14.11.25.25.25h4.5v-4H5.5Zm6.25 4h6.5a.25.25 0 0 0 .25-.25V15.5h-6.75v4Z"/></svg>
    </button>
    <button class="editor-action insert-link-button" class:review-editor-action={project.gitDiffActive} type="button" hidden={!canInsert}
      title="Insert URL (Ctrl/Cmd+K)" aria-label="Insert URL" onclick={actions.openLink}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 15.5 8 17a3.54 3.54 0 0 1-5-5l3-3a3.54 3.54 0 0 1 5 0 .75.75 0 0 1-1.06 1.06 2.04 2.04 0 0 0-2.88 0l-3 3a2.04 2.04 0 0 0 2.88 2.88l1.5-1.5A.75.75 0 1 1 9.5 15.5Zm5-7L16 7a3.54 3.54 0 0 1 5 5l-3 3a3.54 3.54 0 0 1-5 0 .75.75 0 0 1 1.06-1.06 2.04 2.04 0 0 0 2.88 0l3-3a2.04 2.04 0 0 0-2.88-2.88l-1.5 1.5A.75.75 0 1 1 14.5 8.5Zm1.03.97a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 0 1-1.06-1.06l5-5a.75.75 0 0 1 1.06 0Z"/></svg>
    </button>
    <button class="viewer-action toc-toggle" class:is-active={view.tocOpen} type="button"
      hidden={project.gitDiffActive || !markdown}
      aria-expanded={view.tocOpen} title={view.tocOpen ? 'Close outline' : 'Open outline'}
      aria-label={view.tocOpen ? 'Close outline' : 'Open outline'} onclick={actions.toggleToc}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h2v2H4v-2Zm4 .25h12v1.5H8v-1.5ZM4 11h2v2H4v-2Zm4 .25h12v1.5H8v-1.5ZM4 16.5h2v2H4v-2Zm4 .25h12v1.5H8v-1.5Z"/></svg>
    </button>
    <span class="tab-action-divider" aria-hidden="true" hidden={project.gitDiffActive || !markdown}></span>
    <button class="mode-toggle" type="button"
      hidden={!canRender || (!project.gitDiffActive && view.surface === 'empty') || project.gitDiffLoading}
      title={`${project.gitDiffActive && project.gitDiff
        ? project.gitDiffMode === 'rendered' ? 'View Source Diff' : 'View Rendered Diff'
        : view.surface === 'viewer' ? 'Switch to Editor' : 'Switch to Viewer'} (Ctrl/Cmd+E)`}
      aria-label={project.gitDiffActive && project.gitDiff
        ? project.gitDiffMode === 'rendered' ? 'View Source Diff' : 'View Rendered Diff'
        : view.surface === 'viewer' ? 'Switch to Editor' : 'Switch to Viewer'} onclick={actions.toggleSurface}>
      {#if project.gitDiffActive && project.gitDiff ? project.gitDiffMode === 'rendered' : view.surface === 'viewer'}
        <svg class="mode-icon is-visible" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.862 3.487a2.25 2.25 0 0 1 3.182 3.182L8.41 18.303a2 2 0 0 1-.878.507l-3.42 1.026 1.026-3.42a2 2 0 0 1 .507-.878L16.862 3.487Zm1.06 1.06L6.705 15.765a.5.5 0 0 0-.127.22l-.538 1.792 1.792-.538a.5.5 0 0 0 .22-.127L19.104 5.608a.75.75 0 0 0-1.182-1.06Z"/></svg>
      {:else}
        <svg class="mode-icon is-visible" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c4.75 0 8.27 3.13 9.66 6.35a1.62 1.62 0 0 1 0 1.3C20.27 15.87 16.75 19 12 19s-8.27-3.13-9.66-6.35a1.62 1.62 0 0 1 0-1.3C3.73 8.13 7.25 5 12 5Zm0 1.5c-4 0-7 2.63-8.28 5.45a.12.12 0 0 0 0 .1C5 14.87 8 17.5 12 17.5s7-2.63 8.28-5.45a.12.12 0 0 0 0-.1C19 9.13 16 6.5 12 6.5Zm0 2.25A3.25 3.25 0 1 1 12 15.25 3.25 3.25 0 0 1 12 8.75Zm0 1.5A1.75 1.75 0 1 0 12 13.75 1.75 1.75 0 0 0 12 10.25Z"/></svg>
      {/if}
    </button>
  </div>
</nav>

<style>
  :global(.shell) .review-editor-action:not([hidden]) { display: grid; }
  :global(.shell) .editor-action[hidden] { display: none; }
</style>
