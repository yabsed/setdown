import type { SplitDirection } from './editor-groups';

/** The tab strip's context menu: VS Code's tab commands that have a Setdown counterpart. */
export type TabMenuCommand = 'close' | 'close-others' | 'close-right' | 'close-saved' | 'close-all'
  | 'copy-path' | 'copy-relative-path' | 'reveal-folder' | 'reveal-explorer'
  | 'keep-open' | 'pin' | 'unpin' | `split-${SplitDirection}` | `move-${SplitDirection}` | 'move-window';

export type TabMenuContext = {
  /** `file`: a saved file or a folder. `address`: a web page. `none`: nothing to copy or reveal. */
  location: 'file' | 'address' | 'none';
  /** The file is inside the open project folder. */
  inProject: boolean;
  /** Whether each bulk close has a target. Pinned tabs are never one. */
  others: boolean; right: boolean; saved: boolean; all: boolean;
  /** A replaceable preview tab. */
  preview: boolean;
  pinned: boolean;
  /** The same input can be shown in two groups. */
  copyable: boolean;
  /** Sides with an adjacent group to join, or room to open one while other tabs stay behind. */
  moves: SplitDirection[];
  /** It can leave for a window of its own. */
  detachable: boolean;
};

export type TabMenuItem = { type: 'separator' }
  | { type: 'command'; command: TabMenuCommand; label: string; enabled: boolean; accelerator?: string }
  | { type: 'submenu'; label: string; items: TabMenuItem[] };

const DIRECTIONS: SplitDirection[] = ['up', 'down', 'left', 'right'];
const SPLIT: Record<SplitDirection, string> = { up: 'Split Up', down: 'Split Down', left: 'Split Left', right: 'Split Right' };
const MOVE: Record<SplitDirection, string> = { up: 'Move Above', down: 'Move Below', left: 'Move Left', right: 'Move Right' };

/** The context arrives over IPC: keep only the fields and values this menu understands. */
export function readTabMenuContext(value: unknown): TabMenuContext | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const flag = (key: keyof TabMenuContext) => input[key] === true;
  return {
    location: input.location === 'file' || input.location === 'address' ? input.location : 'none',
    inProject: flag('inProject'), others: flag('others'), right: flag('right'), saved: flag('saved'), all: flag('all'),
    preview: flag('preview'), pinned: flag('pinned'), copyable: flag('copyable'), detachable: flag('detachable'),
    moves: Array.isArray(input.moves) ? DIRECTIONS.filter(direction => (input.moves as unknown[]).includes(direction)) : [],
  };
}

export function tabMenu(context: TabMenuContext): TabMenuItem[] {
  const item = (command: TabMenuCommand, label: string, enabled = true, accelerator?: string): TabMenuItem =>
    ({ type: 'command', command, label, enabled, ...(accelerator ? { accelerator } : {}) });
  const file = context.location === 'file';
  const sections: TabMenuItem[][] = [
    [item('close', 'Close', true, 'CmdOrCtrl+W'), item('close-others', 'Close Others', context.others),
      item('close-right', 'Close to the Right', context.right), item('close-saved', 'Close Saved', context.saved),
      item('close-all', 'Close All', context.all)],
    file ? [item('copy-path', 'Copy Path'), item('copy-relative-path', 'Copy Relative Path', context.inProject)]
      : context.location === 'address' ? [item('copy-path', 'Copy Address')] : [],
    file ? [item('reveal-folder', 'Reveal in Folder Tab'), item('reveal-explorer', 'Reveal in Explorer View', context.inProject)] : [],
    [item('keep-open', 'Keep Open', context.preview), context.pinned ? item('unpin', 'Unpin') : item('pin', 'Pin')],
    [item('split-right', 'Split Right', context.copyable), { type: 'submenu', label: 'Split & Move', items: [
      ...DIRECTIONS.map(direction => item(`split-${direction}`, SPLIT[direction], context.copyable)), { type: 'separator' },
      ...DIRECTIONS.map(direction => item(`move-${direction}`, MOVE[direction], context.moves.includes(direction))),
    ] }],
    [item('move-window', 'Move into New Window', context.detachable)],
  ];
  return sections.filter(section => section.length)
    .flatMap((section, index): TabMenuItem[] => index ? [{ type: 'separator' }, ...section] : section);
}

/** Which tabs of a group a bulk close removes. Pinned tabs stay, as in VS Code. */
export function tabCloseTargets(command: 'close-others' | 'close-right' | 'close-saved' | 'close-all',
  group: { tabs: string[]; sticky: number }, tabId: string, dirty: (id: string) => boolean): string[] {
  const loose = group.tabs.slice(group.sticky);
  if (command === 'close-others') return loose.filter(id => id !== tabId);
  if (command === 'close-right') return group.tabs.slice(Math.max(group.sticky, group.tabs.indexOf(tabId) + 1));
  return command === 'close-saved' ? loose.filter(id => !dirty(id)) : loose;
}
