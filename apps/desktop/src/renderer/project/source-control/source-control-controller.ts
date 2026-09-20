import { textDiffHunks } from '../../../core/diff/text-diff';
import { isMarkdownDocument } from '../../../core/document/document-profile';
import type { PreviewThemeId } from '../../../core/preview/preview-preferences';
import { PreviewCheckpoints } from '../../../core/preview/preview-checkpoints';
import { sameReviewContent } from '../../../core/preview/review-render-request';
import { readReviewBookmark, reviewViewport, reviewPositionCommand, type ReviewViewport }
  from '../../../core/preview/review-viewport';
import { gitDiffViewport, type GitDiffViewportPort } from './git-diff-viewport';
import { liveDocumentModels, type LiveDocumentModelPort } from '../../editor/live-document-model';
import type {
  DocumentSnapshot, GitDiff, GitRemoteAction, GitReviewState, GitSnapshot,
  PreviewBounds, PreviewMessage,
} from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import type { WorkingTreeEdit } from '../../view-state.svelte';
import { project, type GitDiffTabState } from '../project-state.svelte';
import { ReviewPresentation } from './review-presentation';
import { ReviewTransition } from './review-transition';

type Options = {
  desktop: DesktopPort;
  viewport?: GitDiffViewportPort;
  models?: LiveDocumentModelPort;
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
  presentedRevision: number | null;
  presentedBounds: PreviewBounds | null;
  observationId: number | null;
  observedId: string | null;
  sequence: number;
};

export class SourceControlController {
  private readonly loadGenerations = new Map<string, number>();
  private readonly checkpoints = new PreviewCheckpoints((id) => {
    const tab = project.gitDiffTabs.find((candidate) => candidate.id === id);
    if (tab) void this.preparePreview(tab);
  }, 32, 120);
  private readonly preparedPreviews = new Map<string, { diff: GitDiff; revision: number; themeId: PreviewThemeId }>();
  private readonly presentation: ReviewPresentation;
  private readonly transition: ReviewTransition;
  private primeFrame: number | null = null;
  private refreshRequested = false;
  private refreshTask: Promise<void> | null = null;
  private statusGeneration = 0;
  private bounds: PreviewBounds | null = null;
  private pendingPreviewPosition: { tabId: string; intent: 'source' | 'resume' } | null = null;
  private readonly readingStates = new Map<string, ReviewReadingState>();
  private observationSequence = 0;
  private unsubscribeModels: (() => void) | null = null;
  private get viewport(): GitDiffViewportPort { return this.options.viewport ?? gitDiffViewport; }
  private themeId: PreviewThemeId | null = null;
  private overlayDepth = 0;
  private overlayToken = 0;
  private overlayFrozen = false;

  constructor(private readonly options: Options) {
    this.presentation = new ReviewPresentation(options.desktop);
    this.transition = new ReviewTransition(({ pending, notice, error }) => {
      Object.assign(project, { gitDiffTransitionPending: pending,
        gitDiffTransitionNotice: notice, gitDiffTransitionError: error });
    });
    window.addEventListener('setdown:native-overlay-visibility', ((event: CustomEvent<boolean>) => {
      if (event.detail) void this.freezePreview();
      else this.unfreezePreview();
    }) as EventListener);
    this.viewport.onChange?.(() => this.schedulePrime());
    this.viewport.onInteraction?.(() => {
      if (project.gitDiffActive && project.gitDiffMode === 'source') this.cancelViewerRequest();
    });
  }

  restore = async (): Promise<void> => {
    this.observeDocuments();
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
    } finally { project.gitLoading = false; }
  }

  documentSaved = async (document: DocumentSnapshot): Promise<void> => {
    const tabs = project.gitDiffTabs.filter((tab) => !tab.staged && tab.filePath === document.path);
    await Promise.all(tabs.map((tab) => this.reloadTab(tab)));
    await this.refresh();
  };

  review = async (filePath: string, staged: boolean): Promise<void> => {
    this.observeDocuments();
    if (!staged && !this.options.activateWorkingTree(filePath)
      && !await this.options.openWorkingTree(filePath)) return;
    let tab = project.gitDiffTabs.find((candidate) => candidate.filePath === filePath && candidate.staged === staged);
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
    const ids = project.gitDiffTabs.filter((tab) => !tab.staged && tab.filePath === filePath).map((tab) => tab.id);
    for (const id of ids) this.closeDiff(id);
  };

  activateDiff = async (id = project.activeGitDiffId): Promise<void> => {
    this.observeDocuments();
    const tab = project.gitDiffTabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    if (!tab.staged && !this.options.activateWorkingTree(tab.filePath)
      && !await this.options.openWorkingTree(tab.filePath)) return;
    this.activateTabState(tab);
    if (!tab.diff && !tab.loading) void this.reloadTab(tab);
  };

  deactivateDiff = (): void => {
    this.cancelViewerRequest();
    this.presentation.cancel();
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
    // Both surfaces share a live box; hiding the entire review invalidates it.
    this.bounds = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      && bounds.width > 0 && bounds.height > 0 ? bounds : null;
    if (project.gitDiffActive) {
      this.syncPreview();
      this.schedulePrime();
    }
  };

  updateSourceLine = (line: number): void => {
    const tab = this.activeTab();
    if (!tab || !project.gitDiffActive || project.gitDiffMode !== 'source') return;
    tab.line = Math.max(1, Math.round(line) || 1);
    this.schedulePrime();
  };

  toggleDiffMode = (): void => {
    if (!project.gitDiff || !this.renderable(project.gitDiff)) return;
    if (this.cancelViewerRequest()) return;
    if (project.gitDiffMode === 'rendered') {
      const tab = this.activeTab();
      if (tab) this.showSource(this.readingState(tab).viewer ?? this.readingState(tab).source);
    } else this.showRendered();
  };

  showRendered = (): void => {
    const tab = this.activeTab();
    if (!project.gitDiffActive || !tab?.diff || project.gitDiffMode === 'rendered'
      || this.transition.forTab(tab.id)) return;
    const diff = this.latestDiff(tab)!;
    if (!this.renderable(diff)) return;
    if (!sameReviewContent(tab.diff, diff)) { tab.diff = diff; this.invalidatePreview(tab); }
    const reading = this.readingState(tab);
    const source = this.viewport.read(tab.id) ?? reading.source;
    reading.source = { ...source, anchor: { ...source.anchor }, band: source.band.map((sample) => ({ ...sample })) };
    reading.viewer = null;
    reading.observationId = null;
    reading.observedId = null;
    // Request the destination without hiding or disabling the live editor.
    this.transition.begin(tab.id);
    project.gitDiff = diff;
    this.copyPreviewState(tab);
    this.syncPreview('source');
    if (!tab.previewLoading && !this.latestPreview(tab)) this.schedulePreview(tab, 0);
    this.publishReview();
  };

  previewMessage = (payload: PreviewMessage): boolean => {
    const tab = project.gitDiffTabs.find((candidate) => this.previewIds(candidate).includes(payload.tabId));
    if (!tab) return false;
    const message = payload.message;
    if (this.presentation.receive(payload.tabId, message)) return true;
    const reading = this.readingState(tab);
    // An out-of-process ACK is not proof that a page is STILL at that point.
    // Exact no-op eligibility is validated atomically by the page's SourceAtlas.
    if (message.type === 'marktex:viewport-state') {
      if (tab.mode !== 'rendered' || message.observationId !== reading.observationId
        || reading.observationId === null || payload.tabId !== reading.observedId
        || typeof message.sequence !== 'number' || !Number.isFinite(message.sequence)
        || message.sequence <= reading.sequence) return true;
      const bookmark = readReviewBookmark(message.anchor);
      if (bookmark) {
        reading.viewer = bookmark;
        reading.sequence = message.sequence;
        if (tab.pendingPreviewId) this.primePreview(tab, tab.pendingPreviewId, bookmark);
        if (this.presentation.waiting) this.syncPreview();
      }
      return true;
    }
    if (message.type === 'edit-at-anchor') {
      if (!project.gitDiffActive || project.activeGitDiffId !== tab.id
        || project.gitDiffMode !== 'rendered' || payload.tabId !== tab.previewId) return true;
      const bookmark = readReviewBookmark(message.anchor);
      if (bookmark) this.showSource(bookmark);
    }
    return true;
  };

  applyTheme = async (themeId: PreviewThemeId): Promise<void> => {
    this.cancelViewerRequest();
    this.presentation.cancel();
    this.themeId = themeId;
    const previews = project.gitDiffTabs.filter((tab) => isMarkdownDocument(tab.filePath))
      .flatMap((tab) => this.previewIds(tab));
    if (!previews.length) return;
    const assets = await this.options.desktop.getPreviewThemeAssets(themeId);
    if (this.themeId !== themeId) return;
    for (const previewId of previews) {
      this.options.desktop.sendPreviewCommand(previewId, { command: 'marktex:apply-theme', ...assets });
      const prepared = this.preparedPreviews.get(previewId);
      if (prepared) this.preparedPreviews.set(previewId, { ...prepared, themeId });
    }
    this.syncPreview('resume');
    this.schedulePrime();
  };

  initialize = (): Promise<void> => this.mutate(() => this.options.desktop.initializeGit());
  stage = (paths: string[]): Promise<void> => this.mutate(() => this.options.desktop.stageGit(paths));
  unstage = (paths: string[]): Promise<void> => this.mutate(() => this.options.desktop.unstageGit(paths));
  discard = (paths: string[], reloadDocuments: () => Promise<void>): Promise<void> =>
    this.mutate(() => this.options.desktop.discardGit(paths), reloadDocuments);
  remote = (action: GitRemoteAction): Promise<void> => this.mutate(() => this.options.desktop.runGitRemote(action));
  commit = async (message: string): Promise<void> => {
    await this.mutate(() => this.options.desktop.commitGit(message));
    if (!project.error) project.commitMessage = '';
  };

  changeWorkingTree = (text: string, edits?: WorkingTreeEdit[]): void => {
    const tab = this.activeTab();
    const diff = tab?.diff;
    if (!tab || !diff || diff.staged || diff.originalText === null || diff.modifiedText === null) return;
    this.options.workingTreeChanged(diff.filePath, text, edits);
    if (tab.diff?.modifiedText === text) return; // Document event already handled it.
    tab.diff = { ...diff, modifiedText: text, modifiedLabel: 'WORKTREE' };
    // Source-only formats never enter the preview scheduler, even temporarily.
    if (this.renderable(tab.diff)) {
      this.invalidatePreview(tab);
      this.schedulePreview(tab);
    }
  };

  clear = (): void => {
    this.transition.cancel();
    this.presentation.cancel();
    this.unsubscribeModels?.();
    this.unsubscribeModels = null;
    this.statusGeneration += 1;
    this.refreshRequested = false;
    this.checkpoints.clear();
    if (this.primeFrame !== null) cancelAnimationFrame(this.primeFrame);
    this.primeFrame = null;
    for (const tab of [...project.gitDiffTabs]) this.disposeTab(tab);
    project.git = null;
    project.gitDiffTabs.splice(0);
    project.activeGitDiffId = null;
    this.options.desktop.showPreview(null, null);
    this.overlayFrozen = false;
    this.resetActiveState();
    this.options.reviewChanged(false, false);
    project.commitMessage = '';
  };

  private observeDocuments(): void {
    if (this.unsubscribeModels) return;
    this.unsubscribeModels = (this.options.models ?? liveDocumentModels).subscribe((event) => {
      if (event.type !== 'changed') {
        // A moved/closed document must not stay editable under an obsolete Git path.
        this.closeWorkingTreeReviews(event.path);
        return;
      }
      for (const tab of project.gitDiffTabs) {
        const diff = tab.diff;
        if (tab.staged || tab.filePath !== event.path || !diff
          || diff.originalText === null || diff.modifiedText === null || diff.modifiedText === event.text) continue;
        tab.diff = { ...diff, modifiedText: event.text, modifiedLabel: 'WORKTREE' };
        if (this.renderable(tab.diff)) {
          this.invalidatePreview(tab);
          this.schedulePreview(tab);
        }
      }
    });
  }

  private createTab(filePath: string, staged: boolean,
    mode: GitDiffTabState['mode'] = 'source', line = 0): GitDiffTabState {
    const markdown = isMarkdownDocument(filePath);
    return { id: crypto.randomUUID(), filePath, staged, mode: markdown ? mode : 'source', line, diff: null, loading: false,
      previewId: null, pendingPreviewId: null, previewLoading: false, previewDirty: markdown };
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
        this.schedulePreview(tab);
      }
    }
    if (tab.diff && !this.renderable(tab.diff)) tab.mode = 'source';
    project.activeGitDiffId = tab.id;
    Object.assign(project, { gitDiff: tab.diff, gitDiffTarget: { filePath: tab.filePath, staged: tab.staged },
      gitDiffActive: true, gitDiffLoading: tab.loading, gitDiffMode: tab.mode,
      gitDiffFrozen: false, gitDiffSnapshot: '',
      gitDiffLine: tab.line || (tab.diff ? this.firstChangedLine(tab.diff) : 1) });
    this.copyPreviewState(tab);
    this.options.reviewChanged(true, true);
    project.error = '';
    this.syncPreview('resume');
    this.schedulePrime();
    if (tab.diff && this.renderable(tab.diff) && !tab.previewLoading
      && (tab.previewDirty || !tab.previewId)) this.schedulePreview(tab, 0);
    this.publishReview();
  }

  private showSource(target: ReviewViewport): void {
    this.cancelViewerRequest();
    this.presentation.cancel();
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
    this.pendingPreviewPosition = null;
    if (project.gitDiffActive) this.options.desktop.showPreview(null, null);
    this.schedulePrime();
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
        Object.assign(project, { gitDiff: diff, gitDiffMode: tab.mode, gitDiffLine: tab.line });
        this.copyPreviewState(tab);
        this.publishReview();
      }
      if (this.renderable(diff) && (tab.previewDirty || !tab.previewId)) this.schedulePreview(tab, 0);
    } catch (error) {
      if (this.isCurrentLoad(tab, generation)) project.error = error instanceof Error ? error.message : String(error);
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
    this.cancelViewerRequest();
    this.presentation.cancel();
    const tab = this.activeTab();
    if (!tab || !project.gitDiffActive) return;
    tab.mode = project.gitDiffMode;
    if (tab.mode === 'rendered') this.pauseObservation(tab);
  }

  private resetActiveState(): void {
    this.bounds = null;
    this.pendingPreviewPosition = null;
    Object.assign(project, { gitDiff: null, gitDiffTarget: null, gitDiffActive: false,
      gitDiffLoading: false, gitDiffPreviewLoading: false, gitDiffPreviewReady: false,
      gitDiffFrozen: false, gitDiffSnapshot: '', gitDiffLine: 1,
      gitDiffTransitionPending: false, gitDiffTransitionNotice: false, gitDiffTransitionError: '' });
  }

  private copyPreviewState(tab: GitDiffTabState): void {
    project.gitDiffPreviewLoading = tab.previewLoading || this.presentation.waiting;
    project.gitDiffPreviewReady = this.latestPreview(tab) && !this.presentation.waiting;
  }

  private readingState(tab: GitDiffTabState): ReviewReadingState {
    let state = this.readingStates.get(tab.id);
    if (!state) {
      state = { source: reviewViewport(tab.line), viewer: null, presentedId: null, presentedRevision: null,
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
  }

  private cancelViewerRequest(): boolean {
    const tab = this.activeTab();
    if (!tab || !this.transition.forTab(tab.id)) return false;
    this.presentation.cancel();
    this.transition.cancel();
    this.pendingPreviewPosition = null;
    this.copyPreviewState(tab);
    return true;
  }

  private wantsViewer(tab: GitDiffTabState): boolean {
    return project.gitDiffMode === 'rendered' || this.transition.forTab(tab.id);
  }

  private presentationFailed(tab: GitDiffTabState, error: string): void {
    if (this.activeTab()?.id !== tab.id || !project.gitDiffActive) return;
    project.error = error;
    if (this.transition.forTab(tab.id)) {
      this.cancelViewerRequest(); // Leave cursor, selection, focus and scroll alone.
      this.transition.fail(error);
    } else if (tab.mode === 'rendered') this.showSource(this.readingState(tab).source);
    this.copyPreviewState(tab);
  }

  private commitPresentation(tab: GitDiffTabState, id: string, revision: number, bounds: PreviewBounds): void {
    // Request the native surface first. The Svelte layer also retains Source as
    // an inert backing surface while the native show crosses the IPC boundary.
    this.options.desktop.showPreview(id, bounds);
    tab.mode = 'rendered';
    project.gitDiffMode = 'rendered';
    this.pendingPreviewPosition = null;
    this.transition.complete();
    this.didPresent(tab, id, revision, bounds);
    this.copyPreviewState(tab);
    this.publishReview();
  }

  private syncPreview(intent?: 'source' | 'resume'): void {
    const tab = this.activeTab();
    if (intent) {
      if (!project.gitDiffActive || !tab || !this.wantsViewer(tab)) this.pendingPreviewPosition = null;
      else if (intent === 'source' || this.pendingPreviewPosition?.tabId !== tab.id) {
        this.pendingPreviewPosition = { tabId: tab.id, intent };
      }
    }
    if (!project.gitDiffActive || this.overlayFrozen || this.overlayDepth > 0) return;
    const shownId = tab && this.wantsViewer(tab) && this.latestPreview(tab) ? tab.previewId : null;
    if (!tab || !shownId || !this.bounds) {
      this.presentation.cancel();
      this.options.desktop.showPreview(null, null);
      return;
    }
    const ready = this.preparedPreviews.get(shownId)!;
    const reading = this.readingState(tab);
    const pending = this.pendingPreviewPosition?.tabId === tab.id ? this.pendingPreviewPosition : null;
    const target = pending?.intent === 'source' ? reading.source : reading.viewer ?? reading.source;
    const samePage = reading.presentedId === shownId && reading.presentedRevision === ready.revision;
    const sameSize = reading.presentedBounds?.width === this.bounds.width
      && reading.presentedBounds?.height === this.bounds.height;
    if (!samePage) {
      const bounds = { ...this.bounds };
      const themeId = this.themeId;
      const generation = this.transition.generation;
      const position = reviewPositionCommand(target);
      this.presentation.present({ id: shownId, revision: ready.revision, bounds, position },
        () => project.gitDiffActive && project.activeGitDiffId === tab.id && this.wantsViewer(tab)
          && this.transition.generation === generation && !this.overlayFrozen && this.overlayDepth === 0
          && this.themeId === themeId && tab.previewId === shownId && this.latestPreview(tab)
          && this.preparedPreviews.get(shownId) === ready && JSON.stringify(this.bounds) === JSON.stringify(bounds),
        () => {
          try { this.commitPresentation(tab, shownId, ready.revision, bounds); }
          catch (error) { this.presentationFailed(tab, error instanceof Error ? error.message : String(error)); }
        },
        (error) => this.presentationFailed(tab, error));
      this.copyPreviewState(tab);
      return;
    }
    // Preserve the no-edit warm route: the page validates its local position
    // proof, without another preparation ACK or timer on Escape.
    this.presentation.cancel();
    try {
      if (!pending) {
        this.options.desktop.showPreview(shownId, this.bounds);
        reading.presentedBounds = { ...this.bounds };
        return;
      }
      this.commitPresentation(tab, shownId, ready.revision, this.bounds);
      if (pending.intent === 'source' || !sameSize) {
        this.options.desktop.sendPreviewCommand(shownId, reviewPositionCommand(target));
      }
    } catch (error) { this.presentationFailed(tab, error instanceof Error ? error.message : String(error)); }
  }

  private didPresent(tab: GitDiffTabState, id: string, revision: number, bounds: PreviewBounds): void {
    this.pauseObservation(tab);
    const reading = this.readingState(tab);
    reading.presentedId = id;
    reading.presentedRevision = revision;
    reading.presentedBounds = { ...bounds };
    reading.observedId = id;
    reading.observationId = ++this.observationSequence;
    reading.sequence = 0;
    this.options.desktop.sendPreviewCommand(id, {
      command: 'marktex:observe-viewport', observationId: reading.observationId,
    });
  }

  private latestDiff(tab: GitDiffTabState): GitDiff | null {
    const diff = tab.diff;
    if (!diff || tab.staged) return diff;
    const modifiedText = this.options.workingTreeBuffer(tab.filePath) ?? diff.modifiedText;
    return modifiedText === diff.modifiedText ? diff : { ...diff, modifiedText, modifiedLabel: 'WORKTREE' };
  }

  private latestPreview(tab: GitDiffTabState): boolean {
    const ready = tab.previewId ? this.preparedPreviews.get(tab.previewId) : undefined;
    const current = this.latestDiff(tab);
    // previewDirty becomes false when work STARTS. It is not a freshness proof.
    return !!ready && !!current && ready.themeId === this.themeId && sameReviewContent(ready.diff, current);
  }

  private schedulePrime(): void {
    const active = this.activeTab();
    if (!active?.diff || !this.renderable(active.diff)) return;
    if (!project.gitDiffActive || project.gitDiffMode !== 'source' || this.transition.forTab(active.id) || this.primeFrame !== null
      || typeof requestAnimationFrame !== 'function') return;
    this.primeFrame = requestAnimationFrame(() => {
      this.primeFrame = null;
      const tab = this.activeTab();
      if (!tab?.diff || !this.renderable(tab.diff)
        || !project.gitDiffActive || project.gitDiffMode !== 'source' || this.transition.forTab(tab.id) || !this.bounds) return;
      const reading = this.readingState(tab);
      reading.source = this.viewport.read(tab.id) ?? reading.source;
      for (const id of new Set([tab.previewId, tab.pendingPreviewId])) {
        if (id) this.primePreview(tab, id, reading.source);
      }
    });
  }

  private primePreview(tab: GitDiffTabState, previewId: string, target?: ReviewViewport): void {
    if (!tab.diff || !this.renderable(tab.diff)) return;
    if (!this.bounds || !project.gitDiffActive || this.activeTab()?.id !== tab.id) return;
    const reading = this.readingState(tab);
    const viewport = target ?? (this.transition.forTab(tab.id) ? reading.source : tab.mode === 'source'
      ? this.viewport.read(tab.id) ?? reading.source : reading.viewer ?? reading.source);
    this.options.desktop.sendPreviewCommand(previewId, {
      command: 'marktex:prime-review', bounds: { ...this.bounds },
      position: reviewPositionCommand(viewport),
    });
  }

  private invalidatePreview(tab: GitDiffTabState): void {
    if (this.activeTab()?.id === tab.id) { this.cancelViewerRequest(); this.presentation.cancel(); }
    tab.previewDirty = !!tab.diff && this.renderable(tab.diff);
    // An edit must not reset the maximum-wait checkpoint for Markdown.
  }

  private schedulePreview(tab: GitDiffTabState, delay?: number): void {
    if (!tab.diff || !this.renderable(tab.diff)) return;
    if (delay === 0) {
      this.checkpoints.cancel(tab.id);
      void this.preparePreview(tab);
    } else this.checkpoints.schedule(tab.id);
  }

  private previewIds(tab: GitDiffTabState): [string, string] {
    return [`git-diff:${tab.id}:a`, `git-diff:${tab.id}:b`];
  }

  private tabExists(tab: GitDiffTabState): boolean {
    return project.gitDiffTabs.some((candidate) => candidate.id === tab.id);
  }

  private async preparePreview(tab: GitDiffTabState): Promise<void> {
    if (!this.tabExists(tab) || tab.previewLoading || (!tab.previewDirty && this.latestPreview(tab))) return;
    const current = tab.diff;
    if (!current || !this.renderable(current)) return;
    const text = tab.staged ? current.modifiedText
      : this.options.workingTreeBuffer(tab.filePath) ?? current.modifiedText;
    const diff: GitDiff = { ...current, modifiedText: text, patch: '', hunks: [] };
    if (text !== current.modifiedText) tab.diff = { ...current, modifiedText: text };
    const [a, b] = this.previewIds(tab);
    const candidateId = tab.previewId === a ? b : a;
    tab.pendingPreviewId = candidateId;
    tab.previewLoading = true;
    tab.previewDirty = false;
    if (this.activeTab()?.id === tab.id) this.copyPreviewState(tab);
    let requestedTheme = this.themeId;
    try {
      if (!this.themeId) this.themeId = (await this.options.desktop.getTheme()).id;
      if (!this.tabExists(tab)) return;
      requestedTheme = this.themeId;
      this.primePreview(tab, candidateId);
      const rendered = await this.options.desktop.prepareGitDiffPreview(candidateId, diff, requestedTheme);
      if (!this.tabExists(tab)) return;
      tab.pendingPreviewId = null;
      tab.previewLoading = false;
      const latest = this.latestDiff(tab);
      if (!latest || !sameReviewContent(latest, diff) || requestedTheme !== this.themeId
        || rendered.themeId !== requestedTheme) {
        // An obsolete failure/unsupported result cannot cancel a newer Escape.
        tab.previewDirty = true;
      } else if (!rendered.supported) {
        this.options.desktop.destroyPreview(candidateId);
        this.preparedPreviews.delete(candidateId);
        this.presentationFailed(tab, 'Rendered comparison is unavailable. Source has been kept.');
      } else {
        tab.previewDirty = false;
        this.preparedPreviews.set(candidateId, { diff, revision: rendered.revision, themeId: requestedTheme });
        tab.previewId = candidateId;
        if (this.activeTab()?.id === tab.id) {
          project.gitDiff = tab.diff;
          project.gitDiffMode = tab.mode;
          this.copyPreviewState(tab);
          this.syncPreview('resume');
          this.schedulePrime();
          this.publishReview();
        }
      }
      if (this.activeTab()?.id === tab.id) this.copyPreviewState(tab);
      if (tab.previewDirty) this.schedulePreview(tab, 0);
    } catch (error) {
      this.options.desktop.destroyPreview(candidateId);
      this.preparedPreviews.delete(candidateId);
      if (this.tabExists(tab)) {
        tab.pendingPreviewId = null;
        tab.previewLoading = false;
        tab.previewDirty = true;
        const latest = this.latestDiff(tab);
        const superseded = !!latest && (!sameReviewContent(latest, diff) || requestedTheme !== this.themeId);
        if (this.activeTab()?.id === tab.id) {
          this.copyPreviewState(tab);
          if (!superseded) this.presentationFailed(tab, error instanceof Error ? error.message : String(error));
        }
        // Never spin on the same failing input. Only a genuinely newer request
        // gets the immediate retry; current failures still require user retry.
        if (superseded) this.schedulePreview(tab, 0);
      }
    }
  }

  private disposeTab(tab: GitDiffTabState): void {
    if (this.pendingPreviewPosition?.tabId === tab.id) this.pendingPreviewPosition = null;
    if (this.activeTab()?.id === tab.id) { this.cancelViewerRequest(); this.presentation.cancel(); }
    for (const id of this.previewIds(tab)) this.preparedPreviews.delete(id);
    this.readingStates.delete(tab.id);
    this.viewport.forget(tab.id);
    this.loadGenerations.set(tab.id, (this.loadGenerations.get(tab.id) ?? 0) + 1);
    this.checkpoints.cancel(tab.id);
    if (isMarkdownDocument(tab.filePath)) {
      for (const id of this.previewIds(tab)) this.options.desktop.destroyPreview(id);
    }
    this.loadGenerations.delete(tab.id);
  }

  private async mutate(action: () => Promise<GitSnapshot>, afterAction?: () => Promise<void>): Promise<void> {
    if (project.gitBusy) return;
    this.statusGeneration += 1;
    project.gitBusy = true;
    try {
      await this.perform(action);
      if (!project.error) await afterAction?.();
      if (!project.error) await this.refreshOpenDiffs();
    } catch (error) { project.error = error instanceof Error ? error.message : String(error); }
    finally {
      project.gitBusy = false;
      if (this.refreshRequested) void this.refresh();
    }
  }

  private async perform(action: () => Promise<GitSnapshot>, clear = true): Promise<void> {
    if (clear) project.error = '';
    try { project.git = await action(); project.error = ''; }
    catch (error) { project.error = error instanceof Error ? error.message : String(error); }
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
      name: `${name} (${side})`, path: target.filePath, dirty: false, isUntitled: false,
      staged: target.staged, active: project.gitDiffActive, mode: project.gitDiffMode,
      line: project.gitDiffMode === 'rendered'
        ? this.readingStates.get(project.activeGitDiffId ?? '')?.viewer?.anchor.sourceLine ?? project.gitDiffLine
        : project.gitDiffLine,
    };
    this.options.desktop.updateGitReviewState(state);
  }

  private effectiveDiff(diff: GitDiff): GitDiff {
    if (diff.staged || diff.originalText === null || diff.modifiedText === null) return diff;
    const modifiedText = this.options.workingTreeBuffer(diff.filePath) ?? diff.modifiedText;
    return { ...diff, modifiedText, modifiedLabel: 'WORKTREE', hunks: textDiffHunks(diff.originalText, modifiedText) };
  }
  private diffSignature(diff: GitDiff | null): string {
    if (!diff) return '';
    return [diff.filePath, String(diff.staged), diff.originalLabel, diff.modifiedLabel,
      diff.originalText ?? '\u0000', diff.modifiedText ?? '\u0000'].join('\u0001');
  }
  private firstChangedLine(diff: GitDiff): number {
    const first = diff.hunks[0];
    return first ? Math.max(1, first.newStart || first.oldStart || 1) : 1;
  }
  private renderable(diff: GitDiff): boolean {
    return diff.originalText !== null && diff.modifiedText !== null && isMarkdownDocument(diff.filePath);
  }

  private async freezePreview(): Promise<void> {
    this.cancelViewerRequest();
    this.presentation.cancel();
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
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
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
