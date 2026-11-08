<script lang="ts">
  import { onMount, untrack, flushSync } from 'svelte';
  import type { GitDiff } from '../../../protocol/desktop-api';
  import { ContentZoomInput } from '../../../core/wheel-zoom';
  import { TabZoom } from '../../editor/tab-zoom';
  import { textZoomFactor } from '../../editor/text-zoom';
  import { electronDesktop } from '../../adapters/electron-desktop';
  import GitImageVersion from './GitImageVersion.svelte';
  let { diff, tabId, onfocus }: { diff: GitDiff; tabId: string; onfocus(): void } = $props();
  let zoom = $state<string | number>(untrack(() => textZoomFactor(tabId)));
  let scale = $state(untrack(() => textZoomFactor(tabId)));
  let host: HTMLElement;
  type Anchor = 'fit' | { canvas: HTMLElement; image: HTMLImageElement; x: number; y: number; pointX: number; pointY: number };
  let tabZoom: TabZoom<Anchor>;
  const wheelZoom = new ContentZoomInput();
  function fit() {
    if (zoom !== 'fit' || !host || !tabZoom) return;
    const ratios = [...host.querySelectorAll<HTMLImageElement>('.image-canvas img')].filter(image => image.naturalWidth).map(image => {
      const bounds = image.parentElement!.getBoundingClientRect();
      return Math.min(1, Math.max(1, bounds.width - 24) / image.naturalWidth, Math.max(1, bounds.height - 24) / image.naturalHeight);
    });
    if (ratios.length) tabZoom.change({ percent: Math.min(...ratios) * 100 }, 'fit');
  }
  function changeZoom(value: string) {
    onfocus();
    if (value === 'fit') { zoom = 'fit'; fit(); }
    else { zoom = Number(value); tabZoom.change({ percent: zoom * 100 }); }
  }
  function wheel(event: WheelEvent) {
    if (!event.isTrusted || !event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.image-canvas') : null;
    const image = target?.querySelector('img');
    if (!target || !image) return;
    event.preventDefault(); event.stopPropagation(); onfocus();
    const steps = wheelZoom.consume(event, performance.now());
    if (!steps) return;
    const rect = image.getBoundingClientRect();
    tabZoom.change(steps, { canvas: target, image, x: event.clientX, y: event.clientY,
      pointX: (event.clientX - rect.left) / scale, pointY: (event.clientY - rect.top) / scale });
  }
  onMount(() => {
    tabZoom = new TabZoom(tabId, electronDesktop, (factor, anchor) => {
      flushSync(() => { scale = factor; if (anchor !== 'fit') zoom = factor; });
      if (anchor && anchor !== 'fit') {
        const rect = anchor.image.getBoundingClientRect();
        anchor.canvas.scrollLeft += rect.left + anchor.pointX * factor - anchor.x;
        anchor.canvas.scrollTop += rect.top + anchor.pointY * factor - anchor.y;
      }
    });
    const observer = new ResizeObserver(fit); observer.observe(host);
    host.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); tabZoom.dispose(); host.removeEventListener('wheel', wheel); };
  });
</script>

<section class="git-image-diff" aria-label="Image comparison" bind:this={host}>
  <div class="image-toolbar">
    <label>Zoom <select aria-label="Image comparison zoom" value={String(zoom)} onchange={event => changeZoom(event.currentTarget.value)} onfocus={onfocus}>
      {#if typeof zoom === 'number' && ![.5, 1, 2].includes(zoom)}<option value={String(zoom)}>{Math.round(zoom * 100)}%</option>{/if}
      <option value="fit">Fit</option><option value="0.5">50%</option><option value="1">100%</option><option value="2">200%</option>
    </select></label>
  </div>
  <div class="image-pair">
    <GitImageVersion version={diff.images!.original} label={diff.originalLabel} side="Original" {scale} {onfocus} onload={fit} />
    <GitImageVersion version={diff.images!.modified} label={diff.modifiedLabel} side="Modified" {scale} {onfocus} onload={fit} />
  </div>
</section>

<style>
  .git-image-diff { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--app-editor-background); }
  .image-toolbar { display: flex; justify-content: flex-end; padding: 4px 10px; border-bottom: 1px solid var(--app-border); font-size: 12px; }
  label { display: flex; align-items: center; gap: 6px; color: var(--app-muted-text); }
  select { color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 3px; font: inherit; }
  .image-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); flex: 1; min-width: 0; min-height: 0; }
</style>
