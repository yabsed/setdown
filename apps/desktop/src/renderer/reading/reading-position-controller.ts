import type { WorkspaceTab } from '../../core/workspace/workspace-state';
import type { ReadingPosition } from '../../core/reading/reading-position';
import type { MonacoEditor } from '../adapters/monaco-editor';
import type { DesktopPort } from '../ports/desktop-port';

export class ReadingPositionController {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly signatures = new Map<string, string>();
  constructor(private readonly options: {
    desktop: DesktopPort; editor: MonacoEditor; active(): WorkspaceTab | null; suspended(): boolean;
  }) {}
  schedule = () => {
    clearTimeout(this.timer);
    const tab = this.options.active();
    if (!tab || tab.restoringPosition || this.options.suspended()) return;
    this.timer = setTimeout(() => { if (this.options.active() === tab) this.capture(tab); }, 200);
  };
  capture(tab = this.options.active()): void {
    clearTimeout(this.timer);
    if (!tab || tab.restoringPosition || this.options.suspended()) return;
    if (tab.surface === 'pdf') return;
    const { editor } = this.options;
    if (tab.surface === 'editor') {
      editor.saveView(tab);
      tab.anchor = editor.viewport(tab.anchor).anchor;
    }
    this.remember(tab, { kind: 'text', surface: tab.surface, anchor: { ...tab.anchor },
      editorView: editor.exportView(tab.id) });
  }
  remember(tab: WorkspaceTab, position: ReadingPosition): void {
    tab.readingPosition = position;
    if (tab.document.isUntitled || tab.restoringPosition) return;
    const signature = JSON.stringify([tab.document.path, tab.document.diskVersion, position]);
    if (this.signatures.get(tab.id) === signature) return;
    this.signatures.set(tab.id, signature);
    this.options.desktop.saveReadingPosition({ version: 1, path: tab.document.path,
      diskVersion: { ...tab.document.diskVersion }, position, observedAt: Date.now() });
  }
  flush = () => { this.capture(); this.options.desktop.flushReadingPositions(); };
}
