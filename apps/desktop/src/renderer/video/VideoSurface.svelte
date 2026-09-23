<script lang="ts">
  import { untrack } from 'svelte';
  import type { DocumentSnapshot } from '../../core/document/document';
  import type { ReadingPosition, VideoReadingPosition } from '../../core/reading/reading-position';
  import type { DesktopPort } from '../ports/desktop-port';

  let { document: file, initialPosition, desktop, onposition, active }: {
    document: DocumentSnapshot; initialPosition?: ReadingPosition; desktop: DesktopPort; active: boolean;
    onposition(position: VideoReadingPosition): void;
  } = $props();
  const initial = untrack(() => initialPosition?.kind === 'video' ? initialPosition : undefined);
  const src = untrack(() => desktop.mediaUrl(file.path));
  let video = $state<HTMLVideoElement>() as HTMLVideoElement;
  let ready = $state(false);
  let failed = $state(false);
  let restored = false;
  let lastSaved = -1;

  function remember() {
    if (!active || !ready || !video) return;
    const time = video.currentTime;
    if (!Number.isFinite(time) || Math.abs(time - lastSaved) < .5) return;
    lastSaved = time;
    onposition({ kind: 'video', time });
  }
  function loaded() {
    if (!restored && initial && initial.time > 0 && video.duration && initial.time < video.duration) {
      restored = true;
      video.currentTime = initial.time;
      lastSaved = initial.time;
    }
    ready = true;
  }
</script>

<section class="video-surface" class:inactive={!active} inert={!active} aria-hidden={!active}
  aria-label="Video reader" data-video-ready={ready}>
  <div class="video-toolbar"><span>{file.name}</span></div>
  <div class="video-stage">
    {#if failed}
      <p role="alert">Could not play this video. Its codec may not be supported by this application.</p>
    {:else}
      <!-- Arbitrary user videos have no caption track to offer. -->
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} {src} controls playsinline preload="auto"
        onloadeddata={loaded} onerror={() => failed = true}
        onpause={remember} onended={remember} ontimeupdate={remember}></video>
      {#if !ready}<p role="status">Opening video…</p>{/if}
    {/if}
  </div>
</section>

<style>
  .video-surface { grid-column: 2; grid-row: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--app-canvas); }
  .inactive { visibility: hidden; pointer-events: none; }
  .video-toolbar { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid var(--app-border); font-size: 12px; background: var(--app-chrome); }
  .video-toolbar > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .video-stage { flex: 1; min-height: 0; position: relative; overflow: hidden; }
  video { position: absolute; inset: 0; width: auto; height: auto; max-width: 100%; max-height: 100%; margin: auto; outline: none; }
  p { padding: 24px; }
  p[role="status"] { position: absolute; }
</style>
