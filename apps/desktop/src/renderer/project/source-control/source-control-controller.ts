import type {
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
  reviewChanged(open: boolean): void;
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
    await this.perform(() => this.options.desktop.getGitStatus(), false, false);
    project.gitLoading = false;
  };

  review = async (filePath: string, staged: boolean): Promise<void> => {
    if (project.gitDiffLoading) return;
    const request = ++this.request;
    this.options.desktop.showPreview(null, null);
    this.options.desktop.destroyPreview(this.previewId);
    this.options.reviewChanged(true);
    project.gitDiff = null;
    project.gitDiffTarget = { filePath, staged };
    project.gitDiffLoading = true;
    project.gitDiffPreviewLoading = false;
    project.gitDiffPreviewReady = false;
    project.error = '';
    try {
      const diff = await this.options.desktop.getGitDiff(filePath, staged);
      if (request !== this.request) return;
      project.gitDiff = diff;
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
      gitDiffLoading: false,
      gitDiffPreviewLoading: false,
      gitDiffPreviewReady: false,
      gitDiffLine: 1,
    });
    this.options.reviewChanged(false);
  };

  layoutDiff = (bounds: PreviewBounds | null): void => {
    this.bounds = bounds;
    this.syncPreview();
  };

  toggleDiffMode = (): void => {
    if (!project.gitDiff) return;
    if (project.gitDiffMode === 'rendered') this.showSource(project.gitDiffLine);
    else this.showRendered();
  };

  showRendered = (): void => {
    if (!project.gitDiffPreviewReady) return;
    project.gitDiffMode = 'rendered';
    this.syncPreview();
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
    this.options.desktop.showPreview(null, null);
  }

  private syncPreview(): void {
    this.options.desktop.showPreview(
      project.gitDiffMode === 'rendered' && project.gitDiffPreviewReady ? this.previewId : null,
      project.gitDiffMode === 'rendered' && project.gitDiffPreviewReady ? this.bounds : null,
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
    project.gitBusy = false;
  }

  private async perform(
    action: () => Promise<GitSnapshot>,
    clear = true,
    closeReview = true,
  ): Promise<void> {
    if (clear) project.error = '';
    try {
      project.git = await action();
      if (closeReview && (project.gitDiff || project.gitDiffLoading)) this.closeDiff();
      project.error = '';
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
    }
  }
}
