<script lang="ts">
  import { view } from '../workspace-view.svelte';
import type { AppActions } from '../../ports/ui-actions';
  import { groupLayout, type SashBox } from '../../../core/workspace/editor-groups';
  import TabChrome from '../tabs/TabChrome.svelte';
  import LocationBar from '../location/LocationBar.svelte';
  import WebReaderSurface from '../../browser/WebReaderSurface.svelte';
  import { browser } from '../../browser/browser-state.svelte';
  let { actions }: { actions: AppActions } = $props();
  const layout = $derived(groupLayout(view.groupTree));
  function resize(event: PointerEvent, sash: SashBox) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const area = handle.parentElement!.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const extent = sash.axis === 'x' ? area.width * sash.width / 100 : area.height * sash.height / 100;
      const offset = sash.axis === 'x' ? e.clientX - area.left - area.width * sash.x / 100
        : e.clientY - area.top - area.height * sash.y / 100;
      const min = Math.min(.45, (sash.axis === 'x' ? 180 : 100) / extent);
      actions.resizeGroup(sash.id, Math.max(min, Math.min(1 - min, offset / extent)));
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('lostpointercapture', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('lostpointercapture', end);
  }
</script>

{#each layout.groups as box (box.id)}
    {@const tab = view.tabs.find(tab => tab.id === view.groups.find(group => group.id === box.id)?.activeId)}

  <section class="editor-group" data-group-id={box.id} data-tab-kind={tab?.kind ?? 'document'} class:focused={view.focusedGroupId === box.id}
    aria-label="Editor group" style:left={`${box.x}%`} style:top={`${box.y}%`}
    style:width={`${box.width}%`} style:height={`${box.height}%`}>
    <TabChrome {actions} groupId={box.id} />
    <LocationBar {actions} groupId={box.id} />
    <div class="group-body" data-group-id={box.id} data-zoom-tab={tab?.id}>
      {#if tab?.kind === 'web' && browser.readers[tab.id]}
        {#key tab.id}<WebReaderSurface {actions} groupId={box.id} tabId={tab.id} snapshot={browser.readers[tab.id]} />{/key}
      {:else if tab?.kind === 'web' && (tab.page?.error || tab.page?.startPage)}
        <div class="browser-empty" data-browser-tab={tab.id}>
          <h2>{tab.page?.error ? 'This page could not be opened' : 'A place for the web'}</h2>
          <p>{tab.page?.error || 'Enter an address above, or open a bookmark from the Browser panel.'}</p>
          {#if tab.page?.failure}<p>{tab.page.failure.url}</p>{/if}
          {#if tab.page?.error}<button onclick={() => actions.browserCommand(tab.id, 'reload')}>Reload page</button>{/if}
        </div>
      {/if}
      <div class="group-editor-host" data-group-id={box.id}></div>
    </div>
  </section>
{/each}
{#each layout.sashes as sash (sash.id)}
  <button class="group-sash" class:vertical={sash.axis === 'x'} type="button" aria-label="Resize editor groups"
    style:left={`${sash.x + (sash.axis === 'x' ? sash.width * sash.ratio : 0)}%`}
    style:top={`${sash.y + (sash.axis === 'y' ? sash.height * sash.ratio : 0)}%`}
    style:width={sash.axis === 'x' ? '5px' : `${sash.width}%`}
    style:height={sash.axis === 'y' ? '5px' : `${sash.height}%`}
    onpointerdown={event => resize(event, sash)} ondblclick={() => actions.resizeGroup(sash.id, .5)}
    onkeydown={event => {
      const decrease = sash.axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
      const increase = sash.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
      if (event.key === decrease || event.key === increase) {
        event.preventDefault(); actions.resizeGroup(sash.id, sash.ratio + (event.key === decrease ? -.05 : .05));
      }
    }}></button>
{/each}
