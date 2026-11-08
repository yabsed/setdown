<script lang="ts">
  import type { GitImageVersion } from '../../../protocol/desktop-api';

  let { version, label, side, scale, onfocus, onload }: {
    version: GitImageVersion; label: string; side: 'Original' | 'Modified'; scale: number; onfocus(): void; onload(): void;
  } = $props();
  let src = $state(''), error = $state('');
  let width = $state(0), height = $state(0);
  const size = $derived(version && 'bytes' in version ? version.bytes.byteLength : 0);
  const sizeLabel = $derived(size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`);
  $effect(() => {
    const image = version;
    width = height = 0; error = ''; src = '';
    if (!image || !('bytes' in image)) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }));
    src = url;
    return () => URL.revokeObjectURL(url);
  });
</script>

<section class="image-version" class:modified={side === 'Modified'} aria-label={`${side} image`}>
  <header>{side}<span>{label === 'WORKTREE' ? 'Working Tree' : label}</span></header>
  <!-- Keyboard users need to focus this scrollable image viewport. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="image-canvas" role="region" aria-label={`${side} image canvas`} tabindex="0" onfocus={onfocus} onpointerdown={onfocus}>
    {#if !version}
      <p>No image in this version.</p>
    {:else if 'error' in version}
      <p role="status">Could not load this image. {version.error}</p>
    {:else if error}
      <p role="status">{error}</p>
    {:else if src}
      <img {src} alt={`${side} · ${label}`} draggable="false"
        style:width={width ? `${width * scale}px` : undefined} style:height={height ? `${height * scale}px` : undefined}
        onload={event => { const image = event.currentTarget as HTMLImageElement; width = image.naturalWidth; height = image.naturalHeight; onload(); }}
        onerror={() => error = 'This file could not be decoded as an image.'} />
    {/if}
  </div>
  <footer>{#if width && height}{width} × {height} · {sizeLabel}{/if}</footer>
</section>

<style>
  .image-version { display: grid; grid-template-rows: 30px minmax(0, 1fr) 24px; min-width: 0; min-height: 0; }
  .modified { border-left: 1px solid var(--app-border); }
  header { display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: 12px; border-bottom: 1px solid var(--app-border); }
  header span, footer { color: var(--app-muted-text); font-size: 11px; }
  header span { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .image-canvas { min-width: 0; min-height: 0; display: flex; overflow: auto; padding: 12px; }
  .image-canvas:focus-visible { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  img { display: block; flex: none; height: auto; margin: auto;
    background: repeating-conic-gradient(var(--app-hover) 0% 25%, var(--app-surface) 0% 50%) 0 0 / 16px 16px; }
  p { margin: auto; padding: 12px; color: var(--app-muted-text); font-size: 12px; text-align: center; overflow-wrap: anywhere; }
  footer { padding: 3px 10px; border-top: 1px solid var(--app-border); }
</style>
