import { GOLDEN_TOP_RATIO, clampAnchor, type ViewportAnchor } from '../../core/preview/viewport-anchor';
import { hasMarkdownPreview } from '../../core/document/document-capabilities';
import type { TabSession, WorkspaceState } from '../../core/workspace/workspace-state';
import type { MonacoEditor } from '../adapters/monaco-editor';
import type { PreviewSession } from '../reader/preview-session';
import type { ReaderController } from '../reader/reader-controller';
import { view } from '../view-state.svelte';

type Options = {
  workspace: WorkspaceState; session: TabSession; shell: HTMLElement; editor: MonacoEditor;
  reader: ReaderController; preview: PreviewSession; changed(): void;
};
export class SurfaceController {
  private anchorRequest = 0;
  private editorPositionFrame: number | null = null;
  constructor(private readonly options: Options) {}
  publishAnchor = (): void => {
    const { anchor } = this.options.session;
    this.options.shell.dataset.anchorLine = String(anchor.sourceLine);
    this.options.shell.dataset.anchorReason = anchor.reason;
    this.options.shell.dataset.anchorConfidence = anchor.confidence;
  };
  set(next: TabSession['surface']): void {
    if (next === 'viewer' && this.options.session.document && !hasMarkdownPreview(this.options.session.document)) next = 'editor';
    this.options.session.surface = next;
    view.surface = next;
    // A capability attribute drives Markdown-only shell controls without adding
    // format dispatch or language initialization to the Markdown hot path.
    this.options.shell.dataset.documentKind = this.options.session.document?.kind ?? (hasMarkdownPreview(this.options.session.document) ? 'markdown' : 'text');
    this.options.shell.dataset.surface = next;
    this.options.reader.syncUi();
    this.options.preview.updateUi();
    this.options.reader.syncView();
    this.options.changed();
    if (next === 'viewer') this.options.reader.restoreSearch();
    if (next === 'editor') window.setTimeout(() => this.options.editor.layout(), 0);
  }
  enterEditor = async (next: ViewportAnchor = this.options.session.anchor): Promise<void> => {
    this.anchorRequest += 1;
    const targetTabId = this.options.workspace.activeId;
    if (!targetTabId || this.options.workspace.active?.document.kind !== undefined) return;
    await this.options.editor.load();
    if (this.options.workspace.activeId !== targetTabId) return;
    const tab = this.options.workspace.active;
    if (!tab || tab.document.kind !== undefined) return;
    this.options.editor.activate(tab);
    if (tab.find.open) this.options.reader.closeFind(false);
    this.options.session.anchor = clampAnchor(next, this.options.editor.lineCount(tab));
    this.publishAnchor();
    this.set('editor');
    this.options.editor.reveal(this.options.session.anchor);
  };
  enterViewer = async (): Promise<void> => {
    const tab = this.options.workspace.active;
    if (!this.options.editor.loaded || !tab || !hasMarkdownPreview(tab.document)) return;
    const startedAt = performance.now();
    const viewport = this.options.editor.viewport(this.options.session.anchor);
    this.options.session.anchor = viewport.anchor;
    this.publishAnchor();
    this.options.preview.cancelSchedule();
    const generation = this.options.preview.generation;
    const revision = tab.revision;
    const anchor = tab.anchor;
    const readyRevision = this.options.preview.readyRevision;
    if (readyRevision !== null) void this.options.preview.position(anchor, readyRevision, tab.id,
      this.options.editor.lineCount(tab), false, viewport.band);
    this.set('viewer');
    window.requestAnimationFrame(() => {
      this.options.shell.dataset.lastViewerFirstFrameMs = String(performance.now() - startedAt);
    });
    void this.options.preview.ensure(revision).then((ready) => {
      if (!ready || generation !== this.options.preview.generation || tab.revision !== revision) return;
      void this.options.preview.position(anchor, revision, tab.id, this.options.editor.lineCount(tab), false, viewport.band);
    });
  };
  toggle = (): void => {
    if (!hasMarkdownPreview(this.options.session.document)) return;
    if (this.options.session.surface === 'viewer') this.requestViewerAnchor();
    else if (this.options.session.surface === 'editor') void this.enterViewer();
  };
  requestViewerAnchor(): void {
    const pendingTabId = this.options.workspace.activeId;
    if (!pendingTabId || !hasMarkdownPreview(this.options.session.document)) return;
    const request = ++this.anchorRequest;
    this.options.reader.send(pendingTabId, { command: 'marktex:request-anchor', topRatio: GOLDEN_TOP_RATIO });
    window.setTimeout(() => {
      if (request !== this.anchorRequest || this.options.workspace.activeId !== pendingTabId) return;
      void this.enterEditor(this.options.session.anchor);
    }, 120);
  }
  editorScrolled = (): void => {
    const { workspace, session, editor, preview, reader } = this.options;
    if (session.surface !== 'editor' || !workspace.activeId || !hasMarkdownPreview(session.document)) return;
    if (this.editorPositionFrame !== null) window.cancelAnimationFrame(this.editorPositionFrame);
    this.editorPositionFrame = window.requestAnimationFrame(() => {
      this.editorPositionFrame = null;
      const tab = workspace.active;
      if (session.surface !== 'editor' || !tab || !workspace.activeId || !hasMarkdownPreview(tab.document)) return;
      const viewport = editor.viewport(session.anchor);
      session.anchor = viewport.anchor;
      this.publishAnchor();
      if (preview.readyRevision === null) return;
      const revealed = clampAnchor(session.anchor, editor.lineCount(tab));
      reader.send(workspace.activeId, { command: 'marktex:position-preview',
        sourceLine: revealed.sourceLine, topRatio: revealed.yRatio, band: viewport.band, settle: false });
    });
  };
}
