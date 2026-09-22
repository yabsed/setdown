<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { WebGitGraphElement } from '@web-git-graph/web';
  import type { GitGraphCommit } from '@web-git-graph/protocol';
  import type { AppActions } from '../../view-state.svelte';
  import { electronDesktop } from '../../adapters/electron-desktop';
  import { themeProfile } from '../../../core/theme/theme-catalog';
  import { normalizePreviewTheme } from '../../../core/preview/preview-preferences';
  import { project } from '../project-state.svelte';
  import { ElectronGitGraphProvider } from './git-graph-provider';
  import { autoGraphRefs, graphRowInsets, sameRefs } from './git-graph-presentation';
  import graphStyles from './git-graph-theme.css?inline';

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
  let autoMode = true;
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
    let rowObserver: MutationObserver | undefined;
    let frame = 0;
    error = '';
    const filterKey = `setdown:git-graph-filter:${folder}`;
    let manualRefs: string[] = [];
    try {
      const saved = JSON.parse(sessionStorage.getItem(filterKey) ?? '{}');
      autoMode = saved.mode !== 'manual';
      if (Array.isArray(saved.refs)) manualRefs = saved.refs.filter((ref: unknown): ref is string => typeof ref === 'string');
    } catch { autoMode = true; }
    const rememberFilter = () => {
      try { sessionStorage.setItem(filterKey, JSON.stringify({ mode: autoMode ? 'auto' : 'manual', refs: manualRefs })); }
      catch { /* Optional UI persistence. */ }
    };
    void import('@web-git-graph/web').then(({ defineWebGitGraph, layoutGitGraph }) => {
      if (disposed) return;
      defineWebGitGraph();
      element = document.createElement('web-git-graph') as WebGitGraphElement;
      element.density = 'comfortable';
      element.columns = '';
      element.avatars = false;
      // Upstream exposes theme tokens but no CSS parts for its toolbar/rows.
      // Keep this pinned-version presentation adapter separate from its engine.
      const style = document.createElement('style');
      style.textContent = graphStyles;
      element.shadowRoot!.append(style);
      const badges = document.createElement('style');
      element.shadowRoot!.append(badges);
      const setBadgeFilter = () => {
        const names = autoGraphRefs(untrack(() => project.git))
          .map((ref) => ref.replace(/^refs\/(heads|remotes)\//, ''));
        badges.textContent = autoMode && names.length
          ? `.row .ref${names.map((name) => `:not([title=${CSS.escape(name)}])`).join('')} { display: none; }`
          : '';
      };
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
      // The public refs property owns history filtering. Its provider setter
      // clears previous refs, so apply the restored filter after connecting.
      element.provider = provider;
      container.append(element);
      graph = element;
      const autoButton = document.createElement('button');
      autoButton.type = 'button';
      autoButton.className = 'setdown-auto';
      autoButton.textContent = 'Auto';
      autoButton.title = 'Follow the current branch and its upstream';
      autoButton.setAttribute('aria-label', 'Auto branch filter');
      const updateAutoButton = () => {
        autoButton.setAttribute('aria-pressed', String(autoMode));
        element?.toggleAttribute('data-setdown-auto', autoMode);
        element?.shadowRoot?.querySelector('.ref-select')?.setAttribute('aria-label',
          autoMode ? 'Select branches and tags, Auto' : 'Select branches and tags');
      };
      autoButton.addEventListener('click', () => {
        if (autoMode || !element) return;
        autoMode = true;
        updateAutoButton(); setBadgeFilter(); rememberFilter();
        const next = autoGraphRefs(untrack(() => project.git));
        if (!sameRefs(element.refs, next)) element.refs = next;
      });
      updateAutoButton();
      element.shadowRoot!.querySelector('.toolbar')?.append(autoButton);
      const onMenuClick = (event: Event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest('.menu[data-menu="refs"] .menu-item')) return;
        autoMode = false;
        updateAutoButton(); setBadgeFilter();
        queueMicrotask(() => { if (element) manualRefs = [...element.refs]; rememberFilter(); });
      };
      element.shadowRoot!.addEventListener('click', onMenuClick, true);
      if (autoMode) element.refs = autoGraphRefs(untrack(() => project.git));
      else if (manualRefs.length) element.refs = manualRefs;
      setBadgeFilter();
      let renderedCommits: readonly GitGraphCommit[] | undefined;
      let insets: number[] = [];
      const placeRows = () => {
        if (!element || disposed) return;
        const commits = element.data.commits;
        if (commits !== renderedCommits) {
          renderedCommits = commits;
          insets = graphRowInsets(commits, layoutGitGraph(commits));
        }
        for (const row of element.shadowRoot!.querySelectorAll<HTMLElement>('.row')) {
          const index = Number(row.dataset.index);
          row.style.setProperty('--setdown-graph-inset', `${insets[index] ?? 30}px`);
        }
      };
      const windowElement = element.shadowRoot!.querySelector('.window');
      if (windowElement) {
        rowObserver = new MutationObserver(placeRows);
        rowObserver.observe(windowElement, { childList: true });
      }
      placeRows();
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          // 1.0.7 has no public layout() or container observer. Reapplying its
          // public density setting redraws the visible window without fetching,
          // resetting selection. The presentation adapter then updates rows.
          if (!disposed && element) element.density = 'comfortable';
        });
      });
      resizeObserver.observe(container);
    }).catch((cause) => { if (!disposed) error = String(cause); });
    return () => {
      disposed = true;
      clearTimeout(refreshTimer);
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect(); themeObserver?.disconnect(); rowObserver?.disconnect();
      provider.dispose(); element?.remove(); graph = undefined;
    };
  });
  $effect(() => {
    // Status snapshots change after external disk/Git writes and our mutations,
    // never for unsaved editor keystrokes. Coalesce watcher bursts.
    const snapshot = project.git;
    if (snapshot && expanded && mounted && project.open && project.visible && graph) {
      if (autoMode) {
        const next = autoGraphRefs(snapshot);
        if (!sameRefs(graph.refs, next)) { graph.refs = next; return; }
      }
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => graph?.refresh(), 300);
    }
  });
</script>

<section class="git-history-pane" aria-label="Git history" bind:this={pane}
  style:flex-basis={expanded ? `${ratio * 100}%` : '24px'}>
  {#if expanded}
    <button type="button" class="history-resize" aria-label="Resize Git Graph"
      title="Drag to resize Graph; use arrow keys when focused"
      onpointerdown={resize} onkeydown={resizeKey}></button>
  {/if}
  <header class="scm-heading">
    <button type="button" class="scm-heading-toggle" aria-label="Graph" aria-expanded={expanded} onclick={toggle}>
      <svg class:is-open={expanded} viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg><strong>GRAPH</strong>
    </button>
    {#if expanded}
    <button type="button" class="history-action" aria-label="Fetch" title="Fetch from all remotes"
      disabled={!project.git?.repository || project.gitBusy} aria-busy={project.gitBusy}
      onclick={() => actions.runProjectGitRemote('fetch')}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v7" stroke-dasharray="1 2" /><path d="m5 6 3 3 3-3M3 10v3h10v-3" /></svg>
    </button>
    <button type="button" class="history-action" aria-label="Pull" title="Pull (fast-forward only)"
      disabled={!project.git?.repository || project.gitBusy} onclick={() => actions.runProjectGitRemote('pull')}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m-3-3 3 3 3-3M3 11v2h10v-2" /></svg>
    </button>
    <button type="button" class="history-action" aria-label="Push" title="Push"
      disabled={!project.git?.repository || project.gitBusy} onclick={() => actions.runProjectGitRemote('push')}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10V2M5 5l3-3 3 3M3 11v2h10v-2" /></svg>
    </button>
    <button type="button" class="history-refresh" aria-label="Refresh Git Graph" title="Refresh Graph"
      disabled={!expanded || project.gitBusy} onclick={() => { error = ''; actions.refreshProjectGit(); graph?.refresh(); }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 6a5 5 0 1 0 .1 4M13 2v4H9" /></svg></button>
    {/if}
  </header>
  {#if expanded}
    <div class="history-graph" bind:this={host}></div>
    {#if error}<p class="history-error" role="status">{error}</p>{/if}
  {/if}
</section>

<style>
  .git-history-pane { position: relative; display: flex; flex-direction: column; flex-grow: 0; flex-shrink: 0; min-height: 24px; min-width: 0; }
  .history-refresh svg, .history-action svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .history-refresh:disabled { opacity: .4; }
  .history-resize { position: absolute; top: -3px; left: 0; right: 0; height: 6px; padding: 0; border: 0; background: transparent; cursor: row-resize; touch-action: none; z-index: 2; }
  .history-resize:hover, .history-resize:focus-visible { background: var(--app-focus-ring); }
  .history-graph { flex: 1; min-height: 0; overflow: hidden; }
  .history-error { margin: 4px 8px; font-size: 11px; color: var(--app-muted-text); max-height: 48px; overflow: auto; }
</style>
