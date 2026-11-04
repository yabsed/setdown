<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppActions } from '../ports/ui-actions';
  import { view, type TabView } from '../workspace/workspace-view.svelte';
  import { browser } from './browser-state.svelte';

  let { actions, groupId, tab, bar }: { actions: AppActions; groupId: string; tab?: TabView; bar?: HTMLElement } = $props();
  const token = crypto.randomUUID();
  let focus = $state(''), placement = $state(0);
  const finding = $derived(tab?.kind === 'web' && !tab.page?.pdf && browser.findId === tab.id && groupId === view.focusedGroupId);
  $effect(() => {
    if (!finding || !bar || !tab) { actions.browserFindOverlay.hide(token); return; }
    void placement; void browser.readers[tab.id];
    const rect = bar.getBoundingClientRect(), width = Math.min(376, rect.width - 12);
    void actions.browserFindOverlay.show({ token, id: tab.id, focus,
      query: browser.query, active: browser.active, matches: browser.matches,
      bounds: { x: rect.right - width - 6, y: rect.bottom + 2, width, height: 64 },
    }).catch(reason => { browser.error = String(reason); });
  });
  function close() {
    if (!tab) return;
    actions.browserFindOverlay.hide(token);
    browser.findId = null; actions.browserFind(tab.id, '');
    if (browser.readers[tab.id]) window.dispatchEvent(new CustomEvent('setdown:reader-focus', { detail: tab.id }));
    else actions.browserCommand(tab.id, 'focus');
  }
  onMount(() => {
    const reposition = () => { placement++; };
    const resize = new ResizeObserver(reposition);
    // Ancestor changes include sidebar/sash movement with an unchanged bar width.
    if (bar) for (let element: HTMLElement | null = bar; element; element = element.parentElement) resize.observe(element);
    const theme = new MutationObserver(reposition);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const off = actions.browserFindOverlay.onAction(action => {
      if (!finding || action.token !== token || action.id !== tab?.id) return;
      if (action.command === 'close') { close(); return; }
      browser.query = action.query;
      actions.browserFind(tab.id, action.query, action.command !== 'previous', action.command !== 'search');
    });
    const find = () => {
      if (groupId !== view.focusedGroupId || tab?.kind !== 'web') return;
      if (tab.page?.pdf) { window.dispatchEvent(new Event('setdown:pdf-find')); return; }
      if (browser.findId && browser.findId !== tab.id) actions.browserFind(browser.findId, '');
      browser.findId = tab.id; focus = crypto.randomUUID();
      actions.browserFind(tab.id, browser.query);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('setdown:browser-find', find);
    return () => { off(); resize.disconnect(); theme.disconnect(); actions.browserFindOverlay.hide(token);
      window.removeEventListener('resize', reposition); window.removeEventListener('setdown:browser-find', find); };
  });
</script>
