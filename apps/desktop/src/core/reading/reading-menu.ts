export type ReadingMenuCommand = 'copy' | 'copy-link' | 'open-link' | 'search' | 'select-all' | 'find' | 'export-markdown' | 'export-pdf';
export type ReadingMenuContext = { selection: string; link: string; markdown?: boolean; pdf?: boolean };
export function readingMenu(context: ReadingMenuContext): Array<{ command: ReadingMenuCommand; label: string }> {
  const items: Array<{ command: ReadingMenuCommand; label: string }> = [];
  if (context.selection.trim()) items.push({ command: 'copy', label: 'Copy' }, { command: 'search', label: 'Search Google' });
  if (/^https?:\/\//i.test(context.link)) items.push({ command: 'copy-link', label: 'Copy Link Address' }, { command: 'open-link', label: 'Open Link in New Tab' });
  items.push({ command: 'select-all', label: 'Select All' }, { command: 'find', label: 'Find in Reading View' });
  if (context.markdown) items.push({ command: 'export-markdown', label: 'Export to Markdown…' });
  if (context.pdf) items.push({ command: 'export-pdf', label: 'Export to PDF…' });
  return items;
}
