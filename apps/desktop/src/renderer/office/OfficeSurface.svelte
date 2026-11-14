<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { DocumentSnapshot } from '../../core/document/document';
  import { officeFamily } from '../../core/document/document-profile';
  import { normalizePreviewTheme } from '../../core/preview/preview-preferences';
  import { themeProfile } from '../../core/theme/theme-catalog';
  import type { OfficeReadingPosition, ReadingPosition } from '../../core/reading/reading-position';
  import type { OfficePort } from '../ports/desktop-port';
  import { zoomState } from '../zoom-state.svelte';
  import type { OfficeViewer } from './office-runtime';

  let { tabId, document: file, initialPosition, desktop, active, focused, onposition }: {
    tabId: string; document: DocumentSnapshot; initialPosition?: ReadingPosition; desktop: OfficePort; active: boolean; focused: boolean;
    onposition(position: OfficeReadingPosition): void;
  } = $props();
  const family = untrack(() => officeFamily(file.path));
  const initial = untrack(() => initialPosition?.kind === 'office' ? initialPosition : undefined);
  let last = initial ? `${initial.top}:${initial.left}:${initial.sheet}` : '';
  // Restoring a position and late layout also move the viewer's scroll. Only movement
  // after real input replaces the stored position, so reopening never drifts it.
  let interacted = false;
  function remember(position: OfficeReadingPosition) {
    if (!active || !ready || !interacted) return;
    const key = `${position.top.toFixed(4)}:${position.left.toFixed(4)}:${position.sheet}`;
    if (key !== last) { last = key; onposition(position); }
  }
  let host = $state<HTMLDivElement>() as HTMLDivElement;
  let viewer = $state<OfficeViewer>();
  let ready = $state(false);
  let error = $state('');
  // The zoom the viewer currently shows, as a tab percent; 100 is the viewer's own initial fit.
  let shown = 100;
  const appearance = () => themeProfile(normalizePreviewTheme(window.document.documentElement.dataset.theme)).appearance;

  $effect(() => {
    const percent = zoomState.tabs?.[tabId] ?? 100;
    if (!viewer || !ready || percent === shown) return;
    const ratio = percent / shown;
    shown = percent;
    void viewer.scaleBy(ratio);
  });
  onMount(() => {
    let dead = false;
    let mounted: OfficeViewer | undefined;
    let current = appearance();
    const themes = new MutationObserver(() => {
      const next = appearance();
      // Re-rendering restarts at the viewer's own fit, so the tab zoom is applied again.
      if (next !== current) { current = next; ready = false; shown = 100; mounted?.setAppearance(next); }
    });
    themes.observe(window.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // The viewer's own search box lives in its shadow root; slide decks drawn on canvas have none.
    const find = () => {
      if (!active || !focused) return;
      const input = host.shadowRoot?.querySelector<HTMLInputElement>('[part~="input"]');
      input?.focus(); input?.select();
    };
    window.addEventListener('setdown:office-find', find);
    // Document content is untrusted: a link never navigates this window or opens another one.
    // Web links go to a Setdown browser tab; bookmarks inside the document stay with the viewer.
    const link = (event: MouseEvent) => {
      const anchor = event.composedPath().find((node): node is Element => node instanceof Element && node.localName === 'a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href') ?? '';
      const target = anchor.getAttribute('target') ?? '';
      if (href.startsWith('#') && (!target || target === '_self')) return;
      event.preventDefault();
      if (event.type === 'click' && /^https?:\/\//i.test(href)) void desktop.openLink(href);
    };
    host.addEventListener('click', link, true);
    host.addEventListener('auxclick', link, true);
    for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart'])
      host.addEventListener(type, () => { interacted = true; }, { capture: true, passive: true });
    void (async () => {
      try {
        if (!family) throw new Error('Unsupported Office format.');
        const [bytes, runtime] = await Promise.all([desktop.readOfficeBytes(file.path, { ...file.diskVersion }), import('./office-runtime')]);
        if (dead) return;
        mounted = await runtime.mountOfficeViewer({ host, family, name: file.name, bytes, appearance: current, initial,
          onstate: state => { if (!dead) { ready = state.ready; error = state.error ?? ''; } },
          onposition: position => { if (!dead) remember(position); } });
        if (dead) mounted.destroy(); else viewer = mounted;
      } catch (cause) { if (!dead) error = cause instanceof Error ? cause.message : String(cause); }
    })();
    return () => { dead = true; themes.disconnect(); window.removeEventListener('setdown:office-find', find); mounted?.destroy(); };
  });
</script>

<section class="office-surface" class:inactive={!active} inert={!active} aria-hidden={!active}
  aria-label="Office document reader" data-office-family={family} data-office-ready={ready}>
  {#if error}<p role="alert">Could not display this document. {error}</p>{/if}
  {#if !ready && !error}<p role="status">Opening document…</p>{/if}
  <div class="office-host" bind:this={host}></div>
</section>

<style>
  .office-surface { grid-column: 2; grid-row: 3; position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--app-canvas); }
  .inactive { visibility: hidden; pointer-events: none; }
  .office-host { flex: 1; min-height: 0; position: relative; overflow: hidden; }
  p { margin: 0; padding: 12px 16px; font-size: 12px; color: var(--app-muted-text); }
  p[role="status"] { position: absolute; inset: 0 auto auto 0; z-index: 1; pointer-events: none; }
  p[role="alert"] { color: var(--app-danger-text); border-bottom: 1px solid var(--app-border); }
  /* The viewer keeps its own shadow tree; only its exported parts take Setdown's chrome colours. */
  .office-host::part(toolbar) { border-bottom-color: var(--app-border); background: var(--app-chrome); font-family: var(--app-font-family); }
  .office-host::part(toolbar-group) { border-color: var(--app-border); background: transparent; }
  .office-host::part(input) { background: var(--app-raised-surface); color: var(--app-text); }
  .office-host::part(button), .office-host::part(toolbar-status) { color: var(--app-muted-text); font-weight: 500; }
</style>
