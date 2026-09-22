<script lang="ts">
  import EmptyState from './shell/EmptyState.svelte';
  import InsertionDialogs from './editor/InsertionDialogs.svelte';
  import ReaderSurface from './reader/ReaderSurface.svelte';
  import GitDiffSurface from './project/source-control/GitDiffSurface.svelte';
  import ProjectSidebar from './project/ProjectSidebar.svelte';
  import EditorGroups from './groups/EditorGroups.svelte';
  import { groupLayout } from '../core/workspace/editor-groups';
  import TitleBar from './shell/TitleBar.svelte';
  import ClosePrompt from './shell/ClosePrompt.svelte';
  import { view, type AppActions } from './view-state.svelte';

  import { terminal } from './terminal/terminal-state.svelte';

  import type { TerminalApi } from '../protocol/terminal';
  import type { DesktopPort } from './ports/desktop-port';
  import type { ReadingPosition } from '../core/reading/reading-position';
  import { project } from './project/project-state.svelte';
  let { actions, terminalApi, desktop, mediaPosition }: { actions: AppActions; terminalApi: TerminalApi; desktop: DesktopPort;
    mediaPosition(id: string, position: ReadingPosition): void } = $props();
  const boxes = $derived(groupLayout(view.groupTree).groups);
  const focused = $derived(boxes.find(box => box.id === view.focusedGroupId) ?? boxes[0]);
  const geometry = (box: typeof focused) => `left:${box.x}%;top:${box.y}%;width:${box.width}%;height:${box.height}%`;
</script>

<TitleBar {actions} />
<section class="shell" data-surface="empty" data-tabs="false"
  style:--terminal-height={terminal.open ? `min(${terminal.height}px, 65vh)` : '0px'}>
  <ProjectSidebar {actions} />
  <div class="editor-area" class:split={view.groups.length > 1}>
  <EditorGroups {actions} />
  <div class="group-content focused-content" style={geometry(focused)}>
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
        <module.default document={tab.document} initialPosition={tab.position} {active}
          focused={group?.id === view.focusedGroupId} {desktop} onposition={(position) => mediaPosition(tab.id, position)} />
      {:catch error}{#if active}<div role="alert">Could not load the PDF reader: {String(error)}</div>{/if}{/await}
    {:else}
      {#await import('./image/ImageSurface.svelte') then module}
        <module.default document={tab.document} initialPosition={tab.position} {active}
          {desktop} onposition={(position) => mediaPosition(tab.id, position)} />
      {:catch error}{#if active}<div role="alert">Could not load the image reader: {String(error)}</div>{/if}{/await}
    {/if}
    </div>
  {/each}
  </div>
  {#if terminal.loaded}
    {#await import('./terminal/TerminalPanel.svelte') then module}
      <module.default api={terminalApi} />
    {/await}
  {/if}
  <InsertionDialogs {actions} />
  <ClosePrompt {actions} />
</section>
