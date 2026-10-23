import { project } from '../project-state.svelte';
import { SourceControlController, type SourceControlOptions } from './source-control-controller';
import { GitDiffViewportPort } from './git-diff-viewport';
import type { DiffTab, WorkspaceState } from '../../../core/workspace/workspace-state';
import type { DocumentContent } from '../../../core/workspace/document-store';
import { sharedTextDocument } from '../../../core/workspace/document-store';
import { groupLayout, type EditorOpenOptions } from '../../../core/workspace/editor-groups';
import type { GitHistorySelection } from '../../../protocol/git-history';
import type { DocumentSnapshot, PreviewBounds, PreviewMessage, GitReviewState } from '../../../protocol/desktop-api';
import type { PreviewThemeId } from '../../../core/preview/preview-preferences';
import type { PreviewLayoutCoordinator } from '../../reader/preview-layout-coordinator';

import { reviewDefaults, projectionKeys, createReviewState, reviewViews, type ReviewView } from './review-state.svelte';
export { reviewViews, type ReviewView } from './review-state.svelte';

export type ReviewWorkspaceOptions = SourceControlOptions & {
  workspace: WorkspaceState; layouts: PreviewLayoutCoordinator;
  activate(id: string): Promise<void>;
  render(): void;
  confirmRelease(content: DocumentContent): Promise<boolean>;
  convertToFile?(id: string): void;
  empty?(): void;
};

/** Repository commands share status; every review view owns its presentation. */
export class ReviewWorkspaceController {
  private readonly status: SourceControlController;
  private readonly entries = new Map<string, ReviewView>();
  private readonly pending = new Map<string, Promise<void>>();
  private generation = 0;
  private readonly reviewSnapshots = new Map<string, GitReviewState>();
  private lastReviewId: string | undefined;
  private lastPublished = '';
  private readonly openRequests = new Map<string, symbol>();
  private theme: PreviewThemeId | null = null;
  constructor(private readonly options: ReviewWorkspaceOptions) {
    this.status = new SourceControlController({ ...options, reviewChanged: () => {} });
  }
  restore = async (): Promise<void> => {
    // Main retains this only for the lifetime of this window (renderer Reload).
    // A new process/window still starts with no review or file tabs.
    const saved = await this.options.desktop.getGitReviewState();
    if (!saved || !project.folder || this.entries.size) return;
    const previous = this.options.workspace.activeId;
    if (saved.history) await this.reviewHistory(saved.history); else await this.review(saved.path, saved.staged);
    const entry = this.entries.get(this.options.workspace.activeId ?? '');
    if (!entry) return;
    entry.controller.updateSourceLine(saved.line);
    if (saved.mode === 'rendered') entry.controller.showRendered();
    if (!saved.active && previous && this.options.workspace.find(previous)) await this.options.activate(previous);
  };
  refresh = (): Promise<void> => this.status.refresh();
  initialize = (): Promise<void> => this.status.initialize();
  stage = async (paths: string[]): Promise<void> => { await this.status.stage(paths); await this.reload(); };
  unstage = async (paths: string[]): Promise<void> => { await this.status.unstage(paths); await this.reload(); };
  discard = async (paths: string[], reload: () => Promise<void>): Promise<void> => { await this.status.discard(paths, reload); await this.reload(); };
  remote = async (action: Parameters<SourceControlController['remote']>[0]): Promise<void> => { await this.status.remote(action); await this.reload(); };
  commit = async (message: string): Promise<void> => { await this.status.commit(message); await this.reload(); };
  private async reload(): Promise<void> { await Promise.all([...this.entries.values()].map(entry => entry.controller.refreshOpenDiffs())); }
  documentSaved = async (document: DocumentSnapshot): Promise<void> => {
    await Promise.all([...this.entries.values()].map(entry => entry.controller.documentSaved(document)));
    await this.status.refresh();
  };
  review = (path: string, staged: boolean, options?: EditorOpenOptions): Promise<void> => {
    const groups = this.options.workspace.groups, origin = options?.groupId ?? groups.focusedId;
    const target = options?.side ? groups.side(origin).id : origin;
    return this.open(path, staged, undefined, target);
  };
  reviewHistory = (selection: GitHistorySelection): Promise<void> => this.open(/^(?:\/|[a-z]:[\\/])/i.test(selection.path)
    ? selection.path : `${selection.root.replace(/[\\/]$/, '')}/${selection.path}`, false, selection);
  copyToGroup = async (id: string, groupId: string, direction: import('../../../core/workspace/editor-groups').SplitDirection | null): Promise<void> => {
    const tab = this.options.workspace.find(id);
    if (tab?.kind !== 'diff' || !this.options.workspace.groups.groups.some(group => group.id === groupId)) return;
    const source = this.entries.get(id), viewport = source?.viewport.read(id), mode = source?.state.gitDiffMode;
    const group = direction ? this.options.workspace.groups.split(groupId, direction).id : groupId;
    await this.open(tab.filePath, tab.staged, tab.history, group);
    const target = [...this.entries.values()].find(entry => this.options.workspace.groups.owner(entry.id)?.id === group && entry.state.gitDiff?.filePath === tab.filePath);
    if (target && target.id !== id) {
      if (viewport) { target.viewport.requestSource(target.id, structuredClone(viewport)); target.controller.updateSourceLine(viewport.anchor.sourceLine); }
      if (mode === 'rendered') target.controller.showRendered();
    }
    this.options.workspace.groups.pruneEmpty(); this.options.render();
  };
  private open(path: string, staged: boolean, history?: GitHistorySelection, targetGroup = this.options.workspace.groups.focusedId): Promise<void> {
    const key = JSON.stringify([targetGroup, path, staged, history]);
    const prior = this.pending.get(key); if (prior) return prior;
    const request = Symbol(); this.openRequests.set(targetGroup, request);
    const task = this.openView(path, staged, history, targetGroup, request).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); });
    this.pending.set(key, task); return task;
  }
  private async openView(path: string, staged: boolean, history: GitHistorySelection | undefined, groupId: string, request: symbol): Promise<void> {
    const { workspace } = this.options;
    const group = workspace.groups.groups.find(group => group.id === groupId); if (!group) return;
    const existing = workspace.tabs.find(tab => tab.kind === 'diff' && group.tabs.includes(tab.id)
      && tab.filePath === path && tab.staged === staged && JSON.stringify(tab.history) === JSON.stringify(history));
    if (existing) { await this.options.activate(existing.id); return; }
    const generation = this.generation, id = crypto.randomUUID(), focused = workspace.groups.focusedId, active = workspace.activeId;
    const current = () => generation === this.generation && this.openRequests.get(groupId) === request && workspace.groups.groups.includes(group);
    let content: DocumentContent | undefined;
    try {
      if (!staged && !history) {
        const existing = workspace.documentStore.find(path);
        if (existing) { workspace.documentStore.retain(existing.id, id); content = existing; }
        else try {
          const snapshot = await this.options.desktop.readDocumentLocation(path);
          if (sharedTextDocument(snapshot)) content = await workspace.documentStore.acquire(path, id, async () => snapshot);
        } catch (error) { if (!/ENOENT|no such file/i.test(String(error))) throw error; }
        // Retaining content is enough to make its model available through the
        // live-document provider. GitDiffEditor borrows it with its own Monaco
        // module. Loading an ordinary editor here serializes native preview
        // preparation behind Monaco and activates an unrelated source surface.
      }
      if (!current()) return;
      const state = createReviewState(), viewport = new GitDiffViewportPort();
      const port = this.options.layouts.port(id);
      const desktop = { ...port, updateGitReviewState: (value: Parameters<typeof port.updateGitReviewState>[0]) => {
        if (value) this.reviewSnapshots.set(id, { ...value, dirty: !!content && content.text !== content.document.savedText });
        else this.reviewSnapshots.delete(id);
        this.publishProjection();
      } };
      const controller = new SourceControlController({ ...this.options, desktop, state, viewport,
        createId: () => id, openWorkingTree: async () => true, activateWorkingTree: () => true,
        workingTreeEditable: path => !!workspace.documentStore.find(path),
        retargetWorkingTree: (from, to) => this.retarget(id, from, to),
        reviewChanged: () => this.projectFocused(), stateChanged: () => this.projectFocused() });
      const entry = { id, state, viewport, controller }; this.entries.set(id, entry);
      const tab: DiffTab = { kind: 'diff', surface: 'diff', id, filePath: path, staged, history, documentId: content?.id };
      workspace.add(tab, true, groupId);
      reviewViews.entries = [...this.entries.values()];
      if (history) await controller.reviewHistory(history); else await controller.review(path, staged);
      if (this.theme) await controller.applyTheme(this.theme);
      if (!current()) {
        workspace.remove(id); controller.dispose(); this.entries.delete(id); reviewViews.entries = [...this.entries.values()]; return;
      }
      this.options.render();
      if (workspace.groups.focusedId === focused && workspace.activeId === active) await this.options.activate(id);
      else if (workspace.groups.focusedId !== groupId) { group.activeId = id; this.options.render(); this.sync(); }
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
      if (workspace.find(id)) { workspace.remove(id); this.entries.get(id)?.controller.dispose(); this.entries.delete(id); reviewViews.entries = [...this.entries.values()]; }
    } finally {
      if (content && !workspace.find(id)) workspace.documentStore.release(content.id, id);
      workspace.groups.pruneEmpty();
    }
  }
  activateDiff = async (id = this.options.workspace.activeId): Promise<void> => {
    if (!id) return;
    const entry = this.entries.get(id); if (!entry) return;
    this.options.workspace.activeId = id;
    if (!entry.state.gitDiffActive) await entry.controller.activateDiff(id);
    this.sync();
  };
  // Selecting an ordinary view only changes the focused command projection.
  // Visible review groups remain mounted, observed and editable.
  deactivateDiff = (): void => { this.projectFocused(true); };
  sync = (): void => {
    const { workspace } = this.options;
    const visibleGroups = new Set(groupLayout(workspace.groups.displayTree).groups.map(group => group.id));
    for (const entry of this.entries.values()) {
      const visible = workspace.groups.groups.some(group => visibleGroups.has(group.id) && group.activeId === entry.id);
      if (!visible && entry.state.gitDiffActive) entry.controller.deactivateDiff();
      if (visible && !entry.state.gitDiffActive) void entry.controller.activateDiff(entry.id);
    }
    this.options.layouts.focus(this.entries.has(workspace.activeId ?? '') ? workspace.activeId! : 'documents');
    this.projectFocused();
  };
  private projectFocused(forceDocument = false): void {
    const state = !forceDocument && this.entries.get(this.options.workspace.activeId ?? '')?.state;
    const projection = state || reviewDefaults();
    for (const key of projectionKeys) Object.assign(project, { [key]: projection[key] });
    project.gitDiffTabs = [...this.entries.values()].flatMap(entry => entry.state.gitDiffTabs);
    this.options.reviewChanged(this.entries.size > 0, !!state && state.gitDiffActive);
    this.publishProjection();
  }
  private publishProjection(): void {
    const active = this.options.workspace.activeId;
    if (active && this.reviewSnapshots.has(active)) this.lastReviewId = active;
    // Do not erase main's Reload checkpoint before restore has read it.
    if (!this.lastReviewId) return;
    const saved = this.reviewSnapshots.get(this.lastReviewId);
    const value = saved ? { ...saved, active: active === this.lastReviewId } : null;
    const serialized = JSON.stringify(value);
    if (serialized !== this.lastPublished) { this.lastPublished = serialized; this.options.desktop.updateGitReviewState(value); }
  }
  closeDiff = async (id = this.options.workspace.activeId, confirmed = false): Promise<void> => {
    if (!id) return;
    const { workspace } = this.options, entry = this.entries.get(id), tab = workspace.find(id);
    if (!entry || tab?.kind !== 'diff') return;
    const content = tab.documentId ? workspace.documentStore.get(tab.documentId) : undefined;
    if (!confirmed && content && content.references.size === 1 && !await this.options.confirmRelease(content)) return;
    if (workspace.find(id) !== tab) return;
    entry.controller.dispose(); this.entries.delete(id); this.reviewSnapshots.delete(id); this.options.layouts.remove(id);
    const removed = workspace.remove(id)!;
    if (content) workspace.documentStore.release(content.id, id);
    reviewViews.entries = [...this.entries.values()];
    this.options.render();
    const replacement = removed.wasActive ? workspace.replacement(removed.index) : null;
    if (replacement) await this.options.activate(replacement.id);
    else if (!workspace.active) this.options.empty?.();
    this.sync();
  };
  closeWorkingTreeReviews = (_path: string): void => {}; // File views do not own review views.
  layoutDiff = (bounds: PreviewBounds | null): void => { this.active()?.controller.layoutDiff(bounds); };
  updateSourceLine = (line: number): void => { this.active()?.controller.updateSourceLine(line); };
  toggleDiffMode = (): void => { this.active()?.controller.toggleDiffMode(); };
  showRendered = (): void => { this.active()?.controller.showRendered(); };
  changeWorkingTree = (...args: Parameters<SourceControlController['changeWorkingTree']>): void => { this.active()?.controller.changeWorkingTree(...args); };
  previewMessage = (payload: PreviewMessage): boolean => {
    const entry = [...this.entries.values()].find(entry => payload.tabId.startsWith(`git-diff:${entry.id}:`));
    if (!entry) return false;
    if (payload.message.type === 'marktex:focus' && this.options.workspace.activeId !== entry.id) void this.options.activate(entry.id);
    return entry.controller.previewMessage(payload);
  };
  applyTheme = async (theme: PreviewThemeId): Promise<void> => { this.theme = theme; await Promise.all([...this.entries.values()].map(entry => entry.controller.applyTheme(theme))); };
  private active(): ReviewView | undefined { return this.entries.get(this.options.workspace.activeId ?? ''); }
  private retarget(id: string, from: string, to: string): void {
    const tab = this.options.workspace.find(id), entry = this.entries.get(id);
    if (tab?.kind !== 'diff' || tab.filePath !== from || !entry) return;
    const root = project.folder?.path;
    tab.filePath = to;
    if (root && (to.startsWith(`${root}/`) || to.startsWith(`${root}\\`))) entry.controller.retarget(from, to);
    else {
      this.options.convertToFile?.(id);
      entry.controller.dispose(); this.entries.delete(id); this.reviewSnapshots.delete(id); this.options.layouts.remove(id);
      reviewViews.entries = [...this.entries.values()]; this.projectFocused();
    }
    this.options.render();
  }
  clear = (): void => {
    this.generation++;
    // Closing/changing the repository does not discard a Working Tree buffer.
    for (const tab of [...this.options.workspace.tabs]) if (tab.kind === 'diff' && tab.documentId) this.options.convertToFile?.(tab.id);
    for (const entry of this.entries.values()) { entry.controller.dispose(); this.options.layouts.remove(entry.id); }
    for (const tab of [...this.options.workspace.tabs]) if (tab.kind === 'diff') {
      this.options.workspace.remove(tab.id);
      if (tab.documentId) this.options.workspace.documentStore.release(tab.documentId, tab.id);
    }
    this.entries.clear(); this.reviewSnapshots.clear(); reviewViews.entries = []; this.status.clear(); this.options.render(); this.projectFocused();
  };
}
