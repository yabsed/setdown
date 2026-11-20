<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { hereBudget, hereRows, type HereItem, type HereMenuSource } from './here-menu';
  import { isComposingInput } from '../editor/composition-guard';
  let { source, items: opened, late, close }: { source: HereMenuSource; items: HereItem[]; late?: Promise<HereItem[]>; close(restore?: boolean): void } = $props();
  let menu = $state<HTMLDivElement>(), input = $state<HTMLInputElement>();
  // The entries a tool gave in time, then once more when the slower ones answered.
  let answered = $state.raw<HereItem[] | undefined>(), asking = $state(false);
  let query = $state(''), active = $state(''), left = $state(0), top = $state(0), placed = $state(false);
  const rows = $derived(hereRows([...(answered ?? opened), ...source.fixed], query));
  const current = $derived(rows.find(row => row.item.id === active) ?? rows[0]);
  function place() {
    if (!menu) return;
    const box = menu.getBoundingClientRect(), margin = 6;
    left = Math.max(margin, Math.min(source.at.x, window.innerWidth - box.width - margin));
    // Below the cursor when it fits, else above it; never over the place the menu is about.
    top = source.at.y + box.height + margin <= window.innerHeight ? source.at.y : Math.max(margin, source.at.y - box.height - 4);
    placed = true;
  }
  async function run(item: HereItem) {
    const alive = source.alive();
    close();
    if (!alive) return;
    await item.run();
    source.chosen?.(item);
  }
  function move(step: number) {
    if (!rows.length) return;
    const at = Math.max(0, rows.findIndex(row => row.item.id === current?.item.id));
    active = rows[(at + step + rows.length) % rows.length].item.id;
    void tick().then(() => menu?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }
  function keydown(event: KeyboardEvent) {
    // Enter and Escape that end a composition belong to the input method.
    if (isComposingInput(event)) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Home' && !query) { event.preventDefault(); active = rows[0]?.item.id ?? ''; }
    else if (event.key === 'End' && !query) { event.preventDefault(); active = rows.at(-1)?.item.id ?? ''; }
    else if (event.key === 'Enter') { event.preventDefault(); if (current) void run(current.item); }
    else if (event.key === 'Tab') event.preventDefault();
    // A key that writes, pressed after a click inside the menu moved the focus off the field, is for the field.
    else if (event.target !== input && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) input?.focus({ preventScroll: true });
  }
  onMount(() => {
    place();
    let live = true;
    // The menu is drawn once it has its place; only then can its field take the keyboard.
    void tick().then(() => { if (live) input?.focus({ preventScroll: true }); });
    if (late) {
      asking = true;
      // A slow tool fills its entries in once; after that the menu no longer changes.
      void Promise.race([late, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), hereBudget.late))]).then(async found => {
        if (!live) return;
        if (found && source.alive()) answered = found;
        asking = false; await tick(); place();
      });
    }
    const outside = (event: Event) => { if (event.target instanceof Node && !menu?.contains(event.target)) close(event.type !== 'pointerdown'); };
    const leave = () => close(false);
    // Escape closes the menu wherever the keyboard is: an open menu never needs the pointer to go away.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isComposingInput(event) || event.target instanceof Node && menu?.contains(event.target)) return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('pointerdown', outside, true); window.addEventListener('wheel', outside, true);
    window.addEventListener('blur', leave); window.addEventListener('resize', leave);
    return () => { live = false; window.removeEventListener('keydown', escape, true); window.removeEventListener('pointerdown', outside, true); window.removeEventListener('wheel', outside, true);
      window.removeEventListener('blur', leave); window.removeEventListener('resize', leave); };
  });
</script>

<!-- Drawn by the app, not by the editor: the editor's own menu is a fixed list, and this one is the tool's answers. -->
<div bind:this={menu} class="here-menu" class:placed role="dialog" aria-label="Actions here" tabindex="-1" style:left={`${left}px`} style:top={`${top}px`}
  oncontextmenu={event => event.preventDefault()} onkeydown={keydown}>
  {#if source.subject}<p class="subject" title={source.subject}>{source.subject}</p>{/if}
  <div class="entries" role="listbox" aria-label="Actions here" aria-busy={asking}>
    {#each rows as row (row.item.id)}
      <button type="button" class="entry" class:first={!!row.group} role="option" aria-selected={row.item.id === current?.item.id} tabindex="-1"
        onpointermove={() => { active = row.item.id; }} onclick={() => run(row.item)}>
        <span class="group">{row.group ?? ''}</span><span class="label">{row.item.label}</span>{#if row.item.key}<kbd>{row.item.key}</kbd>{/if}
      </button>
    {:else}
      {#if !asking}<p class="none">{query ? 'Nothing here matches.' : 'Nothing to do here.'}</p>{/if}
    {/each}
    {#if asking}<p class="none" role="status">Asking {source.language ?? 'the language tool'}…</p>{/if}
  </div>
  <input bind:this={input} bind:value={query} oninput={() => { active = ''; void tick().then(place); }} placeholder="Type to narrow…" aria-label="Type to narrow the actions"
    spellcheck="false" autocomplete="off" />
</div>

<style>
  .here-menu { position: fixed; z-index: 3000; visibility: hidden; display: flex; flex-direction: column; min-width: 250px; max-width: min(460px, calc(100vw - 12px)); max-height: min(70vh, 560px);
    padding: 4px 0; color: var(--app-text); background: var(--app-raised-surface); border: 1px solid var(--app-border); border-radius: 6px; box-shadow: 0 6px 24px var(--app-shadow); font: 12.5px/1.4 var(--app-font-family, system-ui); }
  .here-menu.placed { visibility: visible; }
  .subject { margin: 0; padding: 3px 12px 5px; color: var(--app-muted-text); font: 11.5px var(--monaco-monospace-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--app-border); }
  .entries { overflow-y: auto; min-height: 0; padding: 2px 0; }
  .entry { display: grid; grid-template-columns: 82px 1fr auto; align-items: baseline; gap: 0 8px; width: 100%; padding: 4px 12px; color: inherit; font: inherit; text-align: left; background: transparent; border: 0; cursor: default; }
  /* A new group begins a little lower, so the groups read as groups without a line between them. */
  .entry.first:not(:first-child) { margin-top: 4px; }
  .entry[aria-selected='true'] { background: var(--app-selected, var(--app-hover)); }
  .group { color: var(--app-muted-text); font-size: 11px; }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  kbd { color: var(--app-muted-text); font: inherit; font-size: 11px; white-space: nowrap; }
  .none { margin: 0; padding: 4px 12px 4px 102px; color: var(--app-muted-text); }
  input { margin: 2px 0 0; padding: 5px 12px 3px; color: inherit; font: inherit; font-size: 11.5px; background: transparent; border: 0; border-top: 1px solid var(--app-border); outline: none; min-width: 0; }
  input::placeholder { color: var(--app-muted-text); }
</style>
