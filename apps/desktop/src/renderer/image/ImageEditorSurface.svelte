<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { imageSessions, type ImageSession } from './image-edit-sessions';
  import { flipRecipe, rotateRecipe, validRecipe, type ImageRecipe } from '../../core/image/image-recipe';
  import { renderImage } from '../../image-runtime/fabric-adapter';
  import { ContentZoomInput } from '../../core/wheel-zoom';
  import { mediaZoom } from '../zoom-state.svelte';
  let { tabId, session, active, focused, ondone, onfocus }: { tabId: string; session: ImageSession; active: boolean; focused: boolean; onfocus(): void; ondone(): void } = $props();
  let recipe = $state<ImageRecipe>(structuredClone(untrack(() => session.history.current)));
  let revision = $state(0), error = $state(''), url = $state(''), rendering = $state(false);
  let crop = $state(untrack(() => ({ ...recipe.crop }))), outputWidth = $state(untrack(() => recipe.width)), outputHeight = $state(untrack(() => recipe.height));
  let lockAspect = $state(true), cropping = $state(false);
  let selection = $state<{ x: number; y: number; width: number; height: number } | null>(null);
  let start: { x: number; y: number } | undefined;
  let picture = $state<HTMLImageElement>();
  let viewport: HTMLDivElement;
  let viewportWidth = $state(1), viewportHeight = $state(1), zoom = $state<number | 'fit'>('fit');
  let pan: { x: number; y: number; left: number; top: number } | undefined;
  const scale = $derived(zoom === 'fit' ? Math.min(1, Math.max(1, viewportWidth - 40) / recipe.width,
    Math.max(1, viewportHeight - 40) / recipe.height) : zoom);
  const stageWidth = $derived(Math.max(viewportWidth, recipe.width * scale + 40));
  const stageHeight = $derived(Math.max(viewportHeight, recipe.height * scale + 40));
  const detail = $derived(Math.max(recipe.width, recipe.height) > 2048 && scale > 2048 / Math.max(recipe.width, recipe.height));
  let source: ImageBitmap | undefined, dead = false, running = false, requested = 0;
  const dirty = $derived.by(() => { revision; return session.history.dirty; });
  const canUndo = $derived.by(() => { revision; return session.history.canUndo; });
  const canRedo = $derived.by(() => { revision; return session.history.canRedo; });
  const busy = $derived.by(() => { revision; return session.busy; });
  function sync() {
    revision++; error = session.error ?? ''; recipe = structuredClone(session.history.current); crop = { ...recipe.crop };
    outputWidth = recipe.width; outputHeight = recipe.height; selection = null;
  }
  function commit(next: ImageRecipe) {
    try { imageSessions.edit(tabId, $state.snapshot(next)); error = ''; }
    catch (cause) { error = String(cause); }
  }
  function resize() { commit({ ...recipe, width: outputWidth, height: outputHeight }); }
  function applyCrop() {
    commit({ ...recipe, crop: { ...crop }, width: crop.width, height: crop.height }); cropping = false;
  }
  function point(event: PointerEvent) {
    const box = picture!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
  }
  function select(event: PointerEvent) {
    if (!start) return;
    const p = point(event);
    selection = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) };
    const c = recipe.crop;
    const x = c.x + Math.round(selection.x * c.width), y = c.y + Math.round(selection.y * c.height);
    crop = { x, y, width: Math.max(1, Math.min(c.x + c.width - x, Math.round(selection.width * c.width))),
      height: Math.max(1, Math.min(c.y + c.height - y, Math.round(selection.height * c.height))) };
  }
  async function preview() {
    if (running || !source || dead) return;
    running = true; rendering = true;
    try {
      while (!dead) {
        const generation = requested, snapshot = structuredClone($state.snapshot(recipe));
        const blob = await renderImage(source, session.source.width, session.source.height, { ...snapshot, format: snapshot.format === 'jpeg' ? 'jpeg' : 'png' }, 2048);
        if (dead) break;
        if (generation !== requested) continue;
        if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob);
        if (detail) {
          const bytes = await imageSessions.renderDetail(tabId, { ...snapshot, format: snapshot.format === 'jpeg' ? 'jpeg' : 'png' });
          if (dead) break;
          if (generation !== requested) continue;
          URL.revokeObjectURL(url); url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
        }
        break;
      }
    } catch (cause) { if (!dead) error = String(cause); }
    finally { running = false; rendering = false; if (dead) source?.close(); }
  }
  $effect(() => { JSON.stringify(recipe); detail; requested++; void preview(); });
  $effect(() => { mediaZoom[tabId] = { percent: scale * 100, max: 800,
    change: steps => { if (active) zoom = steps === 0 ? 1 : Math.max(.1, Math.min(8, scale * 1.1 ** steps)); } }; });
  onMount(() => {
    const unsubscribe = imageSessions.subscribe(sync);
    const observer = new ResizeObserver(() => { viewportWidth = viewport.clientWidth; viewportHeight = viewport.clientHeight; });
    observer.observe(viewport);
    const input = new ContentZoomInput();
    const wheel = (event: WheelEvent) => {
      if (!event.isTrusted || !event.ctrlKey || event.altKey || event.metaKey || !active) return;
      event.preventDefault(); event.stopPropagation();
      const steps = input.consume(event, performance.now());
      if (steps) zoom = Math.max(.1, Math.min(8, scale * (typeof steps === 'number' ? 1.1 ** steps : steps.scale)));
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    void createImageBitmap(new Blob([new Uint8Array(session.source.preview)])).then(bitmap => {
      if (dead) { bitmap.close(); return; } source = bitmap; void preview();
    }).catch(cause => error = String(cause));
    return () => { dead = true; unsubscribe(); observer.disconnect(); viewport.removeEventListener('wheel', wheel); delete mediaZoom[tabId]; if (!running) source?.close(); if (url) URL.revokeObjectURL(url); };
  });
  function key(event: KeyboardEvent) {
    if (!active || !focused || event.isComposing || event.defaultPrevented || event.altKey
      || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation();
      if (event.shiftKey || event.key.toLowerCase() === 'y') imageSessions.redo(tabId); else imageSessions.undo(tabId);
    }
  }
</script>

<svelte:window onkeydown={key} />
<div class="image-editor" role="region" aria-label="Image editor" onfocusin={onfocus} onpointerdown={onfocus} data-dirty={dirty} data-rendering={rendering} inert={!active}>
  <div class="tools">
    <strong>Edit image</strong>
    <button onclick={() => imageSessions.undo(tabId)} disabled={!canUndo}>Undo</button>
    <button onclick={() => imageSessions.redo(tabId)} disabled={!canRedo}>Redo</button>
    <button onclick={() => commit(rotateRecipe(recipe, session.source.width, session.source.height))}>Rotate 90°</button>
    <button onclick={() => commit(flipRecipe(recipe, 'X', session.source.width, session.source.height))}>Flip horizontal</button>
    <button onclick={() => commit(flipRecipe(recipe, 'Y', session.source.width, session.source.height))}>Flip vertical</button>
    <button onclick={() => zoom = 'fit'}>Fit</button><button onclick={() => zoom = 1}>100%</button>
    <span class="spacer"></span>
    <button onclick={() => imageSessions.saveFromToolbar(tabId, false)} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save'}</button>
    <button onclick={() => imageSessions.saveFromToolbar(tabId, true)} disabled={busy}>Save As…</button>
    <button onclick={ondone}>View saved image</button>
  </div>
  <div class="body">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="preview" bind:this={viewport} aria-label="Image edit preview" onpointerdown={event => {
      if (cropping || event.button !== 0) return;
      pan = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; viewport.setPointerCapture(event.pointerId);
    }} onpointermove={event => { if (pan) { viewport.scrollLeft = pan.left + pan.x - event.clientX; viewport.scrollTop = pan.top + pan.y - event.clientY; } }}
      onpointerup={() => pan = undefined} onpointercancel={() => pan = undefined} onlostpointercapture={() => pan = undefined}>
      {#if url}
        <div class="stage" style:width={`${stageWidth}px`} style:height={`${stageHeight}px`}>
        <!-- Pointer selection has equivalent pixel-coordinate fields below. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="picture" class:cropping style:width={`${recipe.width * scale}px`} style:height={`${recipe.height * scale}px`} onpointerdown={(event) => {
          if (!cropping || event.button !== 0) return; start = point(event); event.currentTarget.setPointerCapture(event.pointerId); select(event);
        }} onpointermove={select} onpointerup={(event) => { select(event); start = undefined; }} onpointercancel={() => start = undefined} onlostpointercapture={() => start = undefined}>
          <img bind:this={picture} src={url} alt="Edited preview" draggable="false" />
          {#if cropping && selection}<div class="selection" style:left={`${selection.x * 100}%`} style:top={`${selection.y * 100}%`} style:width={`${selection.width * 100}%`} style:height={`${selection.height * 100}%`}></div>{/if}
        </div>
        </div>
      {:else}<p role="status">Preparing preview…</p>{/if}
    </div>
    <aside aria-label="Image adjustments">
      <fieldset><legend>Crop</legend>
        <button aria-pressed={cropping} onclick={() => { cropping = !cropping; selection = null; }}>Select crop</button>
        {#each ['x', 'y', 'width', 'height'] as key}
          <label>Crop {key}<input aria-label={`Crop ${key}`} type="number" min={key === 'x' || key === 'y' ? 0 : 1} step="1" bind:value={crop[key as keyof typeof crop]} /></label>
        {/each}
        <button onclick={applyCrop} disabled={!validRecipe({ ...recipe, crop, width: crop.width, height: crop.height }, session.source.width, session.source.height)}>Apply crop</button>
      </fieldset>
      <fieldset><legend>Resize</legend>
        <label>Width<input aria-label="Output width" type="number" min="1" max="8192" bind:value={outputWidth} oninput={(event) => { if (lockAspect) outputHeight = Math.max(1, Math.round(Number(event.currentTarget.value) * recipe.height / recipe.width)); }} /></label>
        <label>Height<input aria-label="Output height" type="number" min="1" max="8192" bind:value={outputHeight} oninput={(event) => { if (lockAspect) outputWidth = Math.max(1, Math.round(Number(event.currentTarget.value) * recipe.width / recipe.height)); }} /></label>
        <label class="check"><input type="checkbox" bind:checked={lockAspect} />Keep aspect ratio</label>
        <button onclick={resize} disabled={!validRecipe({ ...recipe, width: outputWidth, height: outputHeight }, session.source.width, session.source.height)}>Apply size</button>
      </fieldset>
      <fieldset><legend>Color</legend>
        {#each ['brightness', 'contrast', 'saturation'] as name}
          <label class="color">{name}<output>{Math.round(recipe[name as 'brightness'] * 100)}</output>
            <input aria-label={name} type="range" min="-1" max="1" step="0.01" bind:value={recipe[name as 'brightness']} onchange={() => commit($state.snapshot(recipe))} />
          </label>
        {/each}
      </fieldset>
      <fieldset><legend>Save format</legend>
        <select aria-label="Image format" value={recipe.format} onchange={event => commit({ ...recipe, format: event.currentTarget.value as ImageRecipe['format'] })}>
          <option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option>
        </select>
        {#if recipe.format !== 'png'}<label>Quality<input aria-label="Image quality" type="number" min="10" max="100" value={Math.round(recipe.quality * 100)} onchange={event => commit({ ...recipe, quality: Number(event.currentTarget.value) / 100 })} /></label>{/if}
        <p>{recipe.width} × {recipe.height} pixels{dirty ? ' · Unsaved changes' : ' · Saved'}</p>
        <p>JPEG uses a white background. Metadata is removed when saving.</p>
      </fieldset>
    </aside>
  </div>
  {#if error}<p role="alert">{error}</p>{/if}
</div>

<style>
  .image-editor { display: flex; flex: 1; flex-direction: column; min-height: 0; color: var(--app-text); font-size: 12px; }
  .tools { display: flex; align-items: center; gap: 6px; padding: 8px; flex-wrap: wrap; border-bottom: 1px solid var(--app-border); background: var(--app-chrome); }
  .spacer { flex: 1; }
  .body { display: flex; flex: 1; min-height: 0; }
  .preview { flex: 1; min-width: 0; min-height: 0; overflow: auto; touch-action: none; }
  .stage { display: flex; align-items: center; justify-content: center; }
  .picture { position: relative; flex-shrink: 0; background: repeating-conic-gradient(#999 0% 25%, #ccc 0% 50%) 0 / 16px 16px; }
  img { display: block; width: 100%; height: 100%; max-width: none; user-select: none; }
  .cropping { cursor: crosshair; touch-action: none; }
  .selection { position: absolute; border: 2px solid white; outline: 1px solid black; box-sizing: border-box; pointer-events: none; background: #4488ff25; }
  aside { width: 214px; flex-shrink: 0; overflow: auto; padding: 10px; border-left: 1px solid var(--app-border); background: var(--app-chrome); }
  fieldset { border: 0; border-bottom: 1px solid var(--app-border); padding: 8px 0 14px; margin: 0 0 8px; }
  legend { font-weight: bold; }
  label { display: flex; align-items: center; gap: 8px; justify-content: space-between; margin: 7px 0; }
  input[type=number] { width: 78px; }
  .check { justify-content: flex-start; }
  .color { flex-wrap: wrap; text-transform: capitalize; }
  input[type=range] { width: 100%; }
  button, input, select { font: inherit; color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 4px; padding: 5px 7px; }
  button:disabled { opacity: .45; }
  button[aria-pressed=true] { outline: 2px solid var(--app-text); }
  p { line-height: 1.5; }
</style>
