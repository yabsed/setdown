import { isDocumentTab, type WorkspaceTab } from '../../core/workspace/workspace-state';

/**
 * Copy in a tab that shows a file as a whole. An image, a video, a PDF or an office document has no
 * text clipboard to offer while nothing in it is selected, so Copy (Ctrl+C, Edit ▸ Copy) takes the file
 * itself, as it does on an Explorer row: it pastes into the Explorer, a folder tab or another
 * application. Selected text (a PDF's, a document's) and every text field keep the text Copy. A text
 * document always keeps it; its file is copied from the tab's context menu, like any file tab's.
 */
const KEEPS_TEXT_COPY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .project-sidebar';

/** The file a Copy with nothing selected takes from this tab. */
export function tabFile(tab: WorkspaceTab | null): string | null {
  return tab && isDocumentTab(tab) && tab.document.kind && !tab.document.isUntitled ? tab.document.path : null;
}

export function installTabFileCopy(options: {
  /** The tab commands act on: the focused group's, unless something else (a review) is shown in its place. */
  tab(): WorkspaceTab | null;
  copy(path: string): Promise<unknown>;
  failed(error: unknown): void;
}): () => void {
  const file = (): string | null => {
    const path = tabFile(options.tab());
    if (!path) return null;
    // What holds the keyboard, also inside a shadow tree (a viewer's own find field). The event's target does
    // not say: with nothing focused it is wherever the last click left the caret, a viewer's field included.
    let focused = document.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    if (focused?.closest(KEEPS_TEXT_COPY)) return null;
    return document.getSelection()?.toString() ? null : path;
  };
  // Blink offers Copy without a selection only to a document that takes `beforecopy`.
  const before = (event: Event) => { if (file()) event.preventDefault(); };
  const copy = (event: Event) => {
    const path = file();
    if (!path) return;
    // Nothing is written here, so the clipboard stays as it is until main has the file on it. The viewer
    // below never hears of it: PDF.js answers every Copy in its text layer, with an empty text for no selection.
    event.preventDefault(); event.stopImmediatePropagation();
    options.copy(path).catch(options.failed);
  };
  // Capturing: a viewer's own handler may stop the event before it bubbles here.
  document.addEventListener('beforecopy', before, true);
  document.addEventListener('copy', copy, true);
  return () => { document.removeEventListener('beforecopy', before, true); document.removeEventListener('copy', copy, true); };
}
