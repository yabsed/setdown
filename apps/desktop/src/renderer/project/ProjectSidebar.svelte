<script lang="ts">
  import type { AppActions } from '../ports/ui-actions';
  import type { LanguageApi } from '../../protocol/language';
  import { resizePanelWithKeyboard, startPanelResize } from '../shell/panel-resize';
  import BrowserSidebar from '../browser/BrowserSidebar.svelte';
  import { downloadBadgeCount, downloadBadgeStatus } from '../browser/browser-state.svelte';
  import FolderPicker from './FolderPicker.svelte';
  import ExplorerView from './explorer/ExplorerView.svelte';
  import { project, type ProjectView } from './project-state.svelte';
  import SearchView from './search/SearchView.svelte';
  import SourceControlView from './source-control/SourceControlView.svelte';
  import { gitChangeGroups } from './source-control/git-change-groups';

  import TerminalSidebar from '../terminal/TerminalSidebar.svelte';
  import FolderSidebar from '../folder/FolderSidebar.svelte';

  let { actions, languageApi }: { actions: AppActions; languageApi: LanguageApi } = $props();
  let gitGroups = $derived(gitChangeGroups(project.git?.changes, project.git?.settings));
  let gitCount = $derived(project.git?.pendingChanges ?? gitGroups.badge);
  let gitStatus = $derived(!project.git ? 'Repository status not loaded'
    : `${gitCount}${project.git.countIncomplete ? '+' : ''} pending changes${(project.git.roots?.length ?? 0) > 1 ? ` across ${project.git.roots!.length} repositories` : ''}`);
  let downloadCount = $derived(downloadBadgeCount());
  let downloadStatus = $derived(downloadBadgeStatus(downloadCount));
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
      <svg viewBox="0 0 24 24"><path d="M9.5 3h6l4 4v9a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM15.5 3v4h4M4.5 7.5V19a2 2 0 0 0 2 2h9"/></svg>
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
      <svg viewBox="0 0 24 24"><circle cx="6.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="7.5" r="2.5"/><path d="M6.5 8v8M17.5 10a8.5 8.5 0 0 1-8.5 8.5"/></svg>
      {#if gitCount > 0 || project.git?.countIncomplete}<span class="activity-badge scm-activity-badge" aria-hidden="true">{gitCount}{project.git?.countIncomplete ? "+" : ""}</span>{/if}
      <span id="source-control-status" class="activity-status-description">{gitStatus}</span>
    </button>
    <button type="button" class="browser-activity" class:is-active={project.open && project.activeView === 'browser'}
      aria-label="Browser" aria-describedby={downloadCount ? 'browser-download-status' : undefined}
      aria-expanded={project.open && project.activeView === 'browser'}
      title={downloadCount ? `Browser — ${downloadStatus}` : 'Browser'} onclick={() => select('browser')}>
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-3.6 3.6-3.6 14.4 0 18M12 3c3.6 3.6 3.6 14.4 0 18"/></svg>
      {#if downloadCount}<span class="activity-badge download-activity-badge" aria-hidden="true">{downloadCount > 99 ? '99+' : downloadCount}</span>
        <span id="browser-download-status" class="activity-status-description">{downloadStatus}</span>{/if}
    </button>
    <button type="button" class:is-active={project.open && project.activeView === 'language'}
      aria-label="Language Support" aria-expanded={project.open && project.activeView === 'language'} title="Language Support" onclick={() => select('language')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="14.4" y="3.4" width="6.2" height="6.2" rx="1.5" transform="rotate(45 17.5 6.5)"/></svg>
    </button>
    <button type="button" class="terminal-activity" class:is-active={project.open && project.activeView === 'terminal'}
      aria-label="Terminal" aria-expanded={project.open && project.activeView === 'terminal'} title="Terminal sessions (Ctrl+`)" onclick={() => select('terminal')}>
      <svg viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 9l3.5 3L7 15M13 15h4"/></svg>
    </button>
    <button type="button" class="files-activity" class:is-active={project.open && project.activeView === 'files'}
      aria-label="Files" aria-expanded={project.open && project.activeView === 'files'} title="File manager tabs" onclick={() => select('files')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4.1a1 1 0 0 1 .8.4l1.6 2.1H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>
    </button>
  </nav>

  <section class="side-view" aria-label={project.activeView} hidden={!project.open}>
    {#if project.visible && project.open}<FolderPicker {actions} />{/if}
    {#if project.activeView === 'explorer'}{#key project.folder?.path}<ExplorerView {actions} />{/key}
    {:else if project.activeView === 'search'}<SearchView {actions} />
    {:else if project.activeView === 'terminal'}<TerminalSidebar {actions} />
    {:else if project.activeView === 'files'}<FolderSidebar {actions} />
    {:else if project.activeView === 'browser'}<BrowserSidebar {actions} />
    {:else if project.activeView === 'language'}
      {#if project.visible && project.open}
        {#await import('../language/LanguageSupport.svelte') then module}
          <module.default api={languageApi} onclose={() => select('language')} />
        {:catch error}<p role="alert">Could not load language support: {String(error)}</p>{/await}
      {/if}
    {:else}<SourceControlView {actions} />{/if}
    {#if project.error}<p class="project-error">{project.error}</p>{/if}
  </section>
  <button class="panel-resize-handle panel-resize-right" type="button"
    aria-label="Resize Folder Tools" hidden={!project.open}
    onpointerdown={(event) => startPanelResize(event, resize)}
    onkeydown={(event) => resizePanelWithKeyboard(event, resize)}></button>
</aside>

<style>
  .terminal-activity { flex-shrink: 0; }
  .scm-activity, .browser-activity { position: relative; }
  .activity-badge {
    position: absolute;
    bottom: 3px;
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
    font: 600 10px/1 var(--app-font-family);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .activity-status-description {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
