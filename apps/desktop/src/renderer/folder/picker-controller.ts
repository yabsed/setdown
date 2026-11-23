import type { WorkspaceState } from '../../core/workspace/workspace-state';
import type { PathPickerRequest } from '../../protocol/files';
import type { DesktopPort } from '../ports/desktop-port';
import type { TabController } from '../workspace/tab-controller';

const KEY = 'setdown:picker-folders';
function remembered(purpose: string): string {
  try { const value = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return typeof value[purpose] === 'string' ? value[purpose] : ''; }
  catch { return ''; }
}
function remember(purpose: string, folder: string): void {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const next = Object.fromEntries(Object.entries({ ...value, [purpose]: folder }).slice(-50));
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* Storage is optional. */ }
}
const join = (folder: string, name: string) => `${folder.replace(/[\\/]+$/, '')}${folder.includes('\\') && !folder.includes('/') ? '\\' : '/'}${name}`;

/**
 * Answers main's path requests with a picker-mode folder tab. With another group on screen
 * it opens beside the focused one, so the tab in use stays in view; otherwise it takes the
 * focused group. The tab is transient: closing it cancels, its group shows what the chooser
 * covered again, and focus returns to the requester.
 */
export function createPickerController(options: { desktop: DesktopPort; workspace: WorkspaceState; tabs: TabController; projectFolder(): string | null }) {
  const { desktop, workspace, tabs } = options;
  const answered = new Set<string>();
  /** Per request: the tab that had the keyboard, and the tab the chooser replaced as its group's selection. */
  const places = new Map<string, { origin: string | null; covered?: string | null }>();
  const start = async (request: PathPickerRequest): Promise<string> => {
    for (const candidate of [request.folder, remembered(request.purpose), options.projectFolder() ?? '']) {
      if (!candidate) continue;
      const location = await desktop.files.resolve(candidate).catch(() => null);
      if (location?.kind === 'folder') return location.path;
    }
    return desktop.files.home();
  };
  const finish = async (tabId: string, paths: string[] | null) => {
    const tab = workspace.find(tabId);
    if (tab?.kind !== 'folder' || !tab.picker) return;
    const { id, purpose } = tab.picker;
    if (paths) remember(purpose, tab.path);
    answered.add(id);
    desktop.files.resolvePicker(id, paths);
    const origin = places.get(id)?.origin;
    // Return to the requester first, then drop the chooser. Activating after an awaited
    // close could land on top of a chooser opened in the meantime.
    if (origin && workspace.activeId === tabId && workspace.find(origin)) await tabs.activate(origin);
    await tabs.close(tabId, true);
    places.delete(id);
  };
  const stop = desktop.files.onPickerRequest(request => void (async () => {
    const place: { origin: string | null; covered?: string | null } = { origin: workspace.activeId };
    places.set(request.id, place);
    try {
      const folder = await start(request);
      const selection = request.kind === 'open' && request.name ? [join(folder, request.name)] : undefined;
      const { groups } = workspace, asking = workspace.active;
      // A chooser asked for from another chooser joins it, rather than taking the group that one left free.
      const group = (asking?.kind === 'folder' && asking.picker ? null : groups.beside(groups.focusedId)) ?? groups.focused;
      place.covered = group.activeId;
      if (!await tabs.openFolder(folder, { picker: request, selection, groupId: group.id })) throw Error('No editor group can show the file chooser.');
    } catch (error) {
      console.error('Could not open the file chooser', error);
      answered.add(request.id); places.delete(request.id);
      desktop.files.resolvePicker(request.id, null);
    }
  })());
  return {
    accept: (tabId: string, paths: string[]) => void finish(tabId, paths),
    cancel: (tabId: string) => void finish(tabId, null),
    /** A picker tab is about to leave its group: answered, or closed by the tab strip, Ctrl+W or a window change. */
    closing: (tabId: string, requestId: string) => {
      const place = places.get(requestId), { groups } = workspace, group = groups.owner(tabId);
      places.delete(requestId);
      // Its group shows what the chooser covered again, not the chooser's neighbor in the strip.
      if (place?.covered && group?.activeId === tabId && group.tabs.includes(place.covered)) group.activeId = place.covered;
      // Closed with the keyboard still in it, the chooser hands that back to the requester's group.
      const home = place?.origin && workspace.activeId === tabId ? groups.owner(place.origin) : null;
      if (home) groups.focusedId = home.id;
      if (answered.delete(requestId)) return;
      desktop.files.resolvePicker(requestId, null);
    },
    dispose: stop,
  };
}
