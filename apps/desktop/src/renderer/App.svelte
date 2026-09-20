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
  import type { DesktopPort } from './ports/desktop-port';
  import type { PdfReadingPosition } from '../core/reading/reading-position';
  import { project } from './project/project-state.svelte';
  let { actions, terminalApi, desktop, pdfPosition }: { actions: AppActions; terminalApi: TerminalApi; desktop: DesktopPort;
    pdfPosition(id: string, position: PdfReadingPosition): void } = $props();
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
  {#if view.surface === 'pdf' && view.pdfDocument && !project.gitDiffActive}
    {@const pdfTab = view.pdfDocument}
    {#key `${pdfTab.id}:${pdfTab.document.path}:${pdfTab.document.diskVersion.mtimeMs}:${pdfTab.document.diskVersion.size}`}
      {#await import('./pdf/PdfSurface.svelte') then module}
        <module.default document={pdfTab.document} initialPosition={pdfTab.position}
          {desktop} onposition={(position) => pdfPosition(pdfTab.id, position)} />
      {:catch error}<div class="pdf-load-error" role="alert">Could not load the PDF reader: {String(error)}</div>{/await}
    {/key}
  {/if}
  {#if terminal.loaded}
    {#await import('./terminal/TerminalPanel.svelte') then module}
      <module.default api={terminalApi} />
    {/await}
  {/if}
  <InsertionDialogs {actions} />
  <ClosePrompt {actions} />
</section>
