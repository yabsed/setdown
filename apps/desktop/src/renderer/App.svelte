<script lang="ts">
  import EmptyState from './shell/EmptyState.svelte';
  import InsertionDialogs from './editor/InsertionDialogs.svelte';
  import ReaderSurface from './reader/ReaderSurface.svelte';
  import GitDiffSurface from './project/source-control/GitDiffSurface.svelte';
  import ProjectSidebar from './project/ProjectSidebar.svelte';
  import TabChrome from './tabs/TabChrome.svelte';
  import TitleBar from './shell/TitleBar.svelte';
  import ClosePrompt from './shell/ClosePrompt.svelte';
  import { view, type AppActions } from './view-state.svelte';

  import { terminal } from './terminal/terminal-state.svelte';

  import type { TerminalApi } from '../protocol/terminal';
  let { actions, terminalApi }: { actions: AppActions; terminalApi: TerminalApi } = $props();
</script>

<TitleBar {actions} />
<section class="shell" data-surface="empty" data-tabs="false"
  style:--terminal-height={terminal.open ? `min(${terminal.height}px, 65vh)` : '0px'}>
  <TabChrome {actions} />
  <ProjectSidebar {actions} />
  <div class="notice" hidden={!view.notice}>
    <span>This file was changed by another application.</span>
    <div>
      <button class="notice-keep" type="button" onclick={actions.keepExternalChange}>Keep My Changes</button>
      <button class="notice-reload" type="button" onclick={actions.reloadExternalChange}>Reload</button>
    </div>
  </div>
  <EmptyState {actions} />
  <ReaderSurface {actions} />
  <GitDiffSurface {actions} />
  {#if terminal.loaded}
    {#await import('./terminal/TerminalPanel.svelte') then module}
      <module.default api={terminalApi} />
    {/await}
  {/if}
  <InsertionDialogs {actions} />
  <ClosePrompt {actions} />
</section>
