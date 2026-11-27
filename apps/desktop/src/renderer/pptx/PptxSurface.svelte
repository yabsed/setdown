<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { DocumentSnapshot } from '../../core/document/document';
  import type { OfficeReadingPosition, ReadingPosition } from '../../core/reading/reading-position';
  import type { PptxPort } from '../ports/desktop-port';
  import { zoomState } from '../zoom-state.svelte';
  import { PPTX_ALIGNMENTS, PPTX_CONTROL_IDS, PPTX_FONT_SIZES, PPTX_HISTORY, PPTX_LISTS, PPTX_PICTURE_TYPES, PPTX_SHAPES, PPTX_TOGGLES,
    type PptxControlId, type PptxControlState, type PptxEngine, type PptxFind, type PptxInsert, type PptxView } from './pptx-engine';
  import { pptxSessions, type PptxSession } from './pptx-sessions';

  let { tabId, document: file, initialPosition, desktop, active, focused, onfocus, onposition }: {
    tabId: string; document: DocumentSnapshot; initialPosition?: ReadingPosition; desktop: PptxPort; active: boolean; focused: boolean;
    onfocus(): void; onposition(position: OfficeReadingPosition): void;
  } = $props();
  const initial = untrack(() => initialPosition?.kind === 'office' ? initialPosition : undefined);
  const EMPTY: PptxView = { ready: false, error: null, mode: 'view', slide: 0, slides: [], aspect: 4 / 3, canUndo: false, canRedo: false,
    selection: 'none', fontSize: null, align: null, damaged: false };
  const NO_MATCH: PptxFind = { count: 0, index: -1, slide: -1 };
  const ICON_IDS = [...PPTX_CONTROL_IDS.filter(id => id !== 'paragraph.align'), ...PPTX_ALIGNMENTS.map(item => `paragraph.align=${item.value}`)];

  let stage = $state<HTMLDivElement>() as HTMLDivElement;
  let list = $state<HTMLDivElement>() as HTMLDivElement;
  let findInput = $state<HTMLInputElement>() as HTMLInputElement;
  let pictureInput = $state<HTMLInputElement>() as HTMLInputElement;
  let session = $state.raw<PptxSession>();
  let view = $state.raw<PptxView>(EMPTY);
  // The engine is read only in `refresh`, when it says something changed: never from a template expression or a derived value.
  let controls = $state.raw<Partial<Record<PptxControlId, PptxControlState>>>({});
  let icons = $state.raw<Record<string, readonly string[]>>({});
  /** Bumped whenever the session reports a change (dirty, saving, error). */
  let pulse = $state(0);
  let error = $state('');
  /** Why the last thing asked of the toolbar was not done. */
  let problem = $state('');
  let query = $state('');
  let found = $state.raw<PptxFind>(NO_MATCH);
  /** The tab zoom as a factor; 1 shows a whole slide in the pane. */
  const zoom = $derived((zoomState.tabs?.[tabId] ?? 100) / 100);
  /** The boxes that show a slide, each with the call that brings its picture up to date. */
  const pictures = new Set<() => void>();
  let mounted: PptxEngine | undefined;
  let dead = false;
  // Restoring a position also moves the list. Only movement after real input replaces the stored position.
  let interacted = false, restored = false;
  let last = initial ? `${initial.top.toFixed(4)}:${initial.left.toFixed(4)}` : '';

  const engine = $derived(session?.engine);
  const editing = $derived(view.mode === 'edit');
  const dirty = $derived.by(() => { void pulse; return !!session && session.edits !== session.savedEdits; });
  const busy = $derived.by(() => { void pulse; return !!session?.busy; });
  const saveError = $derived.by(() => { void pulse; return session?.error ?? ''; });
  const control = (id: PptxControlId): PptxControlState => controls[id] ?? { enabled: false, active: false };
  const ratio = (offset: number, range: number) => range > 0 ? Math.min(1, Math.max(0, offset / range)) : 0;
  const slideBox = (index: number) => list?.querySelector<HTMLElement>(`[data-slide="${index}"]`);

  function remember() {
    if (!active || !view.ready || editing || !interacted) return;
    const top = ratio(list.scrollTop, list.scrollHeight - list.clientHeight), left = ratio(list.scrollLeft, list.scrollWidth - list.clientWidth);
    const key = `${top.toFixed(4)}:${left.toFixed(4)}`;
    if (key !== last) { last = key; onposition({ kind: 'office', top, left }); }
  }
  function restore() {
    if (!initial || restored || interacted || !view.ready || editing) return;
    restored = true;
    // The slides take their places in this update; the list is as long as it will be one frame later.
    requestAnimationFrame(() => {
      if (dead || interacted) return;
      list.scrollTop = initial.top * (list.scrollHeight - list.clientHeight);
      list.scrollLeft = initial.left * (list.scrollWidth - list.clientWidth);
    });
  }
  /** Brings a slide of the list into sight: the one being edited in the rail, a search result while reading. */
  const reveal = (index: number) => requestAnimationFrame(() => slideBox(index)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  function refresh() {
    if (dead || !mounted) return;
    const next = mounted.view(), states: Partial<Record<PptxControlId, PptxControlState>> = {};
    if (next.mode === 'edit') for (const id of PPTX_CONTROL_IDS) states[id] = mounted.control(id);
    const moved = next.mode === 'edit' && (next.slide !== view.slide || view.mode !== 'edit');
    view = next; controls = states;
    // The engine repaints a slide's picture only when it is asked for the box again.
    for (const repaint of pictures) repaint();
    if (moved) reveal(next.slide);
    restore();
  }
  let stopEngine: (() => void) | undefined;
  function unmount() {
    stopEngine?.(); stopEngine = undefined;
    mounted?.unmount(stage); mounted = undefined;
  }
  function mount(next: PptxSession) {
    const target = next.engine;
    target.mount(stage);
    mounted = target; session = next;
    icons = Object.fromEntries(ICON_IDS.map(id => { const [control, value] = id.split('='); return [id, target.icon(control as PptxControlId, value)]; }));
    stopEngine = target.subscribe(refresh);
    if (query.trim()) found = target.find(query.trim());
    refresh();
  }
  /** Follows the workspace's session for this tab: opening it, or reopening after a reload from disk replaced it. */
  let opening = false;
  async function sync() {
    // A deck that finished opening after its surface left is freed like any other unedited one.
    if (dead) { pptxSessions.evict(tabId); return; }
    pulse++;
    const current = pptxSessions.get(tabId);
    if (current && current.engine === mounted) return;
    if (mounted) { unmount(); session = undefined; view = EMPTY; }
    if (current) { error = ''; mount(current); return; }
    if (opening) return;
    opening = true;
    try { await pptxSessions.open(tabId); error = ''; }
    catch (cause) { if (!dead && !pptxSessions.get(tabId)) error = cause instanceof Error ? cause.message : String(cause); }
    finally { opening = false; }
    void sync();
  }

  /**
   * Editing starts at `slide`, with the keyboard on the stage: at `point` (fractions of the slide) when the reader
   * double-clicked a place, so the caret is in the text that was clicked. Reading resumes at the slide that was edited.
   */
  async function setMode(mode: 'view' | 'edit', slide?: number, point?: { x: number; y: number }) {
    const target = engine;
    if (!target) return;
    if (mode === 'edit' && slide !== undefined) target.goToSlide(slide);
    const at = view.slide;
    pptxSessions.setMode(tabId, mode);
    refresh();
    if (mode === 'view') {
      // The list is the reading surface again: it shows the slide that was edited and takes the keyboard for scrolling.
      reveal(at);
      await tick();
      if (!dead && !editing) list.focus({ preventScroll: true });
      return;
    }
    // The stage is shown by this update; before it, nothing in it can take the keyboard.
    await tick();
    if (dead || target !== engine || !editing) return;
    if (point) await target.press(point.x, point.y); else target.focus();
  }
  /** The slide at the middle of what the reading list shows: where "Edit presentation" starts. */
  function shownSlide() {
    const frame = list.getBoundingClientRect(), middle = frame.top + frame.height / 2;
    const boxes = [...list.querySelectorAll<HTMLElement>('.deck-slide')], at = boxes.findIndex(box => box.getBoundingClientRect().bottom >= middle);
    return at < 0 ? Math.max(0, boxes.length - 1) : at;
  }
  /** Where a pointer event is on the slide it happened on, as fractions of the slide. */
  const pointOn = (event: MouseEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };
  const run = (id: PptxControlId, value?: string | number) => { engine?.run(id, value); engine?.focus(); };
  const slide = (action: 'add' | 'duplicate' | 'delete') => { engine?.slide(action); engine?.focus(); };
  /** What is added is selected by the engine: a new text box holds the caret, ready for typing. */
  const insert = (what: PptxInsert) => { problem = engine?.insert(what) === false ? 'This could not be added to the slide.' : ''; engine?.focus(); };
  /** A picture file goes into the slide as it is, at its own size in pixels. */
  async function insertPicture(file: File | undefined) {
    const target = engine;
    if (!file || !target) return;
    try {
      const bitmap = await createImageBitmap(file), { width, height } = bitmap;
      bitmap.close();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (target === engine && editing) insert({ kind: 'picture', bytes, mime: file.type, width, height });
    } catch { problem = `"${file.name}" is not a picture that can be added to a slide.`; }
  }
  function show(index: number) { if (!editing) return; engine?.goToSlide(index); engine?.focus(); }
  function search(direction: 1 | -1 | 0) {
    if (!engine) return;
    found = direction === 0 || !found.count ? engine.find(query.trim()) : engine.findStep(direction);
    if (found.slide >= 0) reveal(found.slide);
  }
  /** Leaving the find field returns the keyboard to what is being read or edited. */
  function closeFind() { query = ''; engine?.clearFind(); found = NO_MATCH; if (editing) engine?.focus(); else list.focus({ preventScroll: true }); }
  /** Toolbar buttons must not take focus, or the stage loses its caret before the command runs. */
  const keepCaret = (event: MouseEvent) => { if (!(event.target as Element).closest('input, select')) event.preventDefault(); };
  /**
   * Shows a slide in a box. The engine paints the boxes in sight first and the others while the browser is idle.
   * A box is first asked for once the deck is ready: the engine paints a new box at once, but brings a painted one up
   * to date only when idle, so a box painted before the fonts arrived would open showing the stand-in face.
   */
  function picture(node: HTMLElement, index: number) {
    let at = index, stop: (() => void) | undefined;
    const paint = () => { if (view.ready) stop = mounted?.paint(at, node); };
    pictures.add(paint); paint();
    return {
      update(next: number) { at = next; paint(); },
      destroy() { pictures.delete(paint); stop?.(); },
    };
  }
  /** While reading, a click on a link follows it: a web address in a browser tab, a slide of the deck by showing it. */
  function follow(event: MouseEvent, index: number) {
    if (editing || event.detail > 1 || event.button !== 0 || !engine) return;
    const at = pointOn(event), href = engine.linkAt(index, at.x, at.y);
    if (!href) return;
    const slide = /^#slide-(\d+)$/.exec(href);
    if (slide) reveal(Number(slide[1]) - 1);
    else if (/^https?:\/\//i.test(href)) void desktop.openLink(href);
  }
  onMount(() => {
    const find = () => { if (active && focused) { findInput.focus(); findInput.select(); } };
    window.addEventListener('setdown:office-find', find);
    // Document content is untrusted: nothing a slide draws navigates this window or opens another one.
    const contain = (event: MouseEvent) => {
      const anchor = event.composedPath().find((node): node is Element => node instanceof Element && node.localName === 'a');
      if (anchor && !(anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href') ?? '').startsWith('#')) event.preventDefault();
    };
    for (const type of ['click', 'auxclick'] as const) { list.addEventListener(type, contain, true); stage.addEventListener(type, contain, true); }
    for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart'])
      list.addEventListener(type, () => { interacted = true; }, { capture: true, passive: true });
    list.addEventListener('scroll', remember, { passive: true });
    const stopSessions = pptxSessions.subscribe(() => { void sync(); });
    void sync();
    return () => {
      dead = true; stopSessions();
      window.removeEventListener('setdown:office-find', find);
      unmount(); pptxSessions.evict(tabId);
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="office-surface deck-surface" class:inactive={!active} inert={!active} aria-hidden={!active}
  aria-label="Presentation" data-office-family="presentation" data-office-ready={view.ready} data-pptx-mode={view.mode}
  data-pptx-dirty={dirty} data-pptx-saving={busy} data-pptx-slides={view.slides.length} data-pptx-slide={view.slides.length ? view.slide + 1 : 0}
  onfocusin={onfocus} onpointerdown={onfocus}
  onkeydowncapture={(event) => {
    // Esc returns to reading at once, as it does for Markdown and a Word document, wherever the caret is: it is taken
    // before the engine, which would use it to step from a text box to its shape. Unsaved edits stay in the tab.
    // Esc that ends a composition belongs to the input method, and the search field closes itself.
    if (event.key !== 'Escape' || event.isComposing || !editing || (event.target as Element).closest('.deck-find')) return;
    event.preventDefault(); event.stopPropagation();
    void setMode('view');
  }}
  onkeydown={(event) => {
    if (event.isComposing || event.defaultPrevented || !editing || !(event.target as Element).closest('.deck-stage')) return;
    if (view.selection === 'text' || event.ctrlKey || event.metaKey || event.altKey) return;
    const step = event.key === 'PageDown' ? 1 : event.key === 'PageUp' ? -1 : 0, target = view.slide + step;
    if (step && target >= 0 && target < view.slides.length) { event.preventDefault(); show(target); }
  }}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="deck-toolbar" role="toolbar" aria-label="Presentation tools" tabindex="-1" onmousedown={keepCaret}>
    {#if editing}
      <div class="deck-group">
        {#each PPTX_HISTORY as item (item.id)}
          <button type="button" class="deck-icon" title={item.label} aria-label={item.label} disabled={!control(item.id).enabled} onclick={() => run(item.id)}>
            <svg viewBox="0 -960 960 960" aria-hidden="true">{#each icons[item.id] ?? [] as path}<path d={path} />{/each}</svg>
          </button>
        {/each}
      </div>
      <div class="deck-group">
        <select aria-label="Font size" title="Font size" disabled={!control('font.size').enabled} value={view.fontSize === null ? '' : String(view.fontSize)}
          onchange={(event) => { if (event.currentTarget.value) run('font.size', Number(event.currentTarget.value)); }}>
          {#if view.fontSize === null || !PPTX_FONT_SIZES.includes(view.fontSize as (typeof PPTX_FONT_SIZES)[number])}<option value={view.fontSize === null ? '' : String(view.fontSize)}>{view.fontSize ?? 'Size'}</option>{/if}
          {#each PPTX_FONT_SIZES as size (size)}<option value={String(size)}>{size}</option>{/each}
        </select>
      </div>
      <div class="deck-group">
        {#each PPTX_TOGGLES as item (item.id)}
          {@const state = control(item.id)}
          <button type="button" class="deck-icon" title={item.label} aria-label={item.label} aria-pressed={state.active} disabled={!state.enabled} onclick={() => run(item.id)}>
            <svg viewBox="0 -960 960 960" aria-hidden="true">{#each icons[item.id] ?? [] as path}<path d={path} />{/each}</svg>
          </button>
        {/each}
      </div>
      <div class="deck-group">
        {#each PPTX_ALIGNMENTS as item (item.value)}
          <button type="button" class="deck-icon" title={item.label} aria-label={item.label} aria-pressed={view.align === item.value} disabled={!control('paragraph.align').enabled}
            onclick={() => run('paragraph.align', item.value)}>
            <svg viewBox="0 -960 960 960" aria-hidden="true">{#each icons[`paragraph.align=${item.value}`] ?? [] as path}<path d={path} />{/each}</svg>
          </button>
        {/each}
      </div>
      <div class="deck-group">
        {#each PPTX_LISTS as item (item.id)}
          {@const state = control(item.id)}
          <button type="button" class="deck-icon" title={item.label} aria-label={item.label} aria-pressed={state.active} disabled={!state.enabled} onclick={() => run(item.id)}>
            <svg viewBox="0 -960 960 960" aria-hidden="true">{#each icons[item.id] ?? [] as path}<path d={path} />{/each}</svg>
          </button>
        {/each}
      </div>
      <div class="deck-group">
        <button type="button" title="Add a text box to this slide" disabled={view.damaged} onclick={() => insert({ kind: 'textBox' })}>Text box</button>
        <select aria-label="Insert shape" title="Add a shape or a line to this slide" disabled={view.damaged} value=""
          onchange={(event) => { const choice = PPTX_SHAPES.find(item => item.id === event.currentTarget.value); event.currentTarget.value = ''; if (choice) insert(choice.insert); }}>
          <option value="">Shape</option>
          {#each PPTX_SHAPES as item (item.id)}<option value={item.id}>{item.label}</option>{/each}
        </select>
        <button type="button" title="Insert a 3 × 3 table" disabled={view.damaged} onclick={() => insert({ kind: 'table', rows: 3, columns: 3 })}>Table</button>
        <button type="button" title="Add a picture file to this slide" disabled={view.damaged} onclick={() => pictureInput.click()}>Picture…</button>
        <input bind:this={pictureInput} type="file" accept={PPTX_PICTURE_TYPES} hidden aria-label="Picture file"
          onchange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void insertPicture(file); }} />
      </div>
      <div class="deck-group">
        <button type="button" title="Add a slide after this one" disabled={view.damaged} onclick={() => slide('add')}>New slide</button>
        <button type="button" title="Copy this slide" disabled={view.damaged} onclick={() => slide('duplicate')}>Duplicate</button>
        <button type="button" title="Delete this slide" disabled={view.damaged || view.slides.length < 2} onclick={() => slide('delete')}>Delete</button>
      </div>
    {:else}
      <button type="button" class="deck-primary" disabled={!view.ready} onclick={() => setMode('edit', shownSlide())}>Edit presentation</button>
      <span class="deck-name">{file.name}</span>
    {/if}
    <div class="deck-trailing">
    {#if view.slides.length}<span class="deck-count" aria-label="Slide">{editing ? `${view.slide + 1} / ${view.slides.length}` : `${view.slides.length} ${view.slides.length === 1 ? 'slide' : 'slides'}`}</span>{/if}
    <div class="deck-group deck-find" role="search">
      <input bind:this={findInput} type="search" placeholder="Search presentation" aria-label="Search presentation" disabled={!view.ready} bind:value={query}
        oninput={() => search(0)}
        onkeydown={(event) => {
          if (event.isComposing) return;
          if (event.key === 'Enter') { event.preventDefault(); search(event.shiftKey ? -1 : 1); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFind(); }
        }} />
      {#if query.trim()}<span class="deck-count" role="status">{found.count ? `${found.index + 1}/${found.count}` : '0/0'}</span>{/if}
      <button type="button" class="deck-icon" title="Previous match (Shift+Enter)" aria-label="Previous match" disabled={!found.count} onclick={() => search(-1)}>‹</button>
      <button type="button" class="deck-icon" title="Next match (Enter)" aria-label="Next match" disabled={!found.count} onclick={() => search(1)}>›</button>
    </div>
    {#if editing}
      <div class="deck-group">
        <button type="button" class="deck-primary" disabled={!dirty || busy} onclick={() => pptxSessions.saveFromToolbar(tabId, false)}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={busy} onclick={() => pptxSessions.saveFromToolbar(tabId, true)}>Save As…</button>
        <button type="button" title="Return to reading (Esc)" onclick={() => setMode('view')}>Done</button>
      </div>
    {/if}
    </div>
  </div>
  {#if error}<p role="alert">Could not display this presentation. {error}</p>
  {:else if view.error}<p role="alert">Could not display this presentation. {view.error}</p>
  {:else if saveError}<p role="alert">Could not save this presentation. {saveError}</p>
  {:else if problem}<p role="alert">{problem}</p>
  {:else if view.damaged}<p role="alert">A slide of this presentation could not be read, so it cannot be saved.</p>{/if}
  {#if !view.ready && !error && !view.error}<p role="status">Opening presentation…</p>{/if}
  <div class="deck-body" class:editing class:opening={!view.ready} style:--deck-aspect={view.aspect} style:--deck-zoom={zoom}>
    <!-- While editing, a press beside the slides or beside the stage must not take the keyboard from the slide. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
    <div class="deck-slides" bind:this={list} role="list" aria-label="Slides" tabindex={editing ? undefined : 0}
      onmousedown={(event) => { if (editing) event.preventDefault(); }}>
      {#key session}
        {#each view.slides as item, index (item.key)}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div class="deck-slide" role="listitem" data-slide={index} aria-current={editing && index === view.slide ? 'true' : undefined}
            class:hidden-slide={item.hidden} class:found={!editing && found.slide === index}
            tabindex={editing ? 0 : undefined} aria-label={`Slide ${index + 1}${item.hidden ? ' (hidden)' : ''}`}
            onclick={(event) => { if (editing) show(index); else follow(event, index); }}
            ondblclick={(event) => { if (view.ready && !editing) void setMode('edit', index, pointOn(event)); }}
            onkeydown={(event) => { if (editing && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); show(index); } }}>
            <span class="deck-number" aria-hidden="true">{index + 1}</span>
            <div class="deck-picture" use:picture={index}></div>
          </div>
        {/each}
      {/key}
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="deck-stage" data-office-pages bind:this={stage} onmousedown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); engine?.focus(); } }}></div>
  </div>
</section>

<style>
  .deck-surface { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--app-canvas); color: var(--app-text); }
  .inactive { visibility: hidden; pointer-events: none; }
  .deck-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 5px 10px; border-bottom: 1px solid var(--app-border);
    background: var(--app-chrome); font-family: var(--app-font-family); font-size: 12px; outline: none; }
  .deck-group { display: flex; align-items: center; gap: 2px; }
  /* Slide counter, find and file actions stay together and move to their own right-aligned row when the pane is narrow. */
  .deck-trailing { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .deck-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-muted-text); }
  .deck-count { color: var(--app-muted-text); font-variant-numeric: tabular-nums; white-space: nowrap; }
  button, select, input { color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 3px; padding: 3px 7px; font: inherit; }
  button { cursor: pointer; }
  button:disabled, select:disabled, input:disabled { opacity: .45; cursor: default; }
  select { max-width: 150px; padding-right: 2px; }
  /* A menu of things to add always shows its name: it is as wide as that, not as its longest entry. */
  select[aria-label='Insert shape'] { width: 7em; }
  input { width: 150px; background: var(--app-raised-surface); }
  .deck-icon { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 24px; padding: 0; border-color: transparent; background: transparent; font-size: 15px; line-height: 1; }
  .deck-icon svg { width: 17px; height: 17px; fill: currentColor; }
  .deck-icon:hover:not(:disabled) { background: var(--app-surface); border-color: var(--app-border); }
  .deck-icon[aria-pressed="true"] { background: var(--app-surface); border-color: var(--app-text); }
  .deck-primary { font-weight: 600; }

  /* The application turns synthesized styles off for its own text. A slide needs them: a family without an italic
     or a bold face, as every Korean one is without an italic, is slanted and thickened by the browser. */
  .deck-body { flex: 1; min-height: 0; display: flex; font-synthesis: initial; }
  /* Slides laid out before the fonts arrived would jump when they land; they are shown in their final layout only. */
  .deck-body.opening { visibility: hidden; }
  /* Reading: every slide in one column, each as large as fits the pane, times the tab zoom. */
  .deck-slides { flex: 1; min-width: 0; overflow: auto; outline: none; container-type: size; display: flex; flex-direction: column; align-items: safe center; gap: 20px; padding: 20px 24px 32px; box-sizing: border-box; }
  .deck-slide { position: relative; flex: none; width: calc(min(100cqw - 48px, (100cqh - 52px) * var(--deck-aspect)) * var(--deck-zoom)); min-width: 120px;
    aspect-ratio: var(--deck-aspect); background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / .22); outline: none; }
  .deck-picture { position: absolute; inset: 0; overflow: hidden; }
  .deck-picture :global(svg) { display: block; }
  .deck-slide.found { box-shadow: 0 0 0 3px var(--app-accent, #3b82f6), 0 1px 4px rgb(0 0 0 / .22); }
  .deck-slide.hidden-slide .deck-picture { opacity: .45; }
  .deck-number { display: none; }
  .deck-stage { display: none; }
  /* Editing: the same list becomes the rail, and the slide being edited takes the stage beside it. */
  .editing .deck-slides { flex: none; width: 172px; container-type: normal; align-items: stretch; gap: 10px; padding: 10px 10px 16px 30px; border-right: 1px solid var(--app-border); background: var(--app-chrome); }
  .editing .deck-slide { width: auto; min-width: 0; cursor: pointer; }
  .editing .deck-slide[aria-current="true"] { box-shadow: 0 0 0 2px var(--app-accent, #3b82f6); }
  .editing .deck-slide:focus-visible { box-shadow: 0 0 0 2px var(--app-text); }
  .editing .deck-number { display: block; position: absolute; right: 100%; top: 0; margin-right: 6px; font-family: var(--app-font-family); font-size: 11px;
    color: var(--app-muted-text); font-variant-numeric: tabular-nums; }
  .editing .deck-stage { display: flex; flex: 1; min-width: 0; overflow: auto; container-type: size; }
  /* The engine shows the whole slide in the element it is given, inside a margin of its own. At 100% that element is the
     stage; the tab zoom scales the room left for the slide, and the stage scrolls what no longer fits. Everything inside
     is the engine's; only the area around the slide follows Setdown's canvas. */
  .deck-stage :global(.pptx-editor) { --doc-slide-padding: 24px; position: relative; flex: none; margin: auto; background: var(--app-canvas);
    width: calc((100cqw - 48px) * var(--deck-zoom) + 48px); height: calc((100cqh - 48px) * var(--deck-zoom) + 48px); }
  p { margin: 0; padding: 8px 16px; font-size: 12px; color: var(--app-muted-text); }
  p[role="status"] { position: absolute; inset: 44px auto auto 0; z-index: 1; pointer-events: none; }
  p[role="alert"] { color: var(--app-danger-text); border-bottom: 1px solid var(--app-border); }
</style>
