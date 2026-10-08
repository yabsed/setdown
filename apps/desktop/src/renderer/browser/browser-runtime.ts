import type { WorkspaceState } from '../../core/workspace/workspace-state';
import type { DesktopPort } from '../ports/desktop-port';
import type { TabController } from '../workspace/tab-controller';
import { project } from '../project/project-state.svelte';
import { browser } from './browser-state.svelte';

export function createBrowserRuntime(workspace: WorkspaceState, desktop: DesktopPort, tabs: TabController,
  activate: (id: string) => void, navigate: (id: string, direction: -1 | 1) => void) {
  let depth = 0, generation = 0, frozen = false;
  let lastLayout = '';
  const area = document.querySelector<HTMLElement>('.editor-area')!;
  const entries = () => workspace.groups.groups.flatMap(group => {
    const tab = group.activeId && workspace.find(group.activeId);
    if (!tab || tab.kind !== 'web' || tab.page.error || tab.page.startPage
      || (group.id === workspace.groups.focusedId && project.gitDiffActive)) return [];
    const host = area.querySelector<HTMLElement>(`.group-body[data-group-id="${group.id}"]`);
    if (!host) return [];
    const rect = host.getBoundingClientRect();
    return [{ id: tab.id, host, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }];
  });
  function sync(force = false) {
    const layout = frozen ? [] : entries().map(({ id, bounds }) => ({ id, bounds,
      canGoBack: tabs.canGoBack(id), canGoForward: tabs.canGoForward(id) }));
    const signature = JSON.stringify(layout);
    if (!force && signature === lastLayout) return;
    lastLayout = signature; desktop.browser.layout(layout);
  }
  async function cover() {
    if (++depth !== 1) return;
    const token = ++generation;
    const captures = await Promise.all(entries().map(async entry => ({ ...entry, image: await desktop.browser.capture(entry.id).catch(() => null) })));
    if (token !== generation || !depth) return;
    for (const capture of captures) if (capture.image) {
      capture.host.style.backgroundImage = `url("${capture.image}")`;
      capture.host.dataset.browserFrozen = 'true';
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (token !== generation || !depth) return;
    frozen = true; sync();
  }
  function uncover() {
    if (!depth || --depth) return;
    generation++; frozen = false; sync();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (depth) return;
      for (const host of area.querySelectorAll<HTMLElement>('[data-browser-frozen]')) {
        host.style.backgroundImage = ''; delete host.dataset.browserFrozen;
      }
    }));
  }
  const overlay = ((event: CustomEvent<boolean>) => { if (event.detail) void cover(); else uncover(); }) as EventListener;
  window.addEventListener('setdown:native-overlay-visibility', overlay);
  const unsubscribe = desktop.browser.onEvent(event => {
    if (event.type === 'page') {
      const tab = workspace.find(event.page.id);
      if (tab?.kind === 'web') { tab.page = event.page; tabs.updateChrome(); sync(true); }
    } else if (event.type === 'navigation') tabs.webNavigated(event.id);
    else if (event.type === 'history') navigate(event.id, event.direction);
    else if (event.type === 'open') void tabs.addWeb(event.page, event.background);
    else if (event.type === 'focus') {
      // A native focus event can arrive after this group has selected a new
      // tab. Only its current page may claim command focus; obsolete events
      // must not switch the newly opened tab back to the previous page.
      if (workspace.find(event.id)?.kind !== 'web' || workspace.groups.owner(event.id)?.activeId !== event.id) return;
      if (workspace.activeId !== event.id || project.gitDiffActive) activate(event.id);
    } else if (event.type === 'close') tabs.browserClosed(event.id);
    else if (event.type === 'places') browser.revision++;
    else if (event.type === 'find' && browser.findId === event.id) { browser.active = event.active; browser.matches = event.matches; }
  });
  const observer = new ResizeObserver(() => sync()); observer.observe(area);
  const zoom = desktop.onZoomChanged(() => sync(true));
  window.addEventListener('beforeunload', () => { unsubscribe(); zoom(); observer.disconnect(); window.removeEventListener('setdown:native-overlay-visibility', overlay); }, { once: true });
  return { sync };
}
