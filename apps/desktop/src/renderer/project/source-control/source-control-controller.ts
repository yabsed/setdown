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
import { project } from '../project-state.svelte';

type Options = {
  desktop: DesktopPort;
  preferRendered(): boolean;
  reviewChanged(open: boolean, active: boolean): void;
  workingTreeBuffer(path: string): string | null;
  workingTreeChanged(path: string, text: string): void;
  canSaveWorkingTree(path: string, expectedText: string, workingText: string): boolean;
  workingTreeSaved(path: string, previousText: string, document: DocumentSnapshot): void;
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
    if (!saved || !project.folder || project.gitDiff || project.gitDiffLoading) return;
    const request = ++this.request;
    if (saved.active) this.options.desktop.showPreview(null, null);
    this.options.reviewChanged(true, saved.active);
    Object.assign(project, {
      gitDiff: null,
      gitDiffTarget: { filePath: saved.path, staged: saved.staged },
      gitDiffActive: saved.active,
      gitDiffLoading: true,
      gitDiffPreviewLoading: false,
      gitDiffPreviewReady: false,
      gitDiffFrozen: false,
      gitDiffSnapshot: '',
      gitDiffLine: saved.line,
      gitDiffWorkingText: '',
      gitDiffExpectedText: saved.expectedText,
      gitDiffDirty: false,
      gitDiffSaving: false,
    });
    project.error = '';
    try {
      const diff = await this.options.desktop.getGitDiff(saved.path, saved.staged);
      if (request !== this.request) return;
      const renderable = this.renderable(diff);
      const expectedText = saved.expectedText ?? diff.modifiedText;
      const restoreDraft = !saved.staged && saved.dirty
        && typeof saved.workingText === 'string' && typeof expectedText === 'string';
      project.gitDiff = diff;
      project.gitDiffExpectedText = expectedText;
      project.gitDiffWorkingText = restoreDraft ? saved.workingText! : diff.modifiedText ?? '';
      project.gitDiffDirty = restoreDraft && saved.workingText !== expectedText;
      project.gitDiffMode = renderable ? saved.mode : 'source';
      if (project.gitDiffDirty && diff.modifiedText !== expectedText) {
        project.error = 'The file changed on disk while Setdown reloaded. Your Working Tree edit was restored without overwriting it.';
      }
      this.publishReview();
      if (renderable) await this.preparePreview(request, diff);
      this.publishReview();
    } catch (error) {
      if (request === this.request) {
        project.error = error instanceof Error ? error.message : String(error);
        this.closeDiff();
      }
    } finally {
      if (request === this.request) project.gitDiffLoading = false;
    }
  };

  refresh = async (): Promise<void> => {
    if (!project.folder || project.gitLoading || project.gitBusy) return;
    project.gitLoading = true;
    await this.perform(() => this.options.desktop.getGitStatus(), false);
    project.gitLoading = false;
  };

  documentChanged = (path: string, text: string): void => {
    const target = project.gitDiffTarget;
    const diff = project.gitDiff;
    if (!target || target.staged || target.filePath !== path || !diff) return;
    if (project.gitDiffWorkingText === text) return;
    project.gitDiffWorkingText = text;
    project.gitDiffDirty = text !== (project.gitDiffExpectedText ?? diff.modifiedText);
    project.gitDiffPreviewReady = false;
    this.publishReview();
  };

  documentSaved = async (document: DocumentSnapshot): Promise<void> => {
    const target = project.gitDiffTarget;
    if (!target || target.staged || target.filePath !== document.path) return;
    const request = ++this.request;
    try {
      const diff = await this.options.desktop.getGitDiff(target.filePath, false);
      if (request !== this.request || project.gitDiffTarget?.filePath !== document.path
        || project.gitDiffTarget.staged) return;
      project.gitDiff = diff;
      project.gitDiffWorkingText = diff.modifiedText ?? '';
      project.gitDiffExpectedText = diff.modifiedText;
      project.gitDiffDirty = false;
      project.gitDiffPreviewReady = false;
      project.error = '';
      this.publishReview();
      project.git = await this.options.desktop.getGitStatus();
      if (request !== this.request) return;
      if (this.renderable(diff)) await this.preparePreview(request, diff);
      else if (project.gitDiffMode === 'rendered') project.gitDiffMode = 'source';
      this.publishReview();
    } catch (error) {
      if (request === this.request) {
        project.error = error instanceof Error ? error.message : String(error);
      }
    }
  };

  review = async (filePath: string, staged: boolean): Promise<void> => {
    if (project.gitDiffLoading) return;
    if (project.gitDiffDirty) {
      project.error = 'Save or close the current Working Tree diff first.';
      this.activateDiff();
      return;
    }
    const request = ++this.request;
    this.options.desktop.showPreview(null, null);
    this.options.desktop.destroyPreview(this.previewId);
    this.options.reviewChanged(true, true);
    project.gitDiff = null;
    project.gitDiffTarget = { filePath, staged };
    project.gitDiffActive = true;
    project.gitDiffLoading = true;
    project.gitDiffPreviewLoading = false;
    project.gitDiffPreviewReady = false;
    project.gitDiffFrozen = false;
    project.gitDiffSnapshot = '';
    project.gitDiffWorkingText = '';
    project.gitDiffExpectedText = null;
    project.gitDiffDirty = false;
    project.gitDiffSaving = false;
    project.error = '';
    this.publishReview();
    try {
      const diff = await this.options.desktop.getGitDiff(filePath, staged);
      if (request !== this.request) return;
      project.gitDiff = diff;
      project.gitDiffWorkingText = staged
        ? diff.modifiedText ?? ''
        : this.options.workingTreeBuffer(filePath) ?? diff.modifiedText ?? '';
      project.gitDiffExpectedText = diff.modifiedText;
      project.gitDiffDirty = !staged && project.gitDiffWorkingText !== diff.modifiedText;
      this.publishReview();
      project.gitDiffLine = this.effectiveDiff(diff).hunks[0]?.newStart ?? 1;
      const renderable = this.renderable(diff);
      project.gitDiffMode = renderable && this.options.preferRendered() ? 'rendered' : 'source';
      this.publishReview();
      if (renderable) await this.preparePreview(request, diff);
    } catch (error) {
      if (request === this.request) {
        project.error = error instanceof Error ? error.message : String(error);
        this.closeDiff();
      }
    } finally {
      if (request === this.request) project.gitDiffLoading = false;
    }
  };

  closeDiff = (): void => {
    if (!project.gitDiff && !project.gitDiffTarget && !project.gitDiffLoading && !project.gitDiffPreviewLoading
      && !project.gitDiffPreviewReady) return;
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
      gitDiffWorkingText: '',
      gitDiffExpectedText: null,
      gitDiffDirty: false,
      gitDiffSaving: false,
    });
    this.options.desktop.updateGitReviewState(null);
    this.options.reviewChanged(false, false);
  };

  activateDiff = (): void => {
    if (!project.gitDiff && !project.gitDiffLoading) return;
    project.gitDiffActive = true;
    this.options.reviewChanged(true, true);
    this.syncPreview();
    this.publishReview();
  };

  deactivateDiff = (): void => {
    if (!project.gitDiffActive) return;
    project.gitDiffActive = false;
    this.options.desktop.showPreview(null, null);
    this.options.reviewChanged(true, false);
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
    const diff = project.gitDiff;
    if (!diff || !this.renderable(diff)) return;
    project.gitDiffMode = 'rendered';
    if (!project.gitDiffPreviewReady) void this.preparePreview(this.request, diff);
    else if (project.gitDiffActive) this.syncPreview();
    this.publishReview();
  };

  changeWorkingTree = (text: string): void => {
    const diff = project.gitDiff;
    if (!diff || diff.staged) return;
    if (project.gitDiffWorkingText === text) return;
    project.gitDiffWorkingText = text;
    project.gitDiffDirty = text !== (project.gitDiffExpectedText ?? diff.modifiedText);
    project.gitDiffPreviewReady = false;
    this.options.workingTreeChanged(diff.filePath, text);
    this.publishReview();
  };

  saveWorkingTree = async (): Promise<void> => {
    const diff = project.gitDiff;
    if (!diff || diff.staged || !project.gitDiffDirty || project.gitDiffSaving) return;
    const expectedText = project.gitDiffExpectedText ?? diff.modifiedText ?? '';
    if (diff.modifiedText !== expectedText) {
      project.error = 'The file changed on disk while this diff was open. Close and reopen the diff before saving.';
      return;
    }
    if (!this.options.canSaveWorkingTree(
      diff.filePath,
      expectedText,
      project.gitDiffWorkingText,
    )) {
      project.error = 'The open document has newer unsaved changes. Save or discard them first.';
      return;
    }
    project.gitDiffSaving = true;
    project.error = '';
    const previousText = expectedText;
    try {
      const document = await this.options.desktop.saveGitWorkingTree(
        diff.filePath,
        project.gitDiffWorkingText,
        previousText,
      );
      this.options.workingTreeSaved(diff.filePath, previousText, document);
      const refreshed = await this.options.desktop.getGitDiff(diff.filePath, false);
      if (project.gitDiff !== diff) return;
      project.gitDiff = refreshed;
      project.gitDiffWorkingText = refreshed.modifiedText ?? '';
      project.gitDiffExpectedText = refreshed.modifiedText;
      project.gitDiffDirty = false;
      this.publishReview();
      project.git = await this.options.desktop.getGitStatus();
      project.gitDiffPreviewReady = false;
      if (refreshed.originalText !== null && refreshed.modifiedText !== null) {
        await this.preparePreview(this.request, refreshed);
      }
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
    } finally {
      project.gitDiffSaving = false;
    }
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

  clear = (): void => {
    project.git = null;
    this.closeDiff();
    project.commitMessage = '';
  };

  private showSource(line: number): void {
    project.gitDiffLine = line;
    project.gitDiffMode = 'source';
    if (project.gitDiffActive) this.options.desktop.showPreview(null, null);
    this.publishReview();
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
    const rendered = await this.options.desktop.prepareGitDiffPreview(
      this.previewId,
      this.effectiveDiff(diff),
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
    if (!project.error && !project.gitDiffDirty) await this.refreshOpenDiff();
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
      const diff = await this.options.desktop.getGitDiff(target.filePath, target.staged);
      project.gitDiff = diff;
      project.gitDiffWorkingText = diff.modifiedText ?? '';
      project.gitDiffExpectedText = diff.modifiedText;
      project.gitDiffDirty = false;
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
    const state: GitReviewState = {
      name: `${name} (${target.staged ? 'Index' : 'Working Tree'})`,
      path: target.filePath,
      dirty: project.gitDiffDirty,
      isUntitled: false,
      staged: target.staged,
      active: project.gitDiffActive,
      mode: project.gitDiffMode,
      line: project.gitDiffLine,
      expectedText: project.gitDiffExpectedText,
      workingText: target.staged ? null : project.gitDiffWorkingText,
    };
    this.options.desktop.updateGitReviewState(state);
  }

  private renderable(diff: NonNullable<typeof project.gitDiff>): boolean {
    return diff.originalText !== null && diff.modifiedText !== null
      && /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(diff.filePath);
  }

  private effectiveDiff(diff: GitDiff): GitDiff {
    if (diff.staged || diff.originalText === null || diff.modifiedText === null) return diff;
    const modifiedText = project.gitDiffWorkingText;
    return {
      ...diff,
      modifiedText,
      hunks: textDiffHunks(diff.originalText, modifiedText),
    };
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
