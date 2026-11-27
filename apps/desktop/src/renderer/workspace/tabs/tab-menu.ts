import { isDocumentTab, tabLocation, type WorkspaceState, type WorkspaceTab } from '../../../core/workspace/workspace-state';
import type { Group, SplitDirection } from '../../../core/workspace/editor-groups';
import { clusterOfCommand, tabCloseTargets, type TabMenuCommand, type TabMenuContext } from '../../../core/workspace/tab-menu';
import { tabClusterOf, tabClusterTitle } from '../../../core/workspace/tab-clusters';
import type { DesktopPort } from '../../ports/desktop-port';
import type { TabController } from '../tab-controller';

type Options = {
  desktop: Pick<DesktopPort, 'showTabMenu'>; workspace: WorkspaceState;
  tabs: Pick<TabController, 'close' | 'closeMany' | 'pin' | 'stick' | 'dirty' | 'copyToGroup' | 'moveToGroup' | 'clusters'>;
  /** The open project folder: the base of relative paths and the Explorer's root. */
  root(): string | null;
  /** Puts the file or folder itself on the clipboard, as the Explorer's Copy does. */
  copyFile(path: string): Promise<unknown>;
  revealInFolder(path: string, groupId: string): Promise<void>;
  revealInExplorer(path: string): Promise<void>;
  moveToWindow(id: string): void;
  failed(error: unknown): void;
};
const DIRECTIONS: SplitDirection[] = ['up', 'down', 'left', 'right'];
const under = (path: string, root: string) => path.startsWith(`${root}/`) || path.startsWith(`${root}\\`);

/** The tab strip's context menu: describes one tab to the native menu and runs the chosen command. */
export function createTabMenu(options: Options) {
  const { workspace, tabs } = options, groups = workspace.groups;
  const dirty = (id: string) => { const tab = workspace.find(id); return !!tab && tabs.dirty(tab); };
  /** A saved file or folder path; a web address; otherwise nothing to copy or reveal. */
  const location = (tab: WorkspaceTab): TabMenuContext['location'] => {
    if (tab.kind === 'web') return /^https?:/i.test(tab.page.url) && !tab.page.startPage ? 'address' : 'none';
    if (tab.kind === 'terminal') return 'none';
    if (tab.kind === 'folder') return tab.picker ? 'none' : 'file';
    return tab.kind === 'diff' || !tab.document.isUntitled ? 'file' : 'none';
  };
  const copyable = (tab: WorkspaceTab) => tab.kind === 'diff' || (tab.kind === 'folder' && !tab.picker) || (isDocumentTab(tab) && !!tab.documentId);
  function describe(tab: WorkspaceTab, group: Group): { context: TabMenuContext; copy: { path: string; relative: string } } {
    const root = options.root(), path = tabLocation(tab), kind = location(tab);
    const inProject = kind === 'file' && !!root && under(path, root);
    const targets = (command: Parameters<typeof tabCloseTargets>[0]) => tabCloseTargets(command, group, tab.id, dirty).length > 0;
    return {
      context: {
        location: kind, inProject,
        others: targets('close-others'), right: targets('close-right'), saved: targets('close-saved'), all: targets('close-all'),
        preview: !groups.isPinned(tab.id), pinned: groups.isSticky(tab.id), copyable: copyable(tab),
        // A sole tab can only join a neighbor: splitting its own group would leave that group empty.
        moves: DIRECTIONS.filter(direction => group.tabs.length > 1 || !!groups.neighbor(group.id, direction)),
        detachable: workspace.tabs.length > 1 && tab.kind !== 'diff' && !(tab.kind === 'folder' && tab.picker),
        cluster: !!tabClusterOf(group, tab.id),
        clusters: group.clusters.filter(cluster => !cluster.tabs.includes(tab.id)).map(cluster => ({ id: cluster.id, title: tabClusterTitle(cluster) })),
      },
      copy: { path: kind === 'none' ? '' : path, relative: inProject ? path.slice(root!.length + 1) : '' },
    };
  }
  async function run(command: TabMenuCommand, id: string): Promise<void> {
    // The tab may have closed or moved while the menu was open.
    const tab = workspace.find(id), group = groups.owner(id);
    if (!tab || !group) return;
    const { context } = describe(tab, group);
    const [action, direction] = command.split('-') as [string, SplitDirection];
    if (command === 'close') await tabs.close(id);
    else if (command === 'close-others' || command === 'close-right' || command === 'close-saved' || command === 'close-all')
      await tabs.closeMany(tabCloseTargets(command, group, id, dirty));
    else if (command === 'copy-file' && context.location === 'file') await options.copyFile(tabLocation(tab));
    else if (command === 'reveal-folder' && context.location === 'file')
      await options.revealInFolder(tabLocation(tab), group.id);
    else if (command === 'reveal-explorer' && context.inProject) await options.revealInExplorer(tabLocation(tab));
    else if (command === 'cluster-new') await tabs.clusters.create(id);
    else if (command === 'cluster-leave') tabs.clusters.leave(id);
    else if (command.startsWith('cluster-add:')) {
      // Only a tab group of this tab's own strip: it may have gone while the menu was open.
      const target = clusterOfCommand(command);
      if (target && group.clusters.some(cluster => cluster.id === target)) tabs.clusters.add(id, target);
    }
    else if (command === 'keep-open') tabs.pin(id);
    else if (command === 'pin' || command === 'unpin') tabs.stick(id, command === 'pin');
    else if (command === 'move-window') { if (context.detachable) options.moveToWindow(id); }
    else if (action === 'split' && context.copyable) await tabs.copyToGroup(id, group.id, direction);
    else if (action === 'move' && context.moves.includes(direction)) {
      const neighbor = groups.neighbor(group.id, direction);
      await tabs.moveToGroup(id, neighbor ? { groupId: neighbor.id, direction: null } : { groupId: group.id, direction });
    }
  }
  return {
    /** `point` is where the menu opens, in this window's CSS pixels. */
    async show(id: string, point: { x: number; y: number }): Promise<void> {
      const tab = workspace.find(id), group = groups.owner(id);
      if (!tab || !group) return;
      try {
        const { context, copy } = describe(tab, group);
        const command = await options.desktop.showTabMenu(context, copy, point);
        if (command) await run(command, id);
      } catch (error) { options.failed(error); }
    },
  };
}
