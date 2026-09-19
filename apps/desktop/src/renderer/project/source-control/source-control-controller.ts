import { textDiffHunks } from '../../../core/diff/text-diff';
import type { PreviewThemeId } from '../../../core/preview/preview-preferences';
import { readReviewBookmark, reviewViewport, reviewPositionCommand, type ReviewViewport }
  from '../../../core/preview/review-viewport';
import { gitDiffViewport, type GitDiffViewportPort } from './git-diff-viewport';
import type {
  DocumentSnapshot,
  GitDiff,
  GitRemoteAction,
  GitReviewState,
  GitSnapshot,
  PreviewBounds,
  PreviewMessage,
} from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import type { WorkingTreeEdit } from '../../view-state.svelte';
import { project, type GitDiffTabState } from '../project-state.svelte';

type Options = {
  desktop: DesktopPort;
  viewport?: GitDiffViewportPort;
  openWorkingTree(path: string): Promise<boolean>;
  activateWorkingTree(path: string): boolean;
  workingTreeBuffer(path: string): string | null;
  workingTreeChanged(path: string, text: string, edits?: WorkingTreeEdit[]): void;
  reviewChanged(open: boolean, active: boolean): void;
};

type ReviewReadingState = {
  source: ReviewViewport;
  viewer: ReviewViewport | null;
  presentedId: string | null;
  presentedBounds: PreviewBounds | null;
  observationId: number | null;
  observedId: string | null;
  sequence: number;
};
const PREVIEW_DEBOUNCE_MS = 400;

export class SourceControlController {
  private readonly loadGenerations = new Map<string, number>();
  private readonly previewTimers = new Map<string, number>();
  private refreshRequested = false;
  private refreshTask: Promise<void> | null = null;
  private statusGeneration = 0;
  private bounds: PreviewBounds | null = null;
  private pendingPreviewPosition: { tabId: string; intent: 'source' | 'resume' } | null = null;
  private readonly readingStates = new Map<string, ReviewReadingState>();
  private observationSequence = 0;
  private get viewport(): GitDiffViewportPort { return this.options.viewport ?? gitDiffViewport; }
  private themeId: PreviewThemeId | null = null;
  private overlayDepth = 0;
  private overlayToken = 0;
  private overlayFrozen = false;

  constructor(private readonly options: Options) {
    window.addEventListener('setdown:native-overlay-visibility', ((event: CustomEvent<boolean>) => {
      if (event.detail) void this.freezePreview();
      else this.unfreezePreview();
    }) as EventListener);
  }

  restore = async (): Promise<void> => {
    const saved = await this.options.desktop.getGitReviewState();
    if (!saved || !project.folder || project.gitDiffTabs.length) return;
    if (!saved.staged && !this.options.activateWorkingTree(saved.path)
      && !await this.options.openWorkingTree(saved.path)) return;
    const created = this.createTab(saved.path, saved.staged, saved.mode, saved.line);
    project.gitDiffTabs.push(created);
    const tab = project.gitDiffTabs.find((candidate) => candidate.id === created.id)!;
    if (saved.active) this.activateTabState(tab);
    else this.options.reviewChanged(true, false);
    void this.reloadTab(tab);
  };

  refresh = (): Promise<void> => {
    if (!project.folder) return Promise.resolve();
    this.refreshRequested = true;
    if (this.refreshTask) return this.refreshTask;
    if (project.gitBusy) return Promise.resolve();
    this.refreshTask = this.drainStatusRefreshes().finally(() => {
      this.refreshTask = null;
      if (this.refreshRequested && project.folder && !project.gitBusy) void this.refresh();
    });
    return this.refreshTask;
  };

  private async drainStatusRefreshes(): Promise<void> {
    project.gitLoading = true;
    try {
      while (this.refreshRequested && project.folder && !project.gitBusy) {
        this.refreshRequested = false;
        const root = project.folder.path;
        const generation = this.statusGeneration;
        const current = () => generation === this.statusGeneration
          && root === project.folder?.path && !project.gitBusy;
        try {
          const snapshot = await this.options.desktop.getGitStatus();
          if (current()) project.git = snapshot;
        } catch (error) {
          if (current()) project.error = error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      project.gitLoading = false;
    }
  }

  documentSaved = async (document: DocumentSnapshot): Promise<void> => {
    const tabs = project.gitDiffTabs.filter((tab) =>
      !tab.staged && tab.filePath === document.path);
    await Promise.all(tabs.map((tab) => this.reloadTab(tab)));
    // The badge must update even when this document has never opened a review.
    await this.refresh();
  };

  review = async (filePath: string, staged: boolean): Promise<void> => {
    if (!staged && !this.options.activateWorkingTree(filePath)
      && !await this.options.openWorkingTree(filePath)) return;
    let tab = project.gitDiffTabs.find((candidate) =>
      candidate.filePath === filePath && candidate.staged === staged);
    if (!tab) {
      const created = this.createTab(filePath, staged);
      project.gitDiffTabs.push(created);
      tab = project.gitDiffTabs.find((candidate) => candidate.id === created.id)!;
    }
    this.activateTabState(tab);
    if (!tab.diff && !tab.loading) void this.reloadTab(tab);
  };

  closeDiff = (id = project.activeGitDiffId): void => {
    if (!id) return;
    const index = project.gitDiffTabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const tab = project.gitDiffTabs[index];
    const wasActive = id === project.activeGitDiffId;
    this.disposeTab(tab);
    project.gitDiffTabs.splice(index, 1);
    if (!wasActive) {
      this.options.reviewChanged(project.gitDiffTabs.length > 0, project.gitDiffActive);
      return;
    }
    this.options.desktop.showPreview(null, null);
    this.overlayFrozen = false;
    const replacement = project.gitDiffTabs[Math.min(index, project.gitDiffTabs.length - 1)];
    project.activeGitDiffId = null;
    this.resetActiveState();
    if (replacement) void this.activateDiff(replacement.id);
    else {
      this.options.desktop.updateGitReviewState(null);
      this.options.reviewChanged(false, false);
    }
  };

  closeWorkingTreeReviews = (filePath: string): void => {
    const ids = project.gitDiffTabs
      .filter((tab) => !tab.staged && tab.filePath === filePath)
      .map((tab) => tab.id);
    for (const id of ids) this.closeDiff(id);
  };

  activateDiff = async (id = project.activeGitDiffId): Promise<void> => {
    const tab = project.gitDiffTabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    if (!tab.staged && !this.options.activateWorkingTree(tab.filePath)
      && !await this.options.openWorkingTree(tab.filePath)) return;
    this.activateTabState(tab);
    if (!tab.diff && !tab.loading) void this.reloadTab(tab);
  };

  deactivateDiff = (): void => {
    if (!project.gitDiffActive) return;
    this.rememberActiveTab();
    project.gitDiffActive = false;
    this.bounds = null;
    this.pendingPreviewPosition = null;
    this.options.desktop.showPreview(null, null);
    this.options.reviewChanged(project.gitDiffTabs.length > 0, false);
    this.publishReview();
  };

  layoutDiff = (bounds: PreviewBounds | null): void => {
    // A hidden/unmounted source surface has no current preview geometry.
    // Do not let cached bounds make a cold preview look ready for positioning.
    this.bounds = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      && bounds.width > 0 && bounds.height > 0 ? bounds : null;
    if (project.gitDiffActive) this.syncPreview();
  };

  updateSourceLine = (line: number): void => {
    const tab = this.activeTab();
    if (!tab || !project.gitDiffActive || project.gitDiffMode !== 'source') return;
    tab.line = Math.max(1, Math.round(line) || 1);
  };

  toggleDiffMode = (): void => {
    if (!project.gitDiff) return;
    if (project.gitDiffMode === 'rendered') {
      const tab = this.activeTab();
      if (tab) this.showSource(this.readingState(tab).viewer ?? this.readingState(tab).source);
    }
    else this.showRendered();
  };

  showRendered = (): void => {
    const tab = this.activeTab();
    if (!tab?.diff || project.gitDiffMode === 'rendered') return;
    // Switching surfaces does not need a fresh text diff. Preparation computes
    // hunks off this immediate path; the live buffer was already mirrored.
    const diff = tab.diff;
    if (!this.renderable(diff)) return;
    const reading = this.readingState(tab);
    reading.source = this.viewport.read(tab.id) ?? reviewViewport(tab.line);
    reading.viewer = null; // Esc is a new navigation intent, not a tab resume.
    reading.observationId = null;
    reading.observedId = null;
    tab.mode = 'rendered';
    project.gitDiffLine = tab.line || 1;
    project.gitDiff = diff;
    project.gitDiffMode = 'rendered';
    this.copyPreviewState(tab);
    this.syncPreview('source');
    if (tab.previewDirty || !tab.previewId) this.schedulePreview(tab, 0);
    this.publishReview();
  };

  previewMessage = (payload: PreviewMessage): boolean => {
    const tab = project.gitDiffTabs.find((candidate) =>
      this.previewIds(candidate).includes(payload.tabId));
    if (!tab) return false;
    const message = payload.message;
    const reading = this.readingState(tab);
    if (message.type === 'marktex:viewport-state') {
      // A/B back-buffer load, hidden layout and obsolete observation sessions
      // may publish too. Only a session we actually presented owns reading state.
      if (tab.mode !== 'rendered' || message.observationId !== reading.observationId
        || reading.observationId === null || payload.tabId !== reading.observedId
        || typeof message.sequence !== 'number' || !Number.isFinite(message.sequence)
        || message.sequence <= reading.sequence) return true;
      const bookmark = readReviewBookmark(message.anchor);
      if (bookmark) {
        reading.viewer = bookmark;
        reading.sequence = message.sequence;
      }
      return true;
    }
    if (message.type === 'edit-at-anchor') {
      // Background/obsolete views must never activate tabs or move the caret.
      if (!project.gitDiffActive || project.activeGitDiffId !== tab.id
        || project.gitDiffMode !== 'rendered' || payload.tabId !== tab.previewId) return true;
      const bookmark = readReviewBookmark(message.anchor);
      if (bookmark) this.showSource(bookmark);
    }
    // Do not route Git viewport/headings messages into ordinary document state.
    return true;
  };

  applyTheme = async (themeId: PreviewThemeId): Promise<void> => {
    this.themeId = themeId;
    const previews = project.gitDiffTabs.flatMap((tab) => this.previewIds(tab));
    if (!previews.length) return;
    const assets = await this.options.desktop.getPreviewThemeAssets(themeId);
    if (this.themeId !== themeId) return;
    for (const previewId of previews) {
      this.options.desktop.sendPreviewCommand(previewId, {
        command: 'marktex:apply-theme', ...assets,
      });
    }
  };

  initialize = (): Promise<void> => this.mutate(() => this.options.desktop.initializeGit());
  stage = (paths: string[]): Promise<void> => this.mutate(() => this.options.desktop.stageGit(paths));
  unstage = (paths: string[]): Promise<void> => this.mutate(() => this.options.desktop.unstageGit(paths));
  discard = (paths: string[], reloadDocuments: () => Promise<void>): Promise<void> =>
    this.mutate(() => this.options.desktop.discardGit(paths), reloadDocuments);
  remote = (action: GitRemoteAction): Promise<void> =>
    this.mutate(() => this.options.desktop.runGitRemote(action));

  commit = async (message: string): Promise<void> => {
    await this.mutate(() => this.options.desktop.commitGit(message));
    if (!project.error) project.commitMessage = '';
  };

  changeWorkingTree = (text: string, edits?: WorkingTreeEdit[]): void => {
    const tab = this.activeTab();
    const diff = tab?.diff;
    if (!tab || !diff || diff.staged || diff.originalText === null
      || diff.modifiedText === null) return;
    this.options.workingTreeChanged(diff.filePath, text, edits);
    tab.diff = {
      ...diff,
      modifiedText: text,
      modifiedLabel: 'WORKTREE',
    };
    this.invalidatePreview(tab);
    this.schedulePreview(tab, PREVIEW_DEBOUNCE_MS);
  };

  clear = (): void => {
    this.statusGeneration += 1;
    this.refreshRequested = false;
    for (const tab of [...project.gitDiffTabs]) this.disposeTab(tab);
    project.git = null;
    project.gitDiffTabs.splice(0);
    project.activeGitDiffId = null;
    this.options.desktop.showPreview(null, null);
    this.overlayFrozen = false;
    this.resetActiveState();
    this.options.desktop.updateGitReviewState(null);
    this.options.reviewChanged(false, false);
    project.commitMessage = '';
  };

  private createTab(
    filePath: string,
    staged: boolean,
    mode: GitDiffTabState['mode'] = 'source',
    line = 0,
  ): GitDiffTabState {
    return {
      id: crypto.randomUUID(),
      filePath,
      staged,
      mode,
      line,
      diff: null,
      loading: false,
      previewId: null,
      pendingPreviewId: null,
      previewLoading: false,
      previewDirty: true,
    };
  }

  private activeTab(): GitDiffTabState | null {
    return project.gitDiffTabs.find((candidate) => candidate.id === project.activeGitDiffId) ?? null;
  }

  private activateTabState(tab: GitDiffTabState): void {
    this.rememberActiveTab();
    if (tab.diff && !tab.staged) {
      const effective = this.effectiveDiff(tab.diff);
      if (effective.modifiedText !== tab.diff.modifiedText) {
        tab.diff = effective;
        this.invalidatePreview(tab);
        this.schedulePreview(tab, PREVIEW_DEBOUNCE_MS);
      }
    }
    if (tab.diff && !this.renderable(tab.diff)) tab.mode = 'source';
    project.activeGitDiffId = tab.id;
    Object.assign(project, {
      gitDiff: tab.diff,
      gitDiffTarget: { filePath: tab.filePath, staged: tab.staged },
      gitDiffActive: true,
      gitDiffLoading: tab.loading,
      gitDiffMode: tab.mode,
      gitDiffFrozen: false,
      gitDiffSnapshot: '',
      gitDiffLine: tab.line || (tab.diff ? this.firstChangedLine(tab.diff) : 1),
    });
    this.copyPreviewState(tab);
    this.options.reviewChanged(true, true);
    project.error = '';
    this.syncPreview('resume');
    if (tab.diff && this.renderable(tab.diff) && !tab.previewLoading
      && (tab.previewDirty || !tab.previewId)) this.schedulePreview(tab, 0);
    this.publishReview();
  }

  private showSource(target: ReviewViewport): void {
    const tab = this.activeTab();
    if (!tab) return;
    if (tab.diff) {
      tab.diff = this.effectiveDiff(tab.diff);
      project.gitDiff = tab.diff;
    }
    this.pauseObservation(tab);
    const reading = this.readingState(tab);
    reading.observationId = null;
    reading.source = { ...target, band: [], blockOffset: undefined };
    this.viewport.requestSource(tab.id, reading.source);
    const line = target.anchor.sourceLine;
    tab.line = line;
    tab.mode = 'source';
    project.gitDiffLine = line;
    project.gitDiffMode = 'source';
    this.bounds = null;
    this.pendingPreviewPosition = null;
    if (project.gitDiffActive) this.options.desktop.showPreview(null, null);
    this.publishReview();
  }

  private async reloadTab(tab: GitDiffTabState): Promise<void> {
    const generation = (this.loadGenerations.get(tab.id) ?? 0) + 1;
    this.loadGenerations.set(tab.id, generation);
    tab.loading = true;
    if (this.activeTab()?.id === tab.id) project.gitDiffLoading = true;
    try {
      const stored = await this.options.desktop.getGitDiff(tab.filePath, tab.staged);
      if (!this.isCurrentLoad(tab, generation)) return;
      const diff = this.effectiveDiff(stored);
      const changed = this.diffSignature(tab.diff) !== this.diffSignature(diff);
      tab.diff = diff;
      tab.line ||= this.firstChangedLine(diff);
      if (!this.renderable(diff)) tab.mode = 'source';
      if (changed) this.invalidatePreview(tab);
      if (this.activeTab()?.id === tab.id) {
        Object.assign(project, {
          gitDiff: diff,
          gitDiffMode: tab.mode,
          gitDiffLine: tab.line,
        });
        this.copyPreviewState(tab);
        this.publishReview();
      }
      if (this.renderable(diff) && (tab.previewDirty || !tab.previewId)) {
        this.schedulePreview(tab, 0);
      }
    } catch (error) {
      if (this.isCurrentLoad(tab, generation)) {
        project.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (this.isCurrentLoad(tab, generation)) {
        tab.loading = false;
        if (this.activeTab()?.id === tab.id) project.gitDiffLoading = false;
      }
    }
  }

  private isCurrentLoad(tab: GitDiffTabState, generation: number): boolean {
    return project.gitDiffTabs.some((candidate) => candidate.id === tab.id)
      && this.loadGenerations.get(tab.id) === generation;
  }

  private rememberActiveTab(): void {
    const tab = this.activeTab();
    if (!tab || !project.gitDiffActive) return;
    tab.mode = project.gitDiffMode;
    // Source and Viewer positions are not interchangeable.
    if (tab.mode === 'rendered') this.pauseObservation(tab);
  }

  private resetActiveState(): void {
    this.bounds = null;
    this.pendingPreviewPosition = null;
    Object.assign(project, {
      gitDiff: null,
      gitDiffTarget: null,
      gitDiffActive: false,
      gitDiffLoading: false,
      gitDiffPreviewLoading: false,
      gitDiffPreviewReady: false,
      gitDiffFrozen: false,
      gitDiffSnapshot: '',
      gitDiffLine: 1,
    });
  }

  private copyPreviewState(tab: GitDiffTabState): void {
    project.gitDiffPreviewLoading = tab.previewLoading;
    project.gitDiffPreviewReady = !!tab.previewId;
  }

  private readingState(tab: GitDiffTabState): ReviewReadingState {
    let state = this.readingStates.get(tab.id);
    if (!state) {
      state = { source: reviewViewport(tab.line), viewer: null, presentedId: null,
        presentedBounds: null, observationId: null, observedId: null, sequence: 0 };
      this.readingStates.set(tab.id, state);
    }
    return state;
  }

  private pauseObservation(tab: GitDiffTabState): void {
    const reading = this.readingStates.get(tab.id);
    if (!reading?.observedId || reading.observationId === null) return;
    this.options.desktop.sendPreviewCommand(reading.observedId, {
      command: 'marktex:observe-viewport', observationId: null,
    });
    // Retain the token to accept the final scroll sample after tab deactivation.
    // A subsequent presentation or Esc replaces it, rejecting late old samples.
  }

  private syncPreview(intent?: 'source' | 'resume'): void {
    const tab = this.activeTab();
    if (intent) {
      if (!project.gitDiffActive || project.gitDiffMode !== 'rendered' || !tab) {
        this.pendingPreviewPosition = null;
      } else if (intent === 'source' || this.pendingPreviewPosition?.tabId !== tab.id) {
        this.pendingPreviewPosition = { tabId: tab.id, intent };
      }
    }
    if (!project.gitDiffActive || this.overlayFrozen) return;
    const previewId = project.gitDiffMode === 'rendered' ? tab?.previewId : null;
    const shownId = this.bounds ? previewId : null;
    this.options.desktop.showPreview(shownId ?? null, shownId ? this.bounds : null);
    // Retain cold-Esc intent until both the page and CURRENT geometry exist.
    // Keep show/bounds -> position ordering without awaiting layout or rendering.
    if (!tab || !shownId || !this.bounds) return;
    const reading = this.readingState(tab);
    if (this.pendingPreviewPosition?.tabId !== tab.id) {
      if (reading.presentedId === shownId) reading.presentedBounds = { ...this.bounds };
      return;
    }
    const pending = this.pendingPreviewPosition;
    this.pendingPreviewPosition = null;
    const samePage = reading.presentedId === shownId;
    const sameSize = reading.presentedBounds?.width === this.bounds.width
      && reading.presentedBounds?.height === this.bounds.height;
    if (pending.intent === 'source' || !samePage || !sameSize) {
      this.options.desktop.sendPreviewCommand(shownId, reviewPositionCommand(
        pending.intent === 'source' ? reading.source : reading.viewer ?? reading.source,
      ));
    }
    // A same-page, same-layout resume deliberately sends NO scroll command.
    // Native scrollTop is more precise than reconstructing a source-line anchor.
    reading.presentedId = shownId;
    reading.presentedBounds = { ...this.bounds };
    reading.observedId = shownId;
    reading.observationId = ++this.observationSequence;
    reading.sequence = 0;
    this.options.desktop.sendPreviewCommand(shownId, {
      command: 'marktex:observe-viewport', observationId: reading.observationId,
    });
  }

  private invalidatePreview(tab: GitDiffTabState): void {
    tab.previewDirty = true;
    const timer = this.previewTimers.get(tab.id);
    if (timer !== undefined) window.clearTimeout(timer);
    this.previewTimers.delete(tab.id);
  }

  private schedulePreview(tab: GitDiffTabState, delay: number): void {
    const existing = this.previewTimers.get(tab.id);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.previewTimers.delete(tab.id);
      void this.preparePreview(tab);
    }, delay);
    this.previewTimers.set(tab.id, timer);
  }

  private previewIds(tab: GitDiffTabState): [string, string] {
    return [`git-diff:${tab.id}:a`, `git-diff:${tab.id}:b`];
  }

  private tabExists(tab: GitDiffTabState): boolean {
    return project.gitDiffTabs.some((candidate) => candidate.id === tab.id);
  }

  private async preparePreview(tab: GitDiffTabState): Promise<void> {
    if (!this.tabExists(tab)) return;
    const diff = tab.diff && this.effectiveDiff(tab.diff);
    if (!diff || !this.renderable(diff)) return;
    if (tab.previewLoading) {
      // Renders are serialized per tab; the in-flight prepare re-triggers us.
      tab.previewDirty = true;
      return;
    }
    tab.diff = diff;
    const [frontId, backId] = this.previewIds(tab);
    const candidateId = tab.previewId === frontId ? backId : frontId;
    tab.pendingPreviewId = candidateId;
    tab.previewLoading = true;
    tab.previewDirty = false;
    if (this.activeTab()?.id === tab.id) this.copyPreviewState(tab);
    try {
      if (!this.themeId) {
        const theme = await this.options.desktop.getTheme();
        this.themeId = theme.id;
      }
      if (!this.tabExists(tab)) return;
      const rendered = await this.options.desktop.prepareGitDiffPreview(
        candidateId,
        this.serializableDiff(diff),
        this.themeId,
      );
      if (!this.tabExists(tab)) return;
      tab.pendingPreviewId = null;
      tab.previewLoading = false;
      if (!rendered.supported) {
        this.options.desktop.destroyPreview(candidateId);
        if (!tab.previewId && tab.mode === 'rendered') tab.mode = 'source';
      } else if (!tab.previewDirty) {
        // Swap to the freshly rendered hidden view. The previous view stays
        // alive as the next render target, so generations neither create nor
        // destroy native views.
        this.pauseObservation(tab);
        const reading = this.readingState(tab);
        reading.presentedId = null;
        reading.observationId = null;
        reading.observedId = null;
        tab.previewId = candidateId;
        if (this.activeTab()?.id === tab.id) {
          project.gitDiff = tab.diff;
          project.gitDiffMode = tab.mode;
          this.copyPreviewState(tab);
          this.syncPreview('resume');
          this.publishReview();
        }
      }
      if (this.activeTab()?.id === tab.id) this.copyPreviewState(tab);
      if (tab.previewDirty) this.schedulePreview(tab, 0);
    } catch (error) {
      this.options.desktop.destroyPreview(candidateId);
      if (this.tabExists(tab)) {
        tab.pendingPreviewId = null;
        tab.previewLoading = false;
        tab.previewDirty = true;
        if (this.activeTab()?.id === tab.id) {
          this.copyPreviewState(tab);
          project.error = error instanceof Error ? error.message : String(error);
        }
      }
    }
  }

  private disposeTab(tab: GitDiffTabState): void {
    if (this.pendingPreviewPosition?.tabId === tab.id) this.pendingPreviewPosition = null;
    this.readingStates.delete(tab.id);
    this.viewport.forget(tab.id);
    this.loadGenerations.set(tab.id, (this.loadGenerations.get(tab.id) ?? 0) + 1);
    const timer = this.previewTimers.get(tab.id);
    if (timer !== undefined) window.clearTimeout(timer);
    this.previewTimers.delete(tab.id);
    for (const id of this.previewIds(tab)) this.options.desktop.destroyPreview(id);
    this.loadGenerations.delete(tab.id);
  }

  private async mutate(
    action: () => Promise<GitSnapshot>,
    afterAction?: () => Promise<void>,
  ): Promise<void> {
    if (project.gitBusy) return;
    // A status read begun before a write must not overwrite the write's result.
    this.statusGeneration += 1;
    project.gitBusy = true;
    try {
      await this.perform(action);
      if (!project.error) await afterAction?.();
      if (!project.error) await this.refreshOpenDiffs();
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
    } finally {
      project.gitBusy = false;
      if (this.refreshRequested) void this.refresh();
    }
  }

  private async perform(action: () => Promise<GitSnapshot>, clear = true): Promise<void> {
    if (clear) project.error = '';
    try {
      project.git = await action();
      project.error = '';
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async refreshOpenDiffs(): Promise<void> {
    await Promise.all([...project.gitDiffTabs].map((tab) => this.reloadTab(tab)));
  }

  private publishReview(): void {
    const target = project.gitDiffTarget;
    if (!target) return this.options.desktop.updateGitReviewState(null);
    const name = target.filePath.split(/[\\/]/).at(-1) ?? target.filePath;
    const side = target.staged ? 'Index' : 'Working Tree';
    const state: GitReviewState = {
      name: `${name} (${side})`,
      path: target.filePath,
      dirty: false,
      isUntitled: false,
      staged: target.staged,
      active: project.gitDiffActive,
      mode: project.gitDiffMode,
      line: project.gitDiffMode === 'rendered'
        ? this.readingStates.get(project.activeGitDiffId ?? '')?.viewer?.anchor.sourceLine
          ?? project.gitDiffLine
        : project.gitDiffLine,
    };
    this.options.desktop.updateGitReviewState(state);
  }

  private effectiveDiff(diff: GitDiff): GitDiff {
    if (diff.staged || diff.originalText === null || diff.modifiedText === null) return diff;
    const modifiedText = this.options.workingTreeBuffer(diff.filePath) ?? diff.modifiedText;
    return {
      ...diff,
      modifiedText,
      modifiedLabel: 'WORKTREE',
      hunks: textDiffHunks(diff.originalText, modifiedText),
    };
  }

  private diffSignature(diff: GitDiff | null): string {
    if (!diff) return '';
    return [
      diff.filePath,
      String(diff.staged),
      diff.originalLabel,
      diff.modifiedLabel,
      diff.originalText ?? '\u0000',
      diff.modifiedText ?? '\u0000',
    ].join('\u0001');
  }

  private firstChangedLine(diff: GitDiff): number {
    const first = diff.hunks[0];
    if (!first) return 1;
    return Math.max(1, first.newStart || first.oldStart || 1);
  }

  private serializableDiff(diff: GitDiff): GitDiff {
    return { ...diff, hunks: diff.hunks.map((hunk) => ({ ...hunk })) };
  }

  private renderable(diff: GitDiff): boolean {
    return diff.originalText !== null && diff.modifiedText !== null
      && /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(diff.filePath);
  }

  private async freezePreview(): Promise<void> {
    this.overlayDepth += 1;
    if (this.overlayDepth > 1) return;
    const token = ++this.overlayToken;
    const previewId = this.activeTab()?.previewId;
    if (!project.gitDiffActive || project.gitDiffMode !== 'rendered' || !previewId) return;
    const image = await this.options.desktop.capturePreview(previewId).catch(() => null);
    if (token !== this.overlayToken || this.overlayDepth === 0) return;
    if (image) {
      project.gitDiffSnapshot = image;
      project.gitDiffFrozen = true;
      await new Promise<void>((resolve) => requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      }));
      if (token !== this.overlayToken || this.overlayDepth === 0) return;
    }
    this.overlayFrozen = true;
    this.options.desktop.showPreview(null, null);
  }

  private unfreezePreview(): void {
    if (this.overlayDepth === 0 || --this.overlayDepth > 0) return;
    this.overlayToken += 1;
    this.overlayFrozen = false;
    this.syncPreview();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.overlayDepth > 0) return;
      project.gitDiffFrozen = false;
      project.gitDiffSnapshot = '';
    }));
  }
}
