<script lang="ts">
  import { onMount } from 'svelte';
  import { languageCatalogRequest } from './language/language-runtime';
  import NativeOverlay from './shell/NativeOverlay.svelte';
  import { confirmationFocus } from './shell/confirmation-focus';
  import EmptyState from './shell/EmptyState.svelte';
  import InsertionDialogs from './editor/InsertionDialogs.svelte';
  import ReaderSurface from './reader/ReaderSurface.svelte';
  import { reviewViews } from './project/source-control/review-workspace';
  import GitDiffSurface from './project/source-control/GitDiffSurface.svelte';
  import ProjectSidebar from './project/ProjectSidebar.svelte';
  import EditorGroups from './workspace/groups/EditorGroups.svelte';
  import { groupLayout } from '../core/workspace/editor-groups';
  import TitleBar from './shell/TitleBar.svelte';
  import ClosePrompt from './shell/ClosePrompt.svelte';
  import BrowserAuthDialog from './browser/BrowserAuthDialog.svelte';
  import { webPdfPositions } from './browser/web-pdf-positions';
  import { webPdfPort } from './browser/web-pdf-port';
  import { view } from './workspace/workspace-view.svelte';
import type { AppActions } from './ports/ui-actions';



  import type { TerminalApi } from '../protocol/terminal';
  import type { DesktopPort } from './ports/desktop-port';
  import type { ReadingPosition } from '../core/reading/reading-position';
  import { project } from './project/project-state.svelte';
  let { actions, terminalApi, desktop, mediaPosition }: { actions: AppActions; terminalApi: TerminalApi; desktop: DesktopPort;
    mediaPosition(id: string, position: ReadingPosition): void } = $props();
  onMount(() => {
    const show = (event: Event) => {
      if (!(event instanceof CustomEvent)) languageCatalogRequest.set({});
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
  {#if view.recoveryCount && view.tabs.length === 0}
    <div class="notice recovery-notice"><span>{view.recoveryCount} unsaved workspace recovery {view.recoveryCount === 1 ? 'snapshot is' : 'snapshots are'} available.</span><button type="button" onclick={actions.restoreWorkspace}>Review Recovery</button></div>
  {/if}
  <EditorGroups {actions} />
  <div class="group-content focused-content" style={geometry(focused)}
    data-zoom-tab={project.gitDiffActive ? project.activeGitDiffId : view.groups.find(group => group.id === view.focusedGroupId)?.activeId}>
  {#if view.recoveryError}<div class="notice" role="alert">{view.recoveryError}</div>{/if}
  <div class="notice" hidden={!view.notice}>
    <span>{view.noticeMessage}</span>
    <div>
      <button class="notice-keep" type="button" onclick={actions.keepExternalChange}>Keep My Changes</button>
      <button class="notice-reload" type="button" onclick={actions.reloadExternalChange}>Reload</button>
    </div>
  </div>
  <EmptyState {actions} />
  <ReaderSurface {actions} />

  </div>
  {#each reviewViews.entries as entry (entry.id)}
    {@const group = view.groups.find(g => g.activeId === entry.id)}
    {@const box = boxes.find(box => box.id === group?.id) ?? focused}
    <div class="group-content review-content" class:inactive={!group} inert={!group}
      style={geometry(box)} data-group-id={group?.id} data-zoom-tab={entry.id}>
      <GitDiffSurface {actions} {entry} focused={view.tabs.some(tab => tab.id === entry.id && tab.active)} />
    </div>
  {/each}
  {#each view.notebookTabs as tab (tab.id)}
    {@const group = view.groups.find(g => g.activeId === tab.id)}
    {@const active = !!group && !(group.id === view.focusedGroupId && project.gitDiffActive)}
    {@const box = boxes.find(box => box.id === group?.id) ?? focused}
    <div class="group-content notebook-content" class:inactive={!active} inert={!active} style={geometry(box)} data-notebook-tab={tab.id} data-zoom-tab={tab.id}>
      {#key tab.entry}
        {#await import('./notebook/NotebookSurface.svelte') then module}
          <module.default entry={tab.entry} path={tab.path} {active} {desktop} openFile={actions.openLanguageLocation} onfocus={() => { if (view.focusedGroupId !== group?.id) actions.activateTab(tab.id); }} />
        {:catch error}<div role="alert">Could not load the notebook: {String(error)}</div>{/await}
      {/key}
    </div>
  {/each}
  {#each view.mediaTabs as tab (tab.key)}
    {@const group = view.groups.find(g => g.activeId === tab.id)}
    {@const active = !!group && !(group.id === view.focusedGroupId && project.gitDiffActive)}
    {@const box = boxes.find(box => box.id === group?.id) ?? focused}
    <div class="group-content media-content" class:inactive={!active} style={geometry(box)} data-media-tab={tab.id} data-zoom-tab={tab.id}>
    {#if tab.document.kind === 'pdf'}
      {#await import('./pdf/PdfSurface.svelte') then module}
        <module.default tabId={tab.id} document={tab.document} initialPosition={tab.position} {active}
          focused={group?.id === view.focusedGroupId} desktop={tab.remote ? webPdfPort(desktop, tab.id, tab.remote) : desktop}
          onposition={(position) => { if (tab.remote) webPdfPositions[tab.remote] = position; else mediaPosition(tab.id, position); }} />
      {:catch error}{#if active}<div role="alert">Could not load the PDF reader: {String(error)}</div>{/if}{/await}
    {:else if tab.document.kind === 'video'}
      {#await import('./video/VideoSurface.svelte') then module}
        <module.default tabId={tab.id} document={tab.document} initialPosition={tab.position} {active}
          {desktop} onposition={(position) => mediaPosition(tab.id, position)} />
      {:catch error}{#if active}<div role="alert">Could not load the video player: {String(error)}</div>{/if}{/await}
    {:else}
      {#await import('./image/ImageSurface.svelte') then module}
        <module.default tabId={tab.id} document={tab.document} initialPosition={tab.position} {active}
          focused={group?.id === view.focusedGroupId} onfocus={() => { if (view.focusedGroupId !== group?.id) actions.activateTab(tab.id); }} {desktop} onposition={(position) => mediaPosition(tab.id, position)} />
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

<style>
  .notebook-content.inactive, .review-content.inactive { display: none; }
</style>

{#if view.reloadPrompt}
  <NativeOverlay />
  <div class="project-confirm" role="alertdialog" aria-modal="true" aria-labelledby="reload-title" use:confirmationFocus={() => view.reloadPrompt = null}>
    <strong id="reload-title">Reload “{view.reloadPrompt.name}”?</strong>
    <span>Replace unsaved edits with the version on disk?</span>
    <div><button type="button" class="ghost" onclick={() => view.reloadPrompt = null}>Keep Editing</button>
      <button type="button" class="danger" onclick={() => { void actions.reloadLocalDocument(view.reloadPrompt!.id, true); }}>Reload from Disk</button></div>
  </div>
{/if}
