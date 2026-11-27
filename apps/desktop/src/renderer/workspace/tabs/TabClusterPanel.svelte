<script lang="ts">
  // The panel that names and colours a tab group, as Firefox's does (`tabgroup-menu.mjs`): it opens
  // under the group's label with the name field focused, and the name and the colour change the
  // strip as they are chosen. For a new tab group, Cancel and Escape dissolve it and Done, Enter
  // and a click elsewhere keep it. For an existing one there is nothing to cancel: the panel
  // lists what can be done with the group and closes on Enter, Escape or a click elsewhere.
  import { onMount } from 'svelte';
  import { TAB_CLUSTER_COLORS, TAB_CLUSTER_COLOR_NAMES, MAX_TAB_CLUSTER_NAME, type TabCluster, type TabClusterColor } from '../../../core/workspace/tab-clusters';
  import { isComposingInput } from '../../editor/composition-guard';
  import type { AppActions } from '../../ports/ui-actions';
  import NativeOverlay from '../../shell/NativeOverlay.svelte';

  let { actions, cluster, mode, anchor, onclose }: {
    actions: AppActions; cluster: TabCluster; mode: 'create' | 'edit';
    /** The label the panel hangs under. */
    anchor(): HTMLElement | null; onclose(): void;
  } = $props();
  let layer: HTMLDivElement, panel: HTMLDivElement, field: HTMLInputElement;
  let left = $state(8), top = $state(40);
  const id = $derived(cluster.id);
  function place() {
    const box = anchor()?.getBoundingClientRect();
    if (!box || !panel) return;
    // Under the label, left edges together; inside the window whatever the label's place.
    left = Math.max(8, Math.min(box.left, innerWidth - panel.offsetWidth - 8));
    top = Math.max(8, Math.min(box.bottom + 6, innerHeight - panel.offsetHeight - 8));
  }
  onMount(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The panel lies over the whole window, not inside the strip that opened it: a strip is a
    // scrolling row inside a pane, and either may cut off what hangs out of it. Only this inner
    // node moves. The component's own first and last nodes stay where Svelte put them: it
    // removes a component by walking from one to the other.
    document.body.append(layer);
    place(); field.focus(); field.select();
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('resize', place); layer.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  });
  const keep = () => onclose();
  const dissolve = () => { const target = id, created = mode === 'create'; onclose(); if (created) actions.tabClusters.ungroup(target); };
  function key(event: KeyboardEvent) {
    // The panel's keys are its own: nothing typed here reaches the editor or a shortcut behind it.
    event.stopPropagation();
    // Enter and Escape that end a Hangul or other composition belong to the input method.
    if (isComposingInput(event)) return;
    if (event.key === 'Escape') { event.preventDefault(); dissolve(); }
    // Enter is Done from the name field and from a colour; on a button it presses that button.
    else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement && event.target.getAttribute('role') !== 'radio')) { event.preventDefault(); keep(); }
    else if (event.key === 'Tab') {
      // Focus stays in the panel while it is open.
      const stops = [...panel.querySelectorAll<HTMLElement>('input:not([tabindex="-1"]), button:not([tabindex="-1"])')].filter(element => !element.hasAttribute('disabled'));
      const first = stops[0], last = stops.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  function swatchKey(event: KeyboardEvent, color: TabClusterColor) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TAB_CLUSTER_COLORS[(TAB_CLUSTER_COLORS.indexOf(color) + step + TAB_CLUSTER_COLORS.length) % TAB_CLUSTER_COLORS.length];
    actions.tabClusters.update(id, { color: next });
    panel.querySelector<HTMLElement>(`[data-cluster-color="${next}"]`)?.focus();
  }
  /** A command closes the panel first. The group is read before that: closed, the panel has no group to name. */
  const then = (run: (target: string) => void) => () => { const target = id; onclose(); run(target); };
</script>

<NativeOverlay />
<!-- A click anywhere else keeps the tab group and closes the panel. -->
<div hidden>
<div class="tab-cluster-layer" bind:this={layer}>
<div class="tab-cluster-backdrop" role="presentation" onpointerdown={keep} oncontextmenu={event => { event.preventDefault(); keep(); }}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="tab-cluster-panel" role="dialog" aria-label={mode === 'create' ? 'Create tab group' : 'Manage tab group'} tabindex="-1"
  style:left={`${left}px`} style:top={`${top}px`} bind:this={panel} onkeydown={key}>
  <h2>{mode === 'create' ? 'Create tab group' : 'Manage tab group'}</h2>
  <label class="name"><span>Name</span>
    <input type="text" placeholder="Example: Shopping" maxlength={MAX_TAB_CLUSTER_NAME} autocomplete="off" spellcheck="false" value={cluster.name} bind:this={field}
      oninput={event => actions.tabClusters.update(id, { name: event.currentTarget.value })} />
  </label>
  <div class="swatches" role="radiogroup" aria-label="Tab group color">
    {#each TAB_CLUSTER_COLORS as color}
      <button type="button" role="radio" class="swatch" aria-checked={cluster.color === color} aria-label={TAB_CLUSTER_COLOR_NAMES[color]} title={TAB_CLUSTER_COLOR_NAMES[color]}
        data-cluster-color={color} tabindex={cluster.color === color ? 0 : -1}
        onclick={() => actions.tabClusters.update(id, { color })} onkeydown={event => swatchKey(event, color)}></button>
    {/each}
  </div>
  {#if mode === 'create'}
    <div class="buttons">
      <button type="button" onclick={dissolve}>Cancel</button>
      <button type="button" class="primary" onclick={keep}>Done</button>
    </div>
  {:else}
    <div class="commands" role="group" aria-label="Tab group commands">
      <button type="button" onclick={then(target => actions.tabClusters.newTab(target))}>New tab in group</button>
      <button type="button" onclick={then(target => actions.tabClusters.ungroup(target))}>Ungroup tabs</button>
      <hr />
      <button type="button" class="danger" onclick={then(target => actions.tabClusters.close(target))}>Delete group</button>
    </div>
  {/if}
</div>
</div>
</div>

<style>
  .tab-cluster-layer { position: fixed; inset: 0; z-index: 400; }
  .tab-cluster-backdrop { position: absolute; inset: 0; -webkit-app-region: no-drag; }
  .tab-cluster-panel { position: absolute; width: 24em; max-width: calc(100vw - 16px); padding: 14px; color: var(--app-text);
    border: 1px solid var(--app-border); border-radius: 8px; background: var(--app-raised-surface, var(--app-surface));
    box-shadow: 0 8px 28px rgb(0 0 0 / .22); font-size: 13px; -webkit-app-region: no-drag; }
  h2 { margin: 0 0 12px; font-size: 13px; font-weight: 600; text-align: center; }
  .name { display: grid; gap: 5px; }
  .name span { font-size: 12px; color: var(--app-muted-text); }
  input { height: 30px; padding: 0 9px; color: var(--app-text); border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-canvas); font: inherit; }
  input:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 0; border-color: transparent; }
  .swatches { display: flex; justify-content: space-between; margin: 14px 0 4px; }
  .swatch { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: var(--cluster-color); cursor: pointer; }
  .swatch:hover { background: var(--cluster-hover); }
  /* The chosen colour wears a ring of itself, with the panel showing between. */
  .swatch[aria-checked='true'] { box-shadow: 0 0 0 2px var(--app-raised-surface, var(--app-surface)), 0 0 0 4px var(--cluster-color); }
  .swatch:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 4px; }
  .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  .buttons button { min-width: 72px; height: 28px; padding: 0 12px; color: var(--app-text); border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-surface); font: inherit; cursor: pointer; }
  .buttons button:hover { background: var(--app-hover); }
  .buttons .primary { color: var(--app-accent-text, #fff); border-color: transparent; background: var(--app-accent); }
  .buttons .primary:hover { background: color-mix(in srgb, var(--app-accent) 86%, black); }
  .commands { display: grid; margin: 12px -6px -6px; }
  .commands button { height: 28px; padding: 0 8px; color: var(--app-text); border: 0; border-radius: 4px; background: transparent; font: inherit; text-align: left; cursor: pointer; }
  .commands button:hover { background: var(--app-hover); }
  .commands .danger { color: var(--app-danger-text); }
  .commands hr { width: 100%; margin: 4px 0; border: 0; border-top: 1px solid var(--app-border); }
  button:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
</style>
