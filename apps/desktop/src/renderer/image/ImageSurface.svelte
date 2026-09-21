<script lang="ts">
  import { onMount, tick, untrack, flushSync } from 'svelte';
  import { WheelZoomAccumulator } from '../../core/wheel-zoom';
  import type { DocumentSnapshot } from '../../core/document/document';
  import { imageMimeType } from '../../core/document/document-profile';
  import type { ReadingPosition, ImageReadingPosition } from '../../core/reading/reading-position';
  import type { DesktopPort } from '../ports/desktop-port';

  let { document: file, initialPosition, desktop, onposition, active }: {
    document: DocumentSnapshot; initialPosition?: ReadingPosition; desktop: DesktopPort; active: boolean;
    onposition(position: ImageReadingPosition): void;
  } = $props();
  const initial = untrack(() => initialPosition?.kind === 'image' ? initialPosition : undefined);
  let zoom = $state<ImageReadingPosition['zoom']>(initial?.zoom ?? 'fit');
  let rotation = $state(initial?.rotation ?? 0);
  let centerX = initial?.centerX ?? .5;
  let centerY = initial?.centerY ?? .5;
  let src = $state('');
  let error = $state('');
  let width = $state(0);
  let height = $state(0);
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);
  let host: HTMLDivElement;
  let dead = false;
  let adjusting = false;
  let layoutRequest = 0;
  let needsResize = false;
  let drag: { x: number; y: number; left: number; top: number } | undefined;
  const rotatedWidth = $derived(rotation % 180 ? height : width);
  const rotatedHeight = $derived(rotation % 180 ? width : height);
  const scale = $derived(zoom === 'fit-width' ? Math.max(1, viewportWidth - 32) / (rotatedWidth || 1) : zoom === 'fit' ? Math.min(1, Math.max(1, viewportWidth - 32) / (rotatedWidth || 1),
    Math.max(1, viewportHeight - 32) / (rotatedHeight || 1)) : zoom);
  const stageWidth = $derived(Math.max(viewportWidth, rotatedWidth * scale + 32));
  const stageHeight = $derived(Math.max(viewportHeight, rotatedHeight * scale + 32));

  function remember() {
    if (!active || !src || adjusting || dead) return;
    centerX = (host.scrollLeft + host.clientWidth / 2) / stageWidth;
    centerY = (host.scrollTop + host.clientHeight / 2) / stageHeight;
    onposition({ kind: 'image', zoom, rotation, centerX, centerY });
  }
  async function layout() {
    if (!host || dead) return;
    const request = ++layoutRequest;
    adjusting = true;
    viewportWidth = host.clientWidth; viewportHeight = host.clientHeight;
    await tick();
    if (dead || request !== layoutRequest) return;
    host.scrollLeft = centerX * stageWidth - host.clientWidth / 2;
    host.scrollTop = centerY * stageHeight - host.clientHeight / 2;
    adjusting = false;
    remember();
  }
  function changeZoom(value: string) {
    remember(); zoom = value === 'fit' || value === 'fit-width' ? value : Number(value); void layout();
  }
  const wheelZoom = new WheelZoomAccumulator();
  function wheel(event: WheelEvent) {
    if (!event.isTrusted || !event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault(); event.stopPropagation();
    if (!active || !src || dead || adjusting) return;
    const steps = wheelZoom.consume(event, performance.now());
    if (!steps) return;
    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const pointX = (host.scrollLeft + x - stageWidth / 2) / scale;
    const pointY = (host.scrollTop + y - stageHeight / 2) / scale;
    const next = Math.max(.1, Math.min(8, scale * 1.1 ** steps));
    // Commit geometry before the next wheel sample; rapid trackpad events must
    // never combine a new scale with the previous frame's scroll offsets.
    flushSync(() => { zoom = next; });
    host.scrollLeft = pointX * scale + stageWidth / 2 - x;
    host.scrollTop = pointY * scale + stageHeight / 2 - y;
    remember();
  }
  function rotate() { remember(); rotation = (rotation + 90) % 360; centerX = centerY = .5; void layout(); }
  $effect(() => { if (active && needsResize) { needsResize = false; void layout(); } });

  onMount(() => {
    let url = '';
    host.addEventListener('wheel', wheel, { passive: false });
    const observer = new ResizeObserver(() => {
      if (active) void layout(); else needsResize = true;
    });
    observer.observe(host);
    void (async () => {
      try {
        const bytes = await desktop.readImageBytes(file.path, { ...file.diskVersion });
        if (dead) return;
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: imageMimeType(file.path) }));
        const image = new Image(); image.src = url;
        await image.decode();
        if (dead) return;
        width = image.naturalWidth; height = image.naturalHeight; src = url;
        await layout();
      } catch (cause) { if (!dead) error = cause instanceof Error ? cause.message : String(cause); }
    })();
    return () => { dead = true; host.removeEventListener('wheel', wheel); observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  });
</script>

<section class="image-surface" class:inactive={!active} inert={!active} aria-hidden={!active} aria-label="Image reader" data-image-ready={!!src}>
  <div class="image-toolbar">
    <span>{file.name}</span>
    <span class="image-dimensions">{#if width}{width} × {height}{/if}</span>
    <select aria-label="Image zoom" disabled={!src} value={String(zoom)} onchange={(event) => changeZoom(event.currentTarget.value)}>
      <option value="fit">Fit image</option><option value="fit-width">Fit width</option>
      {#if typeof zoom === 'number' && ![.1, .25, .5, .75, 1, 1.5, 2, 3, 4, 8].includes(zoom)}
        <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>
      {/if}
      {#each [.1, .25, .5, .75, 1, 1.5, 2, 3, 4, 8] as value}<option value={String(value)}>{value * 100}%</option>{/each}
    </select>
    <button type="button" disabled={!src} onclick={() => changeZoom('1')}>100%</button>
    <button type="button" disabled={!src} onclick={() => changeZoom('fit-width')}>Fit width</button>
    <button type="button" aria-label="Rotate image" disabled={!src} onclick={rotate}>↻</button>
  </div>
  <!-- The scrollable image region accepts keyboard scrolling as well as pointer panning. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="image-viewport" bind:this={host} onscroll={remember} role="region" aria-label="Image canvas" tabindex="0"
    onpointerdown={(event) => {
      if (event.button !== 0 || !src) return;
      drag = { x: event.clientX, y: event.clientY, left: host.scrollLeft, top: host.scrollTop };
      host.setPointerCapture(event.pointerId);
    }}
    onpointermove={(event) => { if (drag) { host.scrollLeft = drag.left + drag.x - event.clientX; host.scrollTop = drag.top + drag.y - event.clientY; } }}
    onpointerup={() => drag = undefined} onpointercancel={() => drag = undefined} onlostpointercapture={() => drag = undefined}>
    {#if src}
      <div class="image-stage" style:width={`${stageWidth}px`} style:height={`${stageHeight}px`}>
        <img {src} alt={file.name} draggable="false" style:width={`${width * scale}px`} style:height={`${height * scale}px`}
          style:transform={`translate(-50%, -50%) rotate(${rotation}deg)`} />
      </div>
    {:else if error}<p role="alert">Could not open this image. {error}</p>
    {:else}<p role="status">Opening image…</p>{/if}
  </div>
</section>

<style>
  .image-surface { grid-column: 2; grid-row: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--app-canvas); }
  .inactive { visibility: hidden; pointer-events: none; }
  .image-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid var(--app-border); font-size: 12px; background: var(--app-chrome); }
  .image-toolbar > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .image-dimensions { margin-left: auto; white-space: nowrap; }
  button, select { color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 3px; padding: 4px 6px; font: inherit; }
  .image-viewport { flex: 1; min-height: 0; overflow: auto; position: relative; touch-action: none; }
  .image-stage { position: relative; cursor: grab; }
  .image-stage:active { cursor: grabbing; }
  img { position: absolute; left: 50%; top: 50%; max-width: none; user-select: none; }
  p { padding: 24px; }
</style>
