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
 * Answers main's path requests with a picker-mode folder tab in the focused group.
 * The tab is transient: closing it cancels, and focus returns to the requester.
 */
export function createPickerController(options: { desktop: DesktopPort; workspace: WorkspaceState; tabs: TabController; projectFolder(): string | null }) {
  const { desktop, workspace, tabs } = options;
  const answered = new Set<string>();
  const origins = new Map<string, string | null>();
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
    const origin = origins.get(id);
    origins.delete(id);
    // Return to the requester first, then drop the chooser. Activating after an awaited
    // close could land on top of a chooser opened in the meantime.
    if (origin && workspace.activeId === tabId && workspace.find(origin)) await tabs.activate(origin);
    await tabs.close(tabId, true);
  };
  const stop = desktop.files.onPickerRequest(request => void (async () => {
    origins.set(request.id, workspace.activeId);
    try {
      const folder = await start(request);
      const selection = request.kind === 'open' && request.name ? [join(folder, request.name)] : undefined;
      if (!await tabs.openFolder(folder, { picker: request, selection })) throw Error('No editor group can show the file chooser.');
    } catch (error) {
      console.error('Could not open the file chooser', error);
      answered.add(request.id); origins.delete(request.id);
      desktop.files.resolvePicker(request.id, null);
    }
  })());
  return {
    accept: (tabId: string, paths: string[]) => void finish(tabId, paths),
    cancel: (tabId: string) => void finish(tabId, null),
    /** A picker tab closed by the tab strip, Ctrl+W or a window change. */
    closed: (requestId: string) => {
      if (answered.delete(requestId)) return;
      origins.delete(requestId);
      desktop.files.resolvePicker(requestId, null);
    },
    dispose: stop,
  };
}
