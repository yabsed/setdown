import type {
  DocumentSnapshot,
  GitDiff,
  GitRemoteAction,
  GitReviewState,
  GitSnapshot,
  PreviewBounds,
  PreviewMessage,
} from '../../../protocol/desktop-api';
import { textDiffHunks } from '../../../core/diff/text-diff';
import type { PreviewThemeId } from '../../../core/preview/preview-preferences';
import type { DesktopPort } from '../../ports/desktop-port';
import { project, type GitDiffTabState } from '../project-state.svelte';

type Options = {
  desktop: DesktopPort;
  preferRendered(): boolean;
  openWorkingTree(path: string): Promise<boolean>;
  workingTreeBuffer(path: string): string | null;
  workingTreeChanged(path: string, text: string): void;
  reviewChanged(open: boolean, active: boolean): void;
};

export class SourceControlController {
  private readonly previewId = `git-diff:${crypto.randomUUID()}`;
  private request = 0;
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
    if (!saved.staged && !await this.options.openWorkingTree(saved.path)) return;
    const tab: GitDiffTabState = {
      id: crypto.randomUUID(),
      filePath: saved.path,
      staged: saved.staged,
      mode: saved.mode,
      line: saved.line,
    };
    project.gitDiffTabs.push(tab);
    project.activeGitDiffId = tab.id;
    if (saved.active) await this.loadDiffTab(tab);
    else this.options.reviewChanged(true, false);
  };

  refresh = async (): Promise<void> => {
    if (!project.folder || project.gitLoading || project.gitBusy) return;
    project.gitLoading = true;
    await this.perform(() => this.options.desktop.getGitStatus(), false);
    project.gitLoading = false;
  };

  documentSaved = async (document: DocumentSnapshot): Promise<void> => {
    const target = project.gitDiffTarget;
    if (!target || target.staged || target.filePath !== document.path) return;
    const request = ++this.request;
    try {
      const diff = await this.options.desktop.getGitDiff(target.filePath, false);
      if (request !== this.request || project.gitDiffTarget?.filePath !== document.path
        || project.gitDiffTarget.staged) return;
      const effective = this.effectiveDiff(diff);
      project.gitDiff = effective;
      project.gitDiffPreviewReady = false;
      project.error = '';
      this.publishReview();
      project.git = await this.options.desktop.getGitStatus();
      if (request !== this.request) return;
      if (this.renderable(effective)) await this.preparePreview(request, effective);
      else if (project.gitDiffMode === 'rendered') project.gitDiffMode = 'source';
      this.publishReview();
    } catch (error) {
      if (request === this.request) {
        project.error = error instanceof Error ? error.message : String(error);
      }
    }
  };

  review = async (filePath: string, staged: boolean): Promise<void> => {
    if (!staged) {
      this.deactivateDiff();
      if (!await this.options.openWorkingTree(filePath)) return;
    }
    let tab = project.gitDiffTabs.find((candidate) =>
      candidate.filePath === filePath && candidate.staged === staged);
    if (!tab) {
      tab = {
        id: crypto.randomUUID(),
        filePath,
        staged,
        mode: this.options.preferRendered() ? 'rendered' : 'source',
        line: 0,
      };
      project.gitDiffTabs.push(tab);
    }
    await this.loadDiffTab(tab);
  };

  closeDiff = (id = project.activeGitDiffId): void => {
    if (!id) return;
    const index = project.gitDiffTabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    project.gitDiffTabs.splice(index, 1);
    if (id !== project.activeGitDiffId) {
      this.options.reviewChanged(project.gitDiffTabs.length > 0, project.gitDiffActive);
      return;
    }
    this.request += 1;
    this.options.desktop.showPreview(null, null);
    this.options.desktop.destroyPreview(this.previewId);
    this.overlayFrozen = false;
    const replacement = project.gitDiffTabs[Math.min(index, project.gitDiffTabs.length - 1)];
    project.activeGitDiffId = null;
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
    if (!tab.staged) {
      this.deactivateDiff();
      if (!await this.options.openWorkingTree(tab.filePath)) return;
      await this.loadDiffTab(tab);
      return;
    }
    if (project.activeGitDiffId !== id || (!project.gitDiff && !project.gitDiffLoading)) {
      await this.loadDiffTab(tab);
      return;
    }
    project.gitDiffActive = true;
    this.options.reviewChanged(true, true);
    this.syncPreview();
    this.publishReview();
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
    this.bounds = bounds;
    // An unmounting diff host reports its final null layout after the document
    // preview has already been restored. It must not hide that document again.
    if (project.gitDiffActive) this.syncPreview();
  };

  toggleDiffMode = (): void => {
    if (!project.gitDiff) return;
    if (project.gitDiffMode === 'rendered') this.showSource(project.gitDiffLine);
    else this.showRendered();
  };

  showRendered = (): void => {
    const current = project.gitDiff;
    const diff = current ? this.effectiveDiff(current) : null;
    if (!diff || !this.renderable(diff)) return;
    project.gitDiff = diff;
    project.gitDiffMode = 'rendered';
    this.rememberActiveTab();
    if (!project.gitDiffPreviewReady) void this.preparePreview(this.request, diff);
    else if (project.gitDiffActive) this.syncPreview();
    this.publishReview();
  };

  previewMessage = (payload: PreviewMessage): boolean => {
    if (payload.tabId !== this.previewId || payload.message.type !== 'edit-at-anchor') return false;
    const anchor = payload.message.anchor as { sourceLine?: unknown } | undefined;
    this.showSource(Math.max(1, Number(anchor?.sourceLine) || 1));
    return true;
  };

  applyTheme = async (themeId: PreviewThemeId): Promise<void> => {
    this.themeId = themeId;
    if (!project.gitDiffPreviewReady) return;
    const assets = await this.options.desktop.getPreviewThemeAssets(themeId);
    if (project.gitDiffPreviewReady && this.themeId === themeId) {
      this.options.desktop.sendPreviewCommand(this.previewId, {
        command: 'marktex:apply-theme', ...assets,
      });
    }
  };

  initialize = (): Promise<void> => this.mutate(() => this.options.desktop.initializeGit());
  stage = (paths: string[]): Promise<void> => this.mutate(() => this.options.desktop.stageGit(paths));
  unstage = (paths: string[]): Promise<void> => this.mutate(() => this.options.desktop.unstageGit(paths));
  discard = (paths: string[]): Promise<void> => this.mutate(() => this.options.desktop.discardGit(paths));
  remote = (action: GitRemoteAction): Promise<void> =>
    this.mutate(() => this.options.desktop.runGitRemote(action));

  commit = async (message: string): Promise<void> => {
    await this.mutate(() => this.options.desktop.commitGit(message));
    if (!project.error) project.commitMessage = '';
  };

  changeWorkingTree = (text: string): void => {
    const diff = project.gitDiff;
    if (!diff || diff.staged || diff.modifiedText === null) return;
    this.options.workingTreeChanged(diff.filePath, text);
    project.gitDiffPreviewReady = false;
  };

  clear = (): void => {
    project.git = null;
    project.gitDiffTabs.splice(0);
    project.activeGitDiffId = null;
    this.closeActiveDiffState();
    this.options.desktop.updateGitReviewState(null);
    this.options.reviewChanged(false, false);
    project.commitMessage = '';
  };

  private showSource(line: number): void {
    if (project.gitDiff) project.gitDiff = this.effectiveDiff(project.gitDiff);
    project.gitDiffLine = line;
    project.gitDiffMode = 'source';
    this.rememberActiveTab();
    if (project.gitDiffActive) this.options.desktop.showPreview(null, null);
    this.publishReview();
  }

  private async loadDiffTab(tab: GitDiffTabState): Promise<void> {
    this.rememberActiveTab();
    const request = ++this.request;
    this.options.desktop.showPreview(null, null);
    this.options.desktop.destroyPreview(this.previewId);
    project.activeGitDiffId = tab.id;
    Object.assign(project, {
      gitDiff: null,
      gitDiffTarget: { filePath: tab.filePath, staged: tab.staged },
      gitDiffActive: true,
      gitDiffLoading: true,
      gitDiffMode: tab.mode,
      gitDiffPreviewLoading: false,
      gitDiffPreviewReady: false,
      gitDiffFrozen: false,
      gitDiffSnapshot: '',
      gitDiffLine: tab.line || 1,
    });
    this.options.reviewChanged(true, true);
    project.error = '';
    this.publishReview();
    try {
      const diff = await this.options.desktop.getGitDiff(tab.filePath, tab.staged);
      if (request !== this.request || project.activeGitDiffId !== tab.id) return;
      const effective = this.effectiveDiff(diff);
      const renderable = this.renderable(effective);
      project.gitDiff = effective;
      project.gitDiffLine = tab.line || effective.hunks[0]?.newStart || 1;
      project.gitDiffMode = renderable ? tab.mode : 'source';
      this.rememberActiveTab();
      this.publishReview();
      if (renderable) await this.preparePreview(request, effective);
    } catch (error) {
      if (request === this.request) {
        project.error = error instanceof Error ? error.message : String(error);
        this.closeDiff(tab.id);
      }
    } finally {
      if (request === this.request) project.gitDiffLoading = false;
    }
  }

  private rememberActiveTab(): void {
    const tab = project.gitDiffTabs.find((candidate) =>
      candidate.id === project.activeGitDiffId);
    if (!tab) return;
    tab.mode = project.gitDiffMode;
    tab.line = project.gitDiffLine;
  }

  private closeActiveDiffState(): void {
    this.request += 1;
    this.options.desktop.showPreview(null, null);
    this.options.desktop.destroyPreview(this.previewId);
    this.overlayFrozen = false;
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

  private syncPreview(): void {
    if (!project.gitDiffActive || this.overlayFrozen) return;
    this.options.desktop.showPreview(
      project.gitDiffMode === 'rendered' && project.gitDiffPreviewReady
        ? this.previewId : null,
      project.gitDiffMode === 'rendered' && project.gitDiffPreviewReady
        ? this.bounds : null,
    );
  }

  private async preparePreview(request: number, diff: NonNullable<typeof project.gitDiff>) {
    project.gitDiffPreviewLoading = true;
    const theme = await this.options.desktop.getTheme();
    this.themeId ??= theme.id;
    const effective = this.effectiveDiff(diff);
    const rendered = await this.options.desktop.prepareGitDiffPreview(
      this.previewId,
      effective,
      theme.id,
    );
    if (request !== this.request) return;
    project.gitDiffPreviewLoading = false;
    project.gitDiffPreviewReady = rendered.supported;
    if (!rendered.supported && project.gitDiffMode === 'rendered') project.gitDiffMode = 'source';
    this.publishReview();
    this.syncPreview();
    if (rendered.supported && this.themeId !== theme.id) void this.applyTheme(this.themeId);
  }

  private async mutate(action: () => Promise<GitSnapshot>): Promise<void> {
    if (project.gitBusy) return;
    project.gitBusy = true;
    await this.perform(action);
    if (!project.error) await this.refreshOpenDiff();
    project.gitBusy = false;
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

  private async refreshOpenDiff(): Promise<void> {
    const target = project.gitDiffTarget;
    if (!target) return;
    try {
      const stored = await this.options.desktop.getGitDiff(target.filePath, target.staged);
      const diff = this.effectiveDiff(stored);
      project.gitDiff = diff;
      this.publishReview();
      project.gitDiffPreviewReady = false;
      const renderable = this.renderable(diff);
      if (renderable) await this.preparePreview(this.request, diff);
      else if (project.gitDiffMode === 'rendered') project.gitDiffMode = 'source';
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
    }
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

  private renderable(diff: NonNullable<typeof project.gitDiff>): boolean {
    return diff.originalText !== null && diff.modifiedText !== null
      && /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(diff.filePath);
  }

  private async freezePreview(): Promise<void> {
    this.overlayDepth += 1;
    if (this.overlayDepth > 1) return;
    const token = ++this.overlayToken;
    if (!project.gitDiffActive || project.gitDiffMode !== 'rendered'
      || !project.gitDiffPreviewReady) return;
    const image = await this.options.desktop.capturePreview(this.previewId).catch(() => null);
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
