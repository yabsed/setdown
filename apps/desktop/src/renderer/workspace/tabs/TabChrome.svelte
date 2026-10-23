<script lang="ts">
  import { tabScroll } from './tab-scroll';
  import { tick } from 'svelte';
  import { view } from '../workspace-view.svelte';
import type { AppActions } from '../../ports/ui-actions';
  let { actions, groupId = 'group-0' }: { actions: AppActions; groupId?: string } = $props();
  let list: HTMLDivElement;
  const group = $derived(view.groups.find(g => g.id === groupId));
  const selected = $derived(group?.activeId);
  const tabs = $derived((group?.tabs ?? []).flatMap(id => view.tabs.find(tab => tab.id === id) ?? []));
  $effect(() => {
    const id = selected;
    void tick().then(() => {
      const tab = Array.from(list?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []).find(el => el.dataset.tabId === id);
      if (!tab || !list) return;
      const rect = tab.getBoundingClientRect(), bounds = list.getBoundingClientRect();
      if (rect.left < bounds.left) list.scrollLeft += rect.left - bounds.left;
      else if (rect.right > bounds.right) list.scrollLeft += rect.right - bounds.right;
    });
  });

</script>

<nav class="tab-strip" data-group-id={groupId} aria-label="Open documents">
  <div class="tab-list" role="tablist" bind:this={list} use:tabScroll>
    {#each tabs as tab (tab.id)}
      <button class="document-tab" class:is-dragging={view.draggedTabId === tab.id} class:git-diff-tab={tab.kind === 'diff'}
        type="button" role="tab" aria-selected={tab.id === selected}
        title={tab.preview ? `${tab.path}\nDouble-click to keep open` : tab.path}
        draggable="true" data-tab-id={tab.id} data-preview={tab.preview}
        onclick={() => actions.activateTab(tab.id)}
        ondblclick={() => actions.pinTab(tab.id)}
        ondragstart={(event) => actions.startTabDrag(tab.id, event)} ondragend={actions.endTabDrag}>
        <span class="tab-name">{tab.page?.loading ? '◌ ' : ''}{tab.name}</span>
        {#if tab.kind === 'web' && (tab.page?.audible || tab.page?.muted)}
          <span class="tab-audio" role="button" tabindex="0" aria-label={tab.page.muted ? 'Unmute tab' : 'Mute tab'}
            title={tab.page.muted ? 'Unmute tab' : 'Mute tab'} aria-pressed={tab.page.muted}
            onclick={event => { event.stopPropagation(); actions.browserCommand(tab.id, 'mute'); }}
            onkeydown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); actions.browserCommand(tab.id, 'mute'); } }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>{#if tab.page.muted}<path d="m17 9 5 6m0-6-5 6"/>{:else}<path d="M17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14"/>{/if}</svg>
          </span>
        {/if}
        {#if tab.dirty}<span class="tab-dirty" aria-label="Unsaved changes">•</span>{/if}
        <span class="tab-close" title="Close tab" role="button" tabindex="0"
          onclick={(event) => { event.stopPropagation(); actions.closeTab(tab.id); }}
          onkeydown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault(); event.stopPropagation(); actions.closeTab(tab.id);
          }}>×</span>
      </button>
    {/each}

  </div>
  <div class="tab-creation-actions">
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
    <button class="new-resource-button new-terminal-tab-button" type="button" title="New terminal" aria-label="New terminal" onclick={() => { actions.focusGroup(groupId); actions.newTerminal(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7M6 8l4 4-4 4M18 14v7M14.5 17.5h7"/></svg>
    </button>
  </div>
</nav>

<style>
  .document-tab[data-preview="true"] .tab-name { font-style: italic; }
  .tab-audio { display: inline-grid; place-items: center; width: 20px; height: 20px; flex: 0 0 20px; border-radius: 4px; }
  .tab-audio:hover { background: var(--app-hover); }
  .tab-audio svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; }
</style>
