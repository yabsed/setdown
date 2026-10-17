<script lang="ts">
  import { onMount } from 'svelte';
  import type { DocumentTab } from '../../core/workspace/workspace-state';
  import type { DesktopPort } from '../ports/desktop-port';
  import { mediaZoom } from '../zoom-state.svelte';
  import { hwpSessions } from './hwp-sessions';
  let { tab, active, notice = false, desktop }: { tab: DocumentTab; active: boolean; notice?: boolean; desktop: DesktopPort } = $props();
  let host: HTMLDivElement;
  let error = $state('');
  let ready = $state(false);
  let mounted = $state(false);
  let covered = $state(0);
  let frame = 0;
  function sync() {
    if (!mounted) return;
    const rect = host.getBoundingClientRect();
    const banner = notice ? document.querySelector('.focused-content .notice')?.getBoundingClientRect() : null;
    const top = Math.max(rect.y, banner?.bottom ?? rect.y);
    desktop.hwp.present(tab.id, active && !covered && ready && !error ? { x: rect.x, y: top, width: rect.width, height: Math.max(0, rect.bottom - top) } : null);
  }
  $effect(() => { active; covered; ready; notice; error; sync(); });
  onMount(() => {
    mounted = true;
    const update = () => { const state = hwpSessions.state(tab.id); ready = state?.ready ?? false; error = state?.error ?? '';
      if (state?.position) mediaZoom[tab.id] = { percent: state.position.zoom * 100, max: 500, change: steps => desktop.hwp.zoom(tab.id, steps) };
    };
    const unsubscribe = hwpSessions.subscribe(update);
    void hwpSessions.ensure(tab).then(update).catch(reason => { error = String(reason); });
    const resize = new ResizeObserver(sync); resize.observe(host);
    const banner = document.querySelector('.focused-content .notice'); if (banner) resize.observe(banner);
    // Sash/sidebar movement can change x/y without resizing this particular pane.
    const layout = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(sync); });
    layout.observe(document.querySelector('.editor-area')!, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
    const overlay = ((event: CustomEvent<boolean>) => { covered = Math.max(0, covered + (event.detail ? 1 : -1)); }) as EventListener;
    window.addEventListener('setdown:native-overlay-visibility', overlay);
    window.addEventListener('resize', sync);
    const zoom = desktop.onZoomChanged(sync);
    return () => { delete mediaZoom[tab.id]; mounted = false; unsubscribe(); resize.disconnect(); layout.disconnect(); cancelAnimationFrame(frame); zoom();
      window.removeEventListener('resize', sync); window.removeEventListener('setdown:native-overlay-visibility', overlay); desktop.hwp.present(tab.id, null); };
  });
</script>
<div class="hwp-surface" bind:this={host} data-hwp-tab={tab.id}>
  {#if error}<div role="alert">한글 문서를 열 수 없습니다.<br />{error}</div>
  {:else if !ready}<div role="status">한글 문서를 불러오는 중…</div>{/if}
</div>
<style>
  .hwp-surface { width: 100%; height: 100%; min-height: 0; pointer-events: none; }
  [role] { padding: 24px; white-space: pre-wrap; }
</style>
