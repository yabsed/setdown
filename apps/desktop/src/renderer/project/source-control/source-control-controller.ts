import type {
  DocumentSnapshot,
  GitRemoteAction,
  GitSnapshot,
  PreviewBounds,
  PreviewMessage,
} from '../../../protocol/desktop-api';
import type { PreviewThemeId } from '../../../core/preview/preview-preferences';
import type { DesktopPort } from '../../ports/desktop-port';
import { project } from '../project-state.svelte';

type Options = {
  desktop: DesktopPort;
  preferRendered(): boolean;
  reviewChanged(open: boolean, active: boolean): void;
  canSaveWorkingTree(path: string, expectedText: string): boolean;
  workingTreeSaved(path: string, previousText: string, document: DocumentSnapshot): void;
};

export class SourceControlController {
  private readonly previewId = `git-diff:${crypto.randomUUID()}`;
  private request = 0;
  private bounds: PreviewBounds | null = null;
  private themeId: PreviewThemeId | null = null;

  constructor(private readonly options: Options) {}

  refresh = async (): Promise<void> => {
    if (!project.folder || project.gitLoading || project.gitBusy) return;
    project.gitLoading = true;
    await this.perform(() => this.options.desktop.getGitStatus(), false);
    project.gitLoading = false;
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
    project.gitDiffWorkingText = '';
    project.gitDiffDirty = false;
    project.gitDiffSaving = false;
    project.error = '';
    this.publishReview();
    try {
      const diff = await this.options.desktop.getGitDiff(filePath, staged);
      if (request !== this.request) return;
      project.gitDiff = diff;
      project.gitDiffWorkingText = diff.modifiedText ?? '';
      project.gitDiffDirty = false;
      this.publishReview();
      project.gitDiffLine = diff.hunks[0]?.newStart ?? 1;
      const renderable = diff.originalText !== null && diff.modifiedText !== null
        && /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(diff.filePath);
      project.gitDiffMode = renderable && this.options.preferRendered() ? 'rendered' : 'source';
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
    Object.assign(project, {
      gitDiff: null,
      gitDiffTarget: null,
      gitDiffActive: false,
      gitDiffLoading: false,
      gitDiffPreviewLoading: false,
      gitDiffPreviewReady: false,
      gitDiffLine: 1,
      gitDiffWorkingText: '',
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
  };

  deactivateDiff = (): void => {
    if (!project.gitDiffActive) return;
    project.gitDiffActive = false;
    this.options.desktop.showPreview(null, null);
    this.options.reviewChanged(true, false);
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
    if (!project.gitDiffPreviewReady) return;
    if (project.gitDiffDirty) {
      project.error = 'Save the Working Tree diff before returning to the rendered comparison.';
      return;
    }
    project.gitDiffMode = 'rendered';
    if (project.gitDiffActive) this.syncPreview();
  };

  changeWorkingTree = (text: string): void => {
    const diff = project.gitDiff;
    if (!diff || diff.staged) return;
    project.gitDiffWorkingText = text;
    project.gitDiffDirty = text !== diff.modifiedText;
    this.publishReview();
  };

  saveWorkingTree = async (): Promise<void> => {
    const diff = project.gitDiff;
    if (!diff || diff.staged || !project.gitDiffDirty || project.gitDiffSaving) return;
    if (!this.options.canSaveWorkingTree(diff.filePath, diff.modifiedText ?? '')) {
      project.error = 'The open document has newer unsaved changes. Save or discard them first.';
      return;
    }
    project.gitDiffSaving = true;
    project.error = '';
    const previousText = diff.modifiedText ?? '';
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
  }

  private syncPreview(): void {
    this.options.desktop.showPreview(
      project.gitDiffActive && project.gitDiffMode === 'rendered' && project.gitDiffPreviewReady
        ? this.previewId : null,
      project.gitDiffActive && project.gitDiffMode === 'rendered' && project.gitDiffPreviewReady
        ? this.bounds : null,
    );
  }

  private async preparePreview(request: number, diff: NonNullable<typeof project.gitDiff>) {
    project.gitDiffPreviewLoading = true;
    const theme = await this.options.desktop.getTheme();
    this.themeId ??= theme.id;
    const rendered = await this.options.desktop.prepareGitDiffPreview(this.previewId, diff, theme.id);
    if (request !== this.request) return;
    project.gitDiffPreviewLoading = false;
    project.gitDiffPreviewReady = rendered.supported;
    if (!rendered.supported && project.gitDiffMode === 'rendered') project.gitDiffMode = 'source';
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
      project.gitDiffDirty = false;
      this.publishReview();
      project.gitDiffPreviewReady = false;
      const renderable = diff.originalText !== null && diff.modifiedText !== null
        && /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(diff.filePath);
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
    this.options.desktop.updateGitReviewState({
      name: `${name} (${target.staged ? 'Index' : 'Working Tree'})`,
      path: target.filePath,
      dirty: project.gitDiffDirty,
      isUntitled: false,
    });
  }
}
