<script lang="ts">
  import { tabScroll } from './tab-scroll';
  import { tick } from 'svelte';
  import { view } from '../workspace-view.svelte';
  import FileIcon from '../../project/FileIcon.svelte';
  import { project } from '../../project/project-state.svelte';
  import ApplicationMenu from '../../shell/ApplicationMenu.svelte';
import type { AppActions } from '../../ports/ui-actions';
  /** The tab strips along the window's top edge stand in for a title bar: `lead` is the top-left one,
   * `windowControls` the top-right one, and every `top` strip moves the window by its free end. */
  let { actions, groupId = 'group-0', lead = false, top = false, windowControls = false }:
    { actions: AppActions; groupId?: string; lead?: boolean; top?: boolean; windowControls?: boolean } = $props();
  let list: HTMLDivElement, row: HTMLDivElement, creation: HTMLDivElement;
  /** Too narrow to keep the new-tab buttons beside one tab: the buttons then scroll along with the tabs. */
  let cramped = $state(false);
  const group = $derived(view.groups.find(g => g.id === groupId));
  const selected = $derived(group?.activeId);
  const tabs = $derived((group?.tabs ?? []).flatMap(id => view.tabs.find(tab => tab.id === id) ?? []));
  const pinned = $derived(new Set((group?.tabs ?? []).slice(0, group?.sticky ?? 0)));
  const press = (run: () => void) => (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); event.stopPropagation(); run();
  };
  $effect(() => {
    // Shown again when the row changes what scrolls: the scroll position does not carry over.
    const id = selected; void cramped;
    void tick().then(() => {
      const tab = Array.from(list?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []).find(el => el.dataset.tabId === id);
      if (!tab || !list) return;
      // The tabs scroll in their list, or with the new-tab buttons when the row is cramped.
      for (const scroller of [list, row]) {
        const rect = tab.getBoundingClientRect(), bounds = scroller.getBoundingClientRect();
        if (rect.left < bounds.left) scroller.scrollLeft += rect.left - bounds.left;
        else if (rect.right > bounds.right) scroller.scrollLeft += rect.right - bounds.right;
      }
    });
  });
  // The row's width is the room the strip leaves it, whichever way it is laid out, so this cannot flip back and forth.
  const measure = () => {
    if (!row || !creation || !list) return;
    const tab = list.querySelector<HTMLElement>('[data-tab-id]');
    cramped = row.clientWidth < creation.offsetWidth + (tab ? parseFloat(getComputedStyle(tab).minWidth) || 0 : 0);
  };
  $effect(() => {
    // Measured on the next frame: a layout change made while sizes are being reported is itself reported as an error.
    let frame = 0;
    const observer = new ResizeObserver(() => { frame ||= requestAnimationFrame(() => { frame = 0; measure(); }); });
    observer.observe(row); observer.observe(creation);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  });
  $effect(() => { void tabs.length; void tick().then(measure); });

</script>

<nav class="tab-strip" class:has-window-controls={windowControls} data-group-id={groupId} aria-label="Open documents">
  {#if lead}
    <button class="product-identity" type="button" title="Toggle Folder Tools"
      aria-label="Toggle Folder Tools" aria-expanded={project.visible}
      onclick={actions.toggleProjectSidebar}>Setdown</button>
    <ApplicationMenu overlay={actions.menuOverlay} load={actions.loadMenu} execute={actions.executeMenuItem} />
  {/if}
  <!-- The tabs and the new-tab buttons share one row. With room for the buttons beside a tab, the tabs
       scroll in their list and the buttons stay put; narrower than that, the whole row scrolls. -->
  <div class="tab-row" class:is-cramped={cramped} bind:this={row} use:tabScroll>
  <div class="tab-list" role="tablist" bind:this={list} use:tabScroll>
    {#each tabs as tab (tab.id)}
      <button class="document-tab" class:is-dragging={view.draggedTabId === tab.id} class:git-diff-tab={tab.kind === 'diff'}
        type="button" role="tab" aria-selected={tab.id === selected}
        title={tab.preview ? `${tab.path}\nDouble-click to keep open` : tab.path}
        draggable="true" data-sleeping={tab.page?.sleeping || undefined} data-tab-id={tab.id} data-preview={tab.preview}
        aria-busy={tab.page?.loading && !tab.page.sleeping || undefined}
        data-pinned={pinned.has(tab.id) || undefined}
        onclick={() => actions.activateTab(tab.id)}
        oncontextmenu={(event) => { event.preventDefault(); actions.showTabMenu(tab.id, { x: event.clientX, y: event.clientY }); }}
        ondblclick={() => actions.pinTab(tab.id)}
        ondragstart={(event) => actions.startTabDrag(tab.id, event)} ondragend={actions.endTabDrag}>
        <!-- A tab leads with what it shows: the site's own icon, the file type as in the Explorer and folder tabs, or its kind.
             A site that declares no icon gets none: its title starts the tab. -->
        {#if tab.kind === 'web'}
          <!-- While a page loads, a spinner takes its icon's place, as in a browser's tab. -->
          {#if tab.page?.loading && !tab.page.sleeping}<svg class="tab-glyph" data-tab-icon="loading" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/></svg>
          <!-- A PDF read from the web is a document, not a site's page: it wears the file type's icon, as the same file opened from a folder does. -->
          {:else if tab.page?.pdf}<FileIcon path="document.pdf" />
          {:else if tab.page?.favicon}<img class="tab-favicon" src={tab.page.favicon} alt="" draggable="false" />
          {/if}
        {:else if tab.kind === 'terminal'}
          <!-- Solid shapes in the file icons' palette: outlines read as buttons beside site and file icons. -->
          <svg class="tab-glyph" data-tab-icon="terminal" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M3 2.5h10A1.5 1.5 0 0 1 14.5 4v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V4A1.5 1.5 0 0 1 3 2.5Zm.6 3.4 2.1 2.1-2.1 2.1.9.9 3-3-3-3Zm4 4.2v1.2h3.6v-1.2Z"/></svg>
        {:else if tab.kind === 'folder'}
          <svg class="tab-glyph" data-tab-icon="folder" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.6c0-.6.5-1.1 1.1-1.1h3.3c.3 0 .6.1.8.4l1 1.3h5.7c.6 0 1.1.5 1.1 1.1v7.1c0 .6-.5 1.1-1.1 1.1H2.6c-.6 0-1.1-.5-1.1-1.1Z"/></svg>
        {:else}<FileIcon path={tab.path} />{/if}
        <span class="tab-name">{tab.page?.sleeping ? '☾ ' : ''}{tab.name}</span>
        {#if tab.kind === 'web' && (tab.page?.audible || tab.page?.muted)}
          <span class="tab-audio" role="button" tabindex="0" aria-label={tab.page.muted ? 'Unmute tab' : 'Mute tab'}
            title={tab.page.muted ? 'Unmute tab' : 'Mute tab'} aria-pressed={tab.page.muted}
            onclick={event => { event.stopPropagation(); actions.browserCommand(tab.id, 'mute'); }}
            onkeydown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); actions.browserCommand(tab.id, 'mute'); } }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>{#if tab.page.muted}<path d="m17 9 5 6m0-6-5 6"/>{:else}<path d="M17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14"/>{/if}</svg>
          </span>
        {/if}
        {#if tab.dirty}<span class="tab-dirty" aria-label="Unsaved changes">•</span>{/if}
        {#if pinned.has(tab.id)}
          <!-- VS Code: a pinned tab trades its close button for the pin that releases it. -->
          <span class="tab-close tab-unpin" title="Unpin tab" aria-label="Unpin tab" role="button" tabindex="0"
            onclick={(event) => { event.stopPropagation(); actions.stickTab(tab.id, false); }}
            onkeydown={press(() => actions.stickTab(tab.id, false))}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.5h6M6 2.5V7L4.5 9.5h7L10 7V2.5M8 9.5V14"/></svg>
          </span>
        {:else}
          <span class="tab-close" title="Close tab" role="button" tabindex="0"
            onclick={(event) => { event.stopPropagation(); actions.closeTab(tab.id); }}
            onkeydown={press(() => actions.closeTab(tab.id))}>×</span>
        {/if}
      </button>
    {/each}

  </div>
  <div class="tab-creation-actions" bind:this={creation}>
    {#if selected && tabs.find(tab => tab.id === selected)?.kind === 'diff'}
      <button class="new-resource-button open-file-side-button" type="button" title="Open File to the Side" aria-label="Open File to the Side"
        onclick={() => { const tab = tabs.find(tab => tab.id === selected); if (tab) actions.openProjectFile(tab.path, { groupId, side: true, pinned: true }); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3H5v18h14V9M13 3v6h6M13 3l6 6M8 15h8m-3-3 3 3-3 3"/></svg>
      </button>
    {/if}
    <button class="new-resource-button new-tab-button" type="button" title="New Markdown document (Ctrl/Cmd+N)" aria-label="New document" onclick={() => { actions.focusGroup(groupId); actions.newDocument(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6M13 3v5h5M13 3l5 5v3M8 12h4M8 16h2M18 14v7M14.5 17.5h7"/></svg>
    </button>
    <button class="new-resource-button new-web-tab-button" type="button" title="New web tab (Ctrl/Cmd+T)" aria-label="New web tab" onclick={() => { actions.focusGroup(groupId); actions.newWebTab(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10a8 8 0 1 0-9 9M3 11h15M11 3c-3 4-3 12 0 16M11 3c1.5 2 2.3 4.5 2.4 7M18 14v7M14.5 17.5h7"/></svg>
    </button>
    <button class="new-resource-button new-terminal-tab-button" type="button" title="New terminal" aria-label="New terminal" onclick={() => actions.newTerminal(groupId)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7M6 8l4 4-4 4M18 14v7M14.5 17.5h7"/></svg>
    </button>
    <button class="new-resource-button new-folder-tab-button" type="button" title="New folder tab (Ctrl/Cmd+Shift+E)" aria-label="New folder tab" onclick={() => actions.newFolderTab(groupId)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 20H3.5V5.5h6l2 2.5h9V12M18 14v7M14.5 17.5h7"/></svg>
    </button>
  </div>
  </div>
  {#if top}<div class="window-drag-space" aria-hidden="true"></div>{/if}
</nav>

<style>
  .document-tab[data-preview="true"] .tab-name { font-style: italic; }
  .tab-favicon { flex: 0 0 16px; width: 16px; height: 16px; margin-right: 6px; border-radius: 3px; object-fit: contain; }
  .document-tab[data-sleeping] .tab-favicon { opacity: .55; }
  /* Seti's grey for the terminal, a folder tan beside it; the light values follow Seti's light set. */
  .tab-glyph { flex: 0 0 16px; width: 16px; height: 16px; margin-right: 6px; --tab-glyph: #6d8086; fill: var(--tab-glyph); }
  .tab-glyph[data-tab-icon="folder"] { --tab-glyph: #d9b46c; }
  .tab-glyph[data-tab-icon="loading"] { fill: none; stroke: var(--app-accent); stroke-width: 2; stroke-linecap: round; stroke-dasharray: 21 34.6;
    animation: tab-loading .9s linear infinite; }
  @keyframes tab-loading { to { transform: rotate(360deg); } }
  /* Without motion the arc still says "loading"; it just does not turn. */
  @media (prefers-reduced-motion: reduce) { .tab-glyph[data-tab-icon="loading"] { animation: none; } }
  :global([data-appearance='light']) .tab-glyph { --tab-glyph: #627379; }
  :global([data-appearance='light']) .tab-glyph[data-tab-icon="folder"] { --tab-glyph: #b7955a; }
  .document-tab[data-sleeping] .tab-glyph { opacity: .55; }
  .document-tab :global(.file-type-icon) { margin-right: 6px; }
  .tab-audio { display: inline-grid; place-items: center; width: 20px; height: 20px; flex: 0 0 20px; border-radius: 4px; }
  .tab-audio:hover { background: var(--app-hover); }
  .tab-audio svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .tab-unpin svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
</style>
