<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { DocumentSnapshot } from '../../core/document/document';
  import { normalizePreviewTheme } from '../../core/preview/preview-preferences';
  import { themeProfile } from '../../core/theme/theme-catalog';
  import type { OfficeReadingPosition, ReadingPosition } from '../../core/reading/reading-position';
  import type { DocxPort } from '../ports/desktop-port';
  import { zoomState } from '../zoom-state.svelte';
  import { DOCX_ALIGNMENTS, DOCX_CONTROL_IDS, DOCX_EXTRAS, DOCX_FONT_SIZES, DOCX_HISTORY, DOCX_LISTS, DOCX_SCRIPTS, DOCX_TOGGLES,
    type DocxControlId, type DocxControlState, type DocxEngine, type DocxFind, type DocxLink, type DocxStyle, type DocxView } from './docx-engine';
  import { docxSessions, type DocxSession } from './docx-sessions';

  let { tabId, document: file, initialPosition, desktop, active, focused, onfocus, onposition }: {
    tabId: string; document: DocumentSnapshot; initialPosition?: ReadingPosition; desktop: DocxPort; active: boolean; focused: boolean;
    onfocus(): void; onposition(position: OfficeReadingPosition): void;
  } = $props();
  const initial = untrack(() => initialPosition?.kind === 'office' ? initialPosition : undefined);
  const EMPTY: DocxView = { ready: false, error: null, mode: 'view', page: 0, pages: 0, canUndo: false, canRedo: false, fontSize: null, styleId: null };

  let host = $state<HTMLDivElement>() as HTMLDivElement;
  let findInput = $state<HTMLInputElement>() as HTMLInputElement;
  let session = $state.raw<DocxSession>();
  let view = $state.raw<DocxView>(EMPTY);
  // Reading the engine can flush pending input and emit a change, so it is only read in
  // `refresh`, never from a template expression or a derived value.
  let controls = $state.raw<Partial<Record<DocxControlId, DocxControlState>>>({});
  let styles = $state.raw<readonly DocxStyle[]>([]);
  let icons = $state.raw<Partial<Record<DocxControlId, readonly string[]>>>({});
  /** Bumped whenever the session reports a change (dirty, saving, error). */
  let pulse = $state(0);
  let error = $state('');
  let query = $state('');
  let found = $state.raw<DocxFind>({ count: 0, index: -1 });
  let link = $state.raw<DocxLink>();
  let scroller: HTMLElement | undefined;
  let mounted: DocxEngine | undefined;
  let dead = false;
  // Restoring a position and late pagination also move the scroller. Only movement
  // after real input replaces the stored position, so reopening never drifts it.
  let interacted = false;
  let restored = -1;
  let last = initial ? `${initial.top.toFixed(4)}:${initial.left.toFixed(4)}` : '';
  /** The tab zoom the engine currently shows; 100 is its own page-width fit. */
  let shown = 100, base = 1;

  const engine = $derived(session?.engine);
  const editing = $derived(view.mode === 'edit');
  const dirty = $derived.by(() => { void pulse; return !!session && session.edits !== session.savedEdits; });
  const busy = $derived.by(() => { void pulse; return !!session?.busy; });
  const saveError = $derived.by(() => { void pulse; return session?.error ?? ''; });
  const control = (id: DocxControlId): DocxControlState => controls[id] ?? { enabled: false, active: false };
  const appearance = () => themeProfile(normalizePreviewTheme(window.document.documentElement.dataset.theme)).appearance;
  const ratio = (offset: number, range: number) => range > 0 ? Math.min(1, Math.max(0, offset / range)) : 0;

  function remember() {
    if (!active || !view.ready || !interacted || !scroller) return;
    const top = ratio(scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight);
    const left = ratio(scroller.scrollLeft, scroller.scrollWidth - scroller.clientWidth);
    const key = `${top.toFixed(4)}:${left.toFixed(4)}`;
    if (key !== last) { last = key; onposition({ kind: 'office', top, left }); }
  }
  /** Pages keep arriving while a long document lays out, so the stored ratio is applied again until the reader moves. */
  function restore() {
    if (!initial || interacted || !scroller || !view.ready || restored === view.pages) return;
    restored = view.pages;
    scroller.scrollTop = initial.top * (scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollLeft = initial.left * (scroller.scrollWidth - scroller.clientWidth);
  }
  function zoom(percent: number) {
    if (!engine || !view.ready || percent === shown) return;
    if (percent === 100) engine.setScale('fit');
    else { if (shown === 100) base = engine.scale(); engine.setScale(base * percent / 100); }
    shown = percent;
  }
  function refresh() {
    if (dead || !mounted) return;
    const next = mounted.view(), states: Partial<Record<DocxControlId, DocxControlState>> = {};
    if (next.mode === 'edit') for (const id of DOCX_CONTROL_IDS) states[id] = mounted.control(id);
    view = next; controls = states; styles = next.mode === 'edit' ? mounted.styles() : [];
    restore();
  }
  function unmount() {
    stopEngine?.(); stopEngine = undefined;
    scroller?.removeEventListener('scroll', remember);
    mounted?.unmount(host); mounted = undefined; scroller = undefined;
    link = undefined;
  }
  let stopEngine: (() => void) | undefined;
  function mount(next: DocxSession) {
    const target = next.engine;
    target.setAppearance(appearance());
    scroller = target.mount(host, { focus: false });
    scroller.addEventListener('scroll', remember, { passive: true });
    mounted = target; session = next;
    icons = Object.fromEntries(DOCX_CONTROL_IDS.map(id => [id, target.icon(id)]));
    // A remounted engine starts from its own fit; the tab zoom is applied again once it is ready.
    shown = 100; target.setScale('fit');
    const stops = [target.subscribe(refresh), target.onLink(activated => {
      if (!/^https?:\/\//i.test(activated.href)) return;
      // Reading follows a link at once. While editing, a click places the caret and the link is offered instead.
      if (target.view().mode === 'view') void desktop.openLink(activated.href); else link = activated;
    })];
    stopEngine = () => { for (const stop of stops) stop(); };
    if (query) found = target.find(query);
    refresh();
  }
  /** Follows the workspace's session for this tab: opening it, or reopening after a reload from disk replaced it. */
  let opening = false;
  async function sync() {
    // A document that finished opening after its surface left is freed like any other unedited one.
    if (dead) { docxSessions.evict(tabId); return; }
    pulse++;
    const current = docxSessions.get(tabId);
    if (current && current.engine === mounted) return;
    if (mounted) { unmount(); session = undefined; view = EMPTY; }
    if (current) { error = ''; mount(current); return; }
    if (opening) return;
    opening = true;
    try { await docxSessions.open(tabId); error = ''; }
    catch (cause) { if (!dead && !docxSessions.get(tabId)) error = cause instanceof Error ? cause.message : String(cause); }
    finally { opening = false; }
    void sync();
  }

  function setMode(mode: 'view' | 'edit') {
    link = undefined;
    docxSessions.setMode(tabId, mode);
    refresh();
    if (mode === 'edit') engine?.focus();
  }
  const run = (id: DocxControlId, value?: string | number) => { engine?.run(id, value); engine?.focus(); };
  function search(direction: 1 | -1 | 0) {
    if (!engine) return;
    found = direction === 0 || !found.count ? engine.find(query.trim()) : engine.findStep(direction);
  }
  function closeFind() { query = ''; engine?.clearFind(); found = { count: 0, index: -1 }; engine?.focus(); }
  /** Toolbar buttons must not take focus, or the pages lose their caret before the command runs. */
  const keepCaret = (event: MouseEvent) => { if (!(event.target as Element).closest('input, select')) event.preventDefault(); };

  $effect(() => { const percent = zoomState.tabs?.[tabId] ?? 100; void view.ready; zoom(percent); });
  onMount(() => {
    let current = appearance();
    const themes = new MutationObserver(() => {
      const next = appearance();
      if (next !== current) { current = next; mounted?.setAppearance(next); }
    });
    themes.observe(window.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const find = () => { if (active && focused) { findInput.focus(); findInput.select(); } };
    window.addEventListener('setdown:office-find', find);
    // Document content is untrusted: a painted link never navigates this window or opens another one.
    const contain = (event: MouseEvent) => {
      const anchor = event.composedPath().find((node): node is Element => node instanceof Element && node.localName === 'a');
      if (anchor && !(anchor.getAttribute('href') ?? '').startsWith('#')) event.preventDefault();
    };
    host.addEventListener('click', contain, true);
    host.addEventListener('auxclick', contain, true);
    for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart'])
      host.addEventListener(type, () => { interacted = true; }, { capture: true, passive: true });
    const dismiss = (event: Event) => { if (link && !(event.target as Element | null)?.closest?.('.word-link')) link = undefined; };
    window.addEventListener('pointerdown', dismiss, true);
    const stopSessions = docxSessions.subscribe(() => { void sync(); });
    void sync();
    return () => {
      dead = true; themes.disconnect(); stopSessions();
      window.removeEventListener('setdown:office-find', find); window.removeEventListener('pointerdown', dismiss, true);
      unmount(); docxSessions.evict(tabId);
    };
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="office-surface word-surface" class:inactive={!active} inert={!active} aria-hidden={!active}
  aria-label="Word document" data-office-family="word" data-office-ready={view.ready} data-docx-mode={view.mode}
  data-docx-dirty={dirty} data-docx-saving={busy} data-docx-pages={view.pages}
  onfocusin={onfocus} onpointerdown={onfocus}
  onkeydown={(event) => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
    if (link) { link = undefined; return; }
    // Esc returns to reading, as it does for Markdown. Unsaved edits stay in the tab.
    if (editing && (event.target as Element).closest('.word-host')) { event.stopPropagation(); setMode('view'); }
  }}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="word-toolbar" role="toolbar" aria-label="Word document tools" tabindex="-1" onmousedown={keepCaret}>
    {#if editing}
      <div class="word-group">
        {#each DOCX_HISTORY as item (item.id)}
          <button type="button" class="word-icon" title={item.label} aria-label={item.label} disabled={!control(item.id).enabled} onclick={() => run(item.id)}>
            <svg viewBox="0 -960 960 960" aria-hidden="true">{#each icons[item.id] ?? [] as path}<path d={path} />{/each}</svg>
          </button>
        {/each}
      </div>
      <div class="word-group">
        <select aria-label="Paragraph style" title="Paragraph style" disabled={!control('styles.style').enabled} value={view.styleId ?? ''}
          onchange={(event) => { if (event.currentTarget.value) run('styles.style', event.currentTarget.value); }}>
          {#if !styles.some(style => style.id === view.styleId)}<option value="">Style</option>{/if}
          {#each styles as style (style.id)}<option value={style.id}>{style.name}</option>{/each}
        </select>
        <select aria-label="Font size" title="Font size" disabled={!control('font.size').enabled} value={view.fontSize === null ? '' : String(view.fontSize)}
          onchange={(event) => { if (event.currentTarget.value) run('font.size', Number(event.currentTarget.value)); }}>
          {#if view.fontSize === null || !DOCX_FONT_SIZES.includes(view.fontSize as (typeof DOCX_FONT_SIZES)[number])}<option value={view.fontSize === null ? '' : String(view.fontSize)}>{view.fontSize ?? 'Size'}</option>{/if}
          {#each DOCX_FONT_SIZES as size (size)}<option value={String(size)}>{size}</option>{/each}
        </select>
      </div>
      {#each [DOCX_TOGGLES, DOCX_SCRIPTS, DOCX_ALIGNMENTS, DOCX_LISTS, DOCX_EXTRAS] as group}
        <div class="word-group">
          {#each group as item (item.id)}
            {@const state = control(item.id)}
            <button type="button" class="word-icon" title={item.label} aria-label={item.label} aria-pressed={state.active} disabled={!state.enabled} onclick={() => run(item.id)}>
              <svg viewBox="0 -960 960 960" aria-hidden="true">{#each icons[item.id] ?? [] as path}<path d={path} />{/each}</svg>
            </button>
          {/each}
        </div>
      {/each}
      <div class="word-group">
        <button type="button" title="Insert a 3 × 3 table" disabled={!control('table.insert').enabled} onclick={() => { engine?.insertTable(3, 3); engine?.focus(); }}>Table</button>
      </div>
    {:else}
      <button type="button" class="word-primary" disabled={!view.ready} onclick={() => setMode('edit')}>Edit document</button>
      <span class="word-name">{file.name}</span>
    {/if}
    <div class="word-trailing">
    {#if view.pages}<span class="word-pages" aria-label="Page">{view.page} / {view.pages}</span>{/if}
    <div class="word-group word-find" role="search">
      <input bind:this={findInput} type="search" placeholder="Search document" aria-label="Search document" disabled={!view.ready} bind:value={query}
        oninput={() => search(0)}
        onkeydown={(event) => {
          if (event.isComposing) return;
          if (event.key === 'Enter') { event.preventDefault(); search(event.shiftKey ? -1 : 1); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFind(); }
        }} />
      {#if query.trim()}<span class="word-count" role="status">{found.count ? `${found.index + 1}/${found.count}` : '0/0'}</span>{/if}
      <button type="button" class="word-icon" title="Previous match (Shift+Enter)" aria-label="Previous match" disabled={!found.count} onclick={() => search(-1)}>‹</button>
      <button type="button" class="word-icon" title="Next match (Enter)" aria-label="Next match" disabled={!found.count} onclick={() => search(1)}>›</button>
    </div>
    {#if editing}
      <div class="word-group">
        <button type="button" class="word-primary" disabled={!dirty || busy} onclick={() => docxSessions.saveFromToolbar(tabId, false)}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={busy} onclick={() => docxSessions.saveFromToolbar(tabId, true)}>Save As…</button>
        <button type="button" title="Return to reading (Esc)" onclick={() => setMode('view')}>Done</button>
      </div>
    {/if}
    </div>
  </div>
  {#if error}<p role="alert">Could not display this document. {error}</p>
  {:else if view.error}<p role="alert">Could not display this document. {view.error}</p>
  {:else if saveError}<p role="alert">Could not save this document. {saveError}</p>{/if}
  {#if !view.ready && !error && !view.error}<p role="status">Opening document…</p>{/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="word-host" bind:this={host} ondblclick={() => { if (view.ready && !editing) setMode('edit'); }}></div>
  {#if link}
    <div class="word-link" role="dialog" aria-label="Link" style:left={`${link.left}px`} style:top={`${link.bottom + 4}px`}>
      <span title={link.href}>{link.href}</span>
      <button type="button" onclick={() => { const href = link!.href; link = undefined; void desktop.openLink(href); }}>Open link</button>
    </div>
  {/if}
</section>

<style>
  .word-surface { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--app-canvas); color: var(--app-text); }
  .inactive { visibility: hidden; pointer-events: none; }
  .word-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 5px 10px; border-bottom: 1px solid var(--app-border);
    background: var(--app-chrome); font-family: var(--app-font-family); font-size: 12px; outline: none; }
  .word-group { display: flex; align-items: center; gap: 2px; }
  /* Page counter, find and file actions stay together and move to their own right-aligned row when the pane is narrow. */
  .word-trailing { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .word-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-muted-text); }
  .word-pages, .word-count { color: var(--app-muted-text); font-variant-numeric: tabular-nums; white-space: nowrap; }
  button, select, input { color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 3px; padding: 3px 7px; font: inherit; }
  button { cursor: pointer; }
  button:disabled, select:disabled, input:disabled { opacity: .45; cursor: default; }
  select { max-width: 150px; padding-right: 2px; }
  input { width: 150px; background: var(--app-raised-surface); }
  .word-icon { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 24px; padding: 0; border-color: transparent; background: transparent; font-size: 15px; line-height: 1; }
  .word-icon svg { width: 17px; height: 17px; fill: currentColor; }
  .word-icon:hover:not(:disabled) { background: var(--app-surface); border-color: var(--app-border); }
  .word-icon[aria-pressed="true"] { background: var(--app-surface); border-color: var(--app-text); }
  .word-primary { font-weight: 600; }
  .word-host { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; overflow: hidden; }
  /* The engine owns everything below its viewport; only the frame around the pages follows Setdown's canvas. */
  .word-host :global(.docx-editor__scroll-container) { flex: 1; min-height: 0; padding: 20px 0 32px; box-sizing: border-box; background: var(--app-canvas); }
  p { margin: 0; padding: 8px 16px; font-size: 12px; color: var(--app-muted-text); }
  p[role="status"] { position: absolute; inset: 44px auto auto 0; z-index: 1; pointer-events: none; }
  p[role="alert"] { color: var(--app-danger-text); border-bottom: 1px solid var(--app-border); }
  .word-link { position: fixed; z-index: 20; display: flex; align-items: center; gap: 8px; max-width: min(420px, 80vw); padding: 5px 8px;
    border: 1px solid var(--app-border); border-radius: 4px; background: var(--app-raised-surface); box-shadow: 0 4px 14px rgb(0 0 0 / .18); font-size: 12px; }
  .word-link span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
