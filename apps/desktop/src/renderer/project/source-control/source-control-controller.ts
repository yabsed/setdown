import { textDiffHunks } from '../../../core/diff/text-diff';
import type { PreviewThemeId } from '../../../core/preview/preview-preferences';
import { GOLDEN_TOP_RATIO } from '../../../core/preview/viewport-anchor';
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
  preferRendered(): boolean;
  openWorkingTree(path: string): Promise<boolean>;
  activateWorkingTree(path: string): boolean;
  workingTreeBuffer(path: string): string | null;
  workingTreeChanged(path: string, text: string, edits?: WorkingTreeEdit[]): void;
  reviewChanged(open: boolean, active: boolean): void;
};

const PREVIEW_DEBOUNCE_MS = 400;

export class SourceControlController {
  private readonly loadGenerations = new Map<string, number>();
  private readonly previewTimers = new Map<string, number>();
  private bounds: PreviewBounds | null = null;
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

  refresh = async (): Promise<void> => {
    if (!project.folder || project.gitLoading || project.gitBusy) return;
    project.gitLoading = true;
    await this.perform(() => this.options.desktop.getGitStatus(), false);
    project.gitLoading = false;
  };

  documentSaved = async (document: DocumentSnapshot): Promise<void> => {
    const tabs = project.gitDiffTabs.filter((tab) =>
      !tab.staged && tab.filePath === document.path);
    if (!tabs.length) return;
    await Promise.all(tabs.map((tab) => this.reloadTab(tab)));
    await this.perform(() => this.options.desktop.getGitStatus(), false);
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
    this.options.desktop.showPreview(null, null);
    this.options.reviewChanged(project.gitDiffTabs.length > 0, false);
    this.publishReview();
  };

  layoutDiff = (bounds: PreviewBounds | null): void => {
    // Keep the last valid geometry. It lets a cached native preview become
    // visible in the same task as tab activation; ResizeObserver corrects it
    // on the next frame if the shell moved while the review was inactive.
    if (bounds) this.bounds = bounds;
    if (project.gitDiffActive) this.syncPreview();
  };

  updateSourceLine = (line: number): void => {
    const tab = this.activeTab();
    if (!tab || !project.gitDiffActive || project.gitDiffMode !== 'source') return;
    tab.line = Math.max(1, Math.round(line) || 1);
  };

  toggleDiffMode = (): void => {
    if (!project.gitDiff) return;
    if (project.gitDiffMode === 'rendered') this.showSource(project.gitDiffLine);
    else this.showRendered();
  };

  showRendered = (): void => {
    const tab = this.activeTab();
    if (!tab?.diff || project.gitDiffMode === 'rendered') return;
    const diff = this.effectiveDiff(tab.diff);
    if (!this.renderable(diff)) return;
    tab.diff = diff;
    tab.mode = 'rendered';
    project.gitDiffLine = tab.line || 1;
    project.gitDiff = diff;
    project.gitDiffMode = 'rendered';
    this.copyPreviewState(tab);
    this.syncPreview();
    this.positionPreview(tab);
    if (tab.previewDirty || !tab.previewId) this.schedulePreview(tab, 0);
    this.publishReview();
  };

  previewMessage = (payload: PreviewMessage): boolean => {
    const tab = project.gitDiffTabs.find((candidate) =>
      this.previewIds(candidate).includes(payload.tabId));
    if (!tab || payload.message.type !== 'edit-at-anchor') return false;
    if (project.activeGitDiffId !== tab.id || !project.gitDiffActive) this.activateTabState(tab);
    const anchor = payload.message.anchor as { sourceLine?: unknown } | undefined;
    this.showSource(Math.max(1, Number(anchor?.sourceLine) || 1));
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
    mode: GitDiffTabState['mode'] = this.options.preferRendered() ? 'rendered' : 'source',
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
    return project.gitDiffTabs.find((tab) => tab.id === project.activeGitDiffId) ?? null;
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
      gitDiffLine: tab.line || tab.diff?.hunks[0]?.newStart || 1,
    });
    this.copyPreviewState(tab);
    this.options.reviewChanged(true, true);
    project.error = '';
    this.syncPreview();
    this.positionPreview(tab);
    if (tab.diff && this.renderable(tab.diff) && !tab.previewLoading
      && (tab.previewDirty || !tab.previewId)) this.schedulePreview(tab, 0);
    this.publishReview();
  }

  private showSource(line: number): void {
    const tab = this.activeTab();
    if (!tab) return;
    if (tab.diff) {
      tab.diff = this.effectiveDiff(tab.diff);
      project.gitDiff = tab.diff;
    }
    tab.line = line;
    tab.mode = 'source';
    project.gitDiffLine = line;
    project.gitDiffMode = 'source';
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
      tab.line ||= diff.hunks[0]?.newStart || 1;
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
    if (!tab) return;
    tab.mode = project.gitDiffMode;
    if (project.gitDiffMode === 'rendered') tab.line = project.gitDiffLine;
  }

  private resetActiveState(): void {
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

  private syncPreview(): void {
    if (!project.gitDiffActive || this.overlayFrozen) return;
    const tab = this.activeTab();
    const previewId = project.gitDiffMode === 'rendered' ? tab?.previewId : null;
    this.options.desktop.showPreview(previewId ?? null, previewId ? this.bounds : null);
  }

  private positionPreview(tab: GitDiffTabState): void {
    if (!project.gitDiffActive || project.gitDiffMode !== 'rendered' || !tab.previewId) return;
    this.options.desktop.sendPreviewCommand(tab.previewId, {
      command: 'marktex:position-preview',
      sourceLine: tab.line || 1,
      topRatio: GOLDEN_TOP_RATIO,
      settle: false,
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
        tab.previewId = candidateId;
        if (this.activeTab()?.id === tab.id) {
          project.gitDiff = tab.diff;
          project.gitDiffMode = tab.mode;
          this.copyPreviewState(tab);
          this.syncPreview();
          this.positionPreview(tab);
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
    project.gitBusy = true;
    try {
      await this.perform(action);
      if (!project.error) await afterAction?.();
      if (!project.error) await this.refreshOpenDiffs();
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
    } finally {
      project.gitBusy = false;
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
      line: project.gitDiffLine,
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
