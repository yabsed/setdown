<script lang="ts">
  import { onMount } from 'svelte';
  import { view } from '../workspace/workspace-view.svelte';
  import { project } from '../project/project-state.svelte';
  import type { AppActions } from '../ports/ui-actions';

  let { actions, frames }: { actions: AppActions; frames?: HTMLElement } = $props();
  const token = crypto.randomUUID();
  const id = $derived(view.groups.find(group => group.id === view.focusedGroupId)?.activeId);
  let placement = $state(0), suspended = $state(false);
  const finding = $derived(view.findOpen && view.surface === 'viewer' && !project.gitDiffActive && !suspended && !!id);
  $effect(() => {
    if (!finding || !frames || !id) { actions.browserFindOverlay.hide(token); return; }
    void placement;
    const rect = frames.getBoundingClientRect(), width = Math.min(376, rect.width - 12);
    void actions.browserFindOverlay.show({ token, id, focus: `${id}:${view.findFocus}`, scope: 'markdown',
      query: view.findQuery, active: view.findActive, matches: view.findMatches,
      bounds: { x: rect.right - width - 6, y: rect.top + 2, width, height: 64 },
    });
  });
  $effect(() => {
    const resize = new ResizeObserver(() => { placement++; });
    if (frames) for (let element: HTMLElement | null = frames; element; element = element.parentElement) resize.observe(element);
    return () => resize.disconnect();
  });
  onMount(() => {
    const reposition = () => { placement++; };
    const theme = new MutationObserver(reposition);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const off = actions.browserFindOverlay.onAction(action => {
      if (!finding || action.token !== token || action.id !== id) return;
      if (action.command === 'close') { actions.browserFindOverlay.hide(token); actions.closeFind(); return; }
      view.findQuery = action.query;
      actions.find(action.query, action.command === 'previous' ? 'backward' : 'forward', action.command !== 'search');
    });
    const overlay = ((event: CustomEvent<boolean>) => { suspended = event.detail; }) as EventListener;
    window.addEventListener('resize', reposition);
    window.addEventListener('setdown:native-overlay-visibility', overlay);
    window.addEventListener('setdown:tab-drag-visibility', overlay);
    return () => { off(); theme.disconnect(); actions.browserFindOverlay.hide(token);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('setdown:native-overlay-visibility', overlay);
      window.removeEventListener('setdown:tab-drag-visibility', overlay); };
  });
</script>
