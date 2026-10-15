<script lang="ts">
  import { onMount } from 'svelte';
  import EmptyState from './shell/EmptyState.svelte';
  import InsertionDialogs from './editor/InsertionDialogs.svelte';
  import ReaderSurface from './reader/ReaderSurface.svelte';
  import GitDiffSurface from './project/source-control/GitDiffSurface.svelte';
  import ProjectSidebar from './project/ProjectSidebar.svelte';
  import EditorGroups from './groups/EditorGroups.svelte';
  import { groupLayout } from '../core/workspace/editor-groups';
  import TitleBar from './shell/TitleBar.svelte';
  import ClosePrompt from './shell/ClosePrompt.svelte';
  import BrowserAuthDialog from './browser/BrowserAuthDialog.svelte';
  import { view, type AppActions } from './view-state.svelte';



  import type { TerminalApi } from '../protocol/terminal';
  import type { DesktopPort } from './ports/desktop-port';
  import type { ReadingPosition } from '../core/reading/reading-position';
  import { project } from './project/project-state.svelte';
  let { actions, terminalApi, desktop, mediaPosition }: { actions: AppActions; terminalApi: TerminalApi; desktop: DesktopPort;
    mediaPosition(id: string, position: ReadingPosition): void } = $props();
  onMount(() => {
    const show = () => {
      if (!project.visible || !project.open || project.activeView !== 'language') actions.selectProjectView('language');
    };
    window.addEventListener('setdown:language-support', show);
    return () => window.removeEventListener('setdown:language-support', show);
  });
  const boxes = $derived(groupLayout(view.groupTree).groups);
  const focused = $derived(boxes.find(box => box.id === view.focusedGroupId) ?? boxes[0]);
  const geometry = (box: typeof focused) => `left:${box.x}%;top:${box.y}%;width:${box.width}%;height:${box.height}%`;
</script>

<TitleBar {actions} />
<section class="shell" data-surface="empty" data-tabs="false">
  <ProjectSidebar {actions} languageApi={desktop.language} />
  <div class="editor-area" class:split={view.groups.length > 1}>
  <EditorGroups {actions} />
  <div class="group-content focused-content" style={geometry(focused)}
    data-zoom-tab={project.gitDiffActive ? `git-diff:${project.activeGitDiffId}` : view.groups.find(group => group.id === view.focusedGroupId)?.activeId}>
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
  </div>
  {#each view.mediaTabs as tab (tab.key)}
    {@const group = view.groups.find(g => g.activeId === tab.id)}
    {@const active = !!group && !(group.id === view.focusedGroupId && project.gitDiffActive)}
    {@const box = boxes.find(box => box.id === group?.id) ?? focused}
    <div class="group-content media-content" class:inactive={!active} style={geometry(box)} data-media-tab={tab.id}>
    {#if tab.document.kind === 'pdf'}
      {#await import('./pdf/PdfSurface.svelte') then module}
        <module.default tabId={tab.id} document={tab.document} initialPosition={tab.position} {active}
          focused={group?.id === view.focusedGroupId} {desktop} onposition={(position) => mediaPosition(tab.id, position)} />
      {:catch error}{#if active}<div role="alert">Could not load the PDF reader: {String(error)}</div>{/if}{/await}
    {:else if tab.document.kind === 'video'}
      {#await import('./video/VideoSurface.svelte') then module}
        <module.default tabId={tab.id} document={tab.document} initialPosition={tab.position} {active}
          {desktop} onposition={(position) => mediaPosition(tab.id, position)} />
      {:catch error}{#if active}<div role="alert">Could not load the video player: {String(error)}</div>{/if}{/await}
    {:else}
      {#await import('./image/ImageSurface.svelte') then module}
        <module.default tabId={tab.id} document={tab.document} initialPosition={tab.position} {active}
          {desktop} onposition={(position) => mediaPosition(tab.id, position)} />
      {:catch error}{#if active}<div role="alert">Could not load the image reader: {String(error)}</div>{/if}{/await}
    {/if}
    </div>
  {/each}
  {#each view.terminalSessions as session (session.id)}
    {@const tab = view.tabs.find(tab => tab.kind === 'terminal' && tab.sessionId === session.id)}
    {@const group = view.groups.find(group => group.activeId === tab?.id)}
    {@const active = !!group && !(group.id === view.focusedGroupId && project.gitDiffActive)}
    {@const box = boxes.find(box => box.id === group?.id) ?? focused}
    <div class="group-content terminal-content" class:inactive={!active} inert={!active}
      style={geometry(box)} data-terminal-tab={tab?.id} data-zoom-tab={tab?.id}>
      {#await import('./terminal/TerminalSurface.svelte') then module}
        <module.default api={terminalApi} id={session.id} tabId={tab?.id} {active} focused={active && group?.id === view.focusedGroupId}
          changed={info => actions.terminalChanged(session.id, info)} />
      {:catch error}<div role="alert">Could not load the terminal: {String(error)}</div>{/await}
    </div>
  {/each}
  </div>
  <InsertionDialogs {actions} />
  <ClosePrompt {actions} />
  <BrowserAuthDialog api={desktop.browser} />
</section>
