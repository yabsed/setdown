<script lang="ts">
  import { onMount } from 'svelte';
  import type { WebGitGraphElement } from '@web-git-graph/web';
  import type { GitGraphCommit } from '@web-git-graph/protocol';
  import type { AppActions } from '../../view-state.svelte';
  import { electronDesktop } from '../../adapters/electron-desktop';
  import { themeProfile } from '../../../core/theme/theme-catalog';
  import { normalizePreviewTheme } from '../../../core/preview/preview-preferences';
  import { project } from '../project-state.svelte';
  import { ElectronGitGraphProvider } from './git-graph-provider';

  let { actions, root }: { actions: AppActions; root: string } = $props();
  const storageKey = 'setdown:git-graph-panel';
  function restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}');
      return { expanded: saved.expanded !== false, ratio: Number.isFinite(saved.ratio) ? Math.min(.8, Math.max(.2, saved.ratio)) : .55 };
    } catch { return { expanded: true, ratio: .55 }; }
  }
  const saved = restore();
  let expanded = $state(saved.expanded);
  let ratio = $state(saved.ratio);
  let pane = $state<HTMLElement>();
  let host = $state<HTMLDivElement>();
  let graph: WebGitGraphElement | undefined;
  let error = $state('');
  let mounted = $state(false);
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  function remember() {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ expanded, ratio })); } catch { /* Optional UI persistence. */ }
  }
  function toggle() { expanded = !expanded; remember(); }
  function resize(event: PointerEvent) {
    if (event.button !== 0 || !pane?.parentElement) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const bounds = pane.parentElement.getBoundingClientRect();
    const startY = event.clientY, start = ratio;
    handle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => { ratio = Math.min(.8, Math.max(.2, start - (next.clientY - startY) / bounds.height)); };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      handle.removeEventListener('lostpointercapture', stop);
      remember();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('lostpointercapture', stop);
  }
  function resizeKey(event: KeyboardEvent) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    ratio = event.key === 'Home' ? .2 : event.key === 'End' ? .8
      : Math.min(.8, Math.max(.2, ratio + (event.key === 'ArrowUp' ? .05 : -.05)));
    remember();
  }
  onMount(() => { mounted = true; });
  $effect(() => {
    if (!mounted || !expanded || !host || !project.open || !project.visible) return;
    const container = host, folder = root;
    const provider = new ElectronGitGraphProvider(electronDesktop, folder);
    let disposed = false;
    let element: WebGitGraphElement | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let themeObserver: MutationObserver | undefined;
    let frame = 0;
    error = '';
    void import('@web-git-graph/web').then(({ defineWebGitGraph }) => {
      if (disposed) return;
      defineWebGitGraph();
      element = document.createElement('web-git-graph') as WebGitGraphElement;
      element.density = 'compact';
      element.columns = '';
      element.avatars = false;
      element.style.cssText = 'height:100%;min-height:0;border:0;--wgg-bg:var(--app-chrome);--wgg-panel:var(--app-chrome);--wgg-panel-raised:var(--app-chrome);--wgg-ink:var(--app-text);--wgg-muted:var(--app-muted-text);--wgg-line:var(--app-border);--wgg-hover:var(--app-hover);--wgg-accent:var(--app-focus-ring)';
      element.setAttribute('hosted', '');
      const applyTheme = () => {
        if (element) element.theme = themeProfile(normalizePreviewTheme(document.documentElement.dataset.theme)).appearance;
      };
      applyTheme();
      themeObserver = new MutationObserver(applyTheme);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      let selected: GitGraphCommit | undefined;
      element.addEventListener('gitgraph-commit-select', (event) => { selected = event.detail.commit; });
      element.addEventListener('gitgraph-file-open', (event) => {
        const { change, base, head } = event.detail;
        const target = head && 'oid' in head ? head.oid : selected?.oid;
        if (!target) return;
        event.preventDefault();
        actions.reviewGitHistory({ root: folder, head: target,
          ...(base && 'oid' in base ? { base: base.oid } : {}), path: change.path });
      });
      element.addEventListener('gitgraph-error', (event) => {
        if (!disposed) error = event.detail.error instanceof Error ? event.detail.error.message : String(event.detail.error);
      });
      // Assign before connecting: the component loads exactly once on mount.
      element.provider = provider;
      container.append(element);
      graph = element;
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          // 1.0.7 has no public layout() or container observer. Reapplying its
          // public density setting redraws the visible window without fetching,
          // resetting selection, or reaching into the component's shadow DOM.
          if (!disposed && element) element.density = 'compact';
        });
      });
      resizeObserver.observe(container);
    }).catch((cause) => { if (!disposed) error = String(cause); });
    return () => {
      disposed = true;
      clearTimeout(refreshTimer);
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect(); themeObserver?.disconnect();
      provider.dispose(); element?.remove(); graph = undefined;
    };
  });
  $effect(() => {
    // Status snapshots change after external disk/Git writes and our mutations,
    // never for unsaved editor keystrokes. Coalesce watcher bursts.
    const snapshot = project.git;
    if (snapshot && expanded && mounted && project.open && project.visible && graph) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => graph?.refresh(), 300);
    }
  });
</script>

<section class="git-history-pane" aria-label="Git history" bind:this={pane}
  style:flex-basis={expanded ? `${ratio * 100}%` : '30px'}>
  {#if expanded}
    <button type="button" class="history-resize" aria-label="Resize Git Graph"
      title="Drag to resize Graph; use arrow keys when focused"
      onpointerdown={resize} onkeydown={resizeKey}></button>
  {/if}
  <header>
    <button type="button" class="history-toggle" aria-expanded={expanded} onclick={toggle}>
      <span aria-hidden="true">{expanded ? '⌄' : '›'}</span> Graph
    </button>
    <button type="button" class="history-refresh" aria-label="Refresh Git Graph" title="Refresh Graph"
      disabled={!expanded} onclick={() => { error = ''; graph?.refresh(); }}>↻</button>
  </header>
  {#if expanded}
    <div class="history-graph" bind:this={host}></div>
    {#if error}<p class="history-error" role="status">{error}</p>{/if}
  {/if}
</section>

<style>
  .git-history-pane { position: relative; display: flex; flex-direction: column; flex-grow: 0; flex-shrink: 0; min-height: 30px; min-width: 0; border-top: 1px solid var(--app-border); }
  header { display: flex; align-items: center; flex: 0 0 29px; padding: 0 8px; }
  header button { color: var(--app-text); background: transparent; border: 0; font: inherit; font-size: 12px; cursor: pointer; }
  .history-toggle { flex: 1; text-align: left; font-weight: 600; }
  .history-toggle span { display: inline-block; width: 14px; }
  .history-refresh { font-size: 18px; }
  .history-refresh:disabled { opacity: .4; }
  .history-resize { position: absolute; top: -3px; left: 0; right: 0; height: 6px; padding: 0; border: 0; background: transparent; cursor: row-resize; touch-action: none; z-index: 2; }
  .history-resize:hover, .history-resize:focus-visible { background: var(--app-focus-ring); }
  .history-graph { flex: 1; min-height: 0; overflow: hidden; }
  .history-error { margin: 4px 8px; font-size: 11px; color: var(--app-muted-text); max-height: 48px; overflow: auto; }
</style>
