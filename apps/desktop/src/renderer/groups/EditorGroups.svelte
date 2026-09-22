<script lang="ts">
  import { view, type AppActions } from '../view-state.svelte';
  import { groupLayout, type SashBox } from '../../core/workspace/editor-groups';
  import TabChrome from '../tabs/TabChrome.svelte';
  let { actions }: { actions: AppActions } = $props();
  const layout = $derived(groupLayout(view.groupTree));
  function resize(event: PointerEvent, sash: SashBox) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const area = handle.parentElement!.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    window.dispatchEvent(new CustomEvent('setdown:group-resize', { detail: true }));
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
      window.dispatchEvent(new CustomEvent('setdown:group-resize', { detail: false }));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('lostpointercapture', end);
  }
</script>

{#each layout.groups as box (box.id)}
  <section class="editor-group" data-group-id={box.id} class:focused={view.focusedGroupId === box.id}
    aria-label="Editor group" style:left={`${box.x}%`} style:top={`${box.y}%`}
    style:width={`${box.width}%`} style:height={`${box.height}%`}>
    <TabChrome {actions} groupId={box.id} />
    <div class="group-body" data-group-id={box.id}>
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
