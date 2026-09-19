<script lang="ts">
  import type { AppActions } from '../view-state.svelte';
  import { resizePanelWithKeyboard, startPanelResize } from '../shell/panel-resize';
  import ExplorerView from './explorer/ExplorerView.svelte';
  import { project, type ProjectView } from './project-state.svelte';
  import SearchView from './search/SearchView.svelte';
  import SourceControlView from './source-control/SourceControlView.svelte';
  import { gitChangeGroups } from './source-control/git-change-groups';

  let { actions }: { actions: AppActions } = $props();
  let gitGroups = $derived(gitChangeGroups(project.git?.changes));
  let gitStatus = $derived(!project.git ? 'Repository status not loaded'
    : `${gitGroups.badge} change groups: ${gitGroups.staged.length} staged files, ${gitGroups.changed.length} changed files${gitGroups.conflicts.length ? `, ${gitGroups.conflicts.length} conflicts` : ''}`);
  const resize = { property: '--project-sidebar-width' as const, direction: 1 as const,
    min: 220, max: () => innerWidth * .46 };

  function select(view: ProjectView) {
    actions.selectProjectView(view);
  }
</script>

<aside class="project-sidebar" class:is-collapsed={!project.open} aria-label="Folder tools" hidden={!project.visible}>
  <nav class="activity-bar" aria-label="Folder views">
    <button type="button" class:is-active={project.open && project.activeView === 'explorer'}
      aria-label="Explorer" aria-expanded={project.open && project.activeView === 'explorer'}
      title="Explorer" onclick={() => select('explorer')}>
      <svg viewBox="0 0 24 24"><path d="M4.5 3.5h9l3 3v12h-12v-15Zm9 0v3h3M7.5 7h-5v13.5h11v-2"/></svg>
    </button>
    <button type="button" class:is-active={project.open && project.activeView === 'search'}
      aria-label="Search" aria-expanded={project.open && project.activeView === 'search'}
      title="Search" onclick={() => select('search')}>
      <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>
    </button>
    <button type="button" class="scm-activity" class:is-active={project.open && project.activeView === 'git'}
      aria-label="Source Control" aria-describedby="source-control-status"
      aria-expanded={project.open && project.activeView === 'git'}
      title={`Source Control — ${gitStatus}`} onclick={() => select('git')}>
      <svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M8 6.5c4.5 0 2.5 5.5 8 3"/></svg>
      {#if gitGroups.badge > 0}<span class="scm-activity-badge" aria-hidden="true">{gitGroups.badge}</span>{/if}
      <span id="source-control-status" class="scm-status-description">{gitStatus}</span>
    </button>
  </nav>

  <section class="side-view" aria-label={project.activeView} hidden={!project.open}>
    {#if project.activeView === 'explorer'}<ExplorerView {actions} />
    {:else if project.activeView === 'search'}<SearchView {actions} />
    {:else}<SourceControlView {actions} />{/if}
    {#if project.error}<p class="project-error">{project.error}</p>{/if}
  </section>
  <button class="panel-resize-handle panel-resize-right" type="button"
    aria-label="Resize Folder Tools" hidden={!project.open}
    onpointerdown={(event) => startPanelResize(event, resize)}
    onkeydown={(event) => resizePanelWithKeyboard(event, resize)}></button>
</aside>

<style>
  .scm-activity { position: relative; }
  .scm-activity-badge {
    position: absolute;
    top: 3px;
    right: 3px;
    display: grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    box-sizing: border-box;
    border-radius: 9px;
    background: var(--app-text);
    color: var(--app-chrome);
    box-shadow: 0 0 0 2px var(--app-chrome);
    font: 600 10px/1 sans-serif;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .scm-status-description {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
