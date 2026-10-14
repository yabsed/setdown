import { clipboard, Menu } from 'electron';
import type { BrowserWindow } from 'electron';
import { readingMenu, type ReadingMenuContext, type ReadingMenuCommand } from '../../core/reading/reading-menu';

export function showReadingMenu(window: BrowserWindow, context: ReadingMenuContext,
  valid: () => boolean, open: (url: string) => void,
  command: (command: ReadingMenuCommand) => void = () => {}): Promise<ReadingMenuCommand | null> {
  const selection = context.selection.slice(0, 5_000_000), link = context.link.slice(0, 16_384);
  return new Promise(resolve => {
    Menu.buildFromTemplate(readingMenu({ ...context, selection, link }).map(item => ({ label: item.label, click: () => {
      if (!valid()) { resolve(null); return; }
      if (item.command === 'copy') clipboard.writeText(selection);
      else if (item.command === 'copy-link') clipboard.writeText(link);
      else if (item.command === 'open-link') open(link);
      else if (item.command === 'search') open(`https://www.google.com/search?q=${encodeURIComponent(selection.trim().slice(0, 1000))}`);
      else command(item.command);
      resolve(item.command);
    } }))).popup({ window, callback: () => resolve(null) });
  });
}
