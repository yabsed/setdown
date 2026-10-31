import { webPdfPositions } from './web-pdf-positions';
import type { WorkspaceState } from '../../core/workspace/workspace-state';
import type { DesktopPort } from '../ports/desktop-port';
import type { TabController } from '../workspace/tab-controller';
import { project } from '../project/project-state.svelte';
import { browser } from './browser-state.svelte';

export function createBrowserRuntime(workspace: WorkspaceState, desktop: DesktopPort, tabs: TabController,
  activate: (id: string) => void, navigate: (id: string, direction: -1 | 1) => void,
  reader: (id: string) => void) {
  let depth = 0, generation = 0, frozen = false;
  let lastLayout = '';
  const area = document.querySelector<HTMLElement>('.editor-area')!;
  const entries = () => workspace.groups.groups.flatMap(group => {
    const tab = group.activeId && workspace.find(group.activeId);
    // A tab in reader mode omits its native view from the layout, hiding it
    // without destroying the live page behind the shell reader surface.
    if (!tab || tab.kind !== 'web' || tab.page.error || tab.page.pdf || tab.page.startPage || browser.readers[tab.id]
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
  let downloadsLoaded = false;
  const changedDownloads = new Set<string>();
  const unsubscribe = desktop.browser.onEvent(event => {
    if (event.type === 'page') {
      // A reader snapshot belongs to the exact URL it was extracted from; any
      // navigation (address bar, link, redirect) ends reader mode.
      if (browser.readers[event.page.id] && browser.readers[event.page.id].article.url !== event.page.url) {
        delete browser.readers[event.page.id]; delete browser.readerPositions[event.page.id]; delete browser.readerFind[event.page.id];
      }
      const tab = workspace.find(event.page.id);
      if (tab?.kind === 'web') {
        if (tab.page.pdf && tab.page.pdf.token !== event.page.pdf?.token) delete webPdfPositions[tab.page.pdf.token];
        tab.page = event.page; tabs.updateChrome(); sync(true); }
    } else if (event.type === 'navigation') tabs.webNavigated(event.id);
    else if (event.type === 'document') {
      delete browser.readers[event.id]; delete browser.readerPositions[event.id]; delete browser.readerFind[event.id];
      if (browser.findId === event.id) { browser.findId = null; browser.active = 0; browser.matches = 0; }
    }
    else if (event.type === 'reader') reader(event.id);
    else if (event.type === 'history') navigate(event.id, event.direction);
    else if (event.type === 'open') void tabs.addWeb(event.page, event.background);
    else if (event.type === 'focus') {
      // A native focus event can arrive after this group has selected a new
      // tab. Only its current page may claim command focus; obsolete events
      // must not switch the newly opened tab back to the previous page.
      if (workspace.find(event.id)?.kind !== 'web' || workspace.groups.owner(event.id)?.activeId !== event.id) return;
      if (workspace.activeId !== event.id || project.gitDiffActive) activate(event.id);
    } else if (event.type === 'close') {
      const tab = workspace.find(event.id);
      if (tab?.kind === 'web' && tab.page.pdf) delete webPdfPositions[tab.page.pdf.token]; delete browser.readers[event.id]; delete browser.readerPositions[event.id]; delete browser.readerFind[event.id]; tabs.browserClosed(event.id); }
    else if (event.type === 'places') browser.revision++;
    else if (event.type === 'extensions' || event.type === 'theme-settings') browser.revision++;
    else if (event.type === 'download') {
      if (!downloadsLoaded) changedDownloads.add(event.download.id);
      const index = browser.downloads.findIndex(item => item.id === event.download.id);
      if (index < 0) browser.downloads.unshift(event.download); else browser.downloads[index] = event.download;
    } else if (event.type === 'download-removed') {
      if (!downloadsLoaded) changedDownloads.add(event.id);
      browser.downloads = browser.downloads.filter(item => item.id !== event.id);
    }
    else if (event.type === 'permissions') {
      if (event.requests.length) browser.permissions[event.id] = event.requests; else delete browser.permissions[event.id];
    }
    else if (event.type === 'auth') {
      if (event.request) browser.auth[event.id] = event.request;
      else { delete browser.auth[event.id]; if (browser.authId === event.id) browser.authId = null; }
    }
    else if (event.type === 'find' && !browser.readers[event.id] && browser.findId === event.id && event.query === browser.query) { browser.active = event.active; browser.matches = event.matches; }
  });
  void desktop.browser.downloads().then(rows => {
    browser.downloads = [...browser.downloads, ...rows.filter(item => !changedDownloads.has(item.id))]
      .sort((a, b) => b.startedAt - a.startedAt);
    downloadsLoaded = true; changedDownloads.clear();
  }).catch(error => { browser.error = String(error); });
  const observer = new ResizeObserver(() => sync()); observer.observe(area);
  const zoom = desktop.onZoomChanged(() => sync(true));
  window.addEventListener('beforeunload', () => { unsubscribe(); zoom(); observer.disconnect(); window.removeEventListener('setdown:native-overlay-visibility', overlay); }, { once: true });
  return { sync };
}
