import type { GitRemoteAction, GitSnapshot } from '../../../protocol/desktop-api';
import type { DesktopPort } from '../../ports/desktop-port';
import { project } from '../project-state.svelte';

export class SourceControlController {
  constructor(private readonly desktop: DesktopPort) {}

  refresh = async (): Promise<void> => {
    if (!project.folder || project.gitLoading || project.gitBusy) return;
    project.gitLoading = true;
    await this.perform(() => this.desktop.getGitStatus(), false);
    project.gitLoading = false;
  };

  review = async (filePath: string, staged: boolean): Promise<void> => {
    if (project.gitDiffLoading) return;
    project.gitDiffLoading = true;
    project.error = '';
    try {
      project.gitDiff = await this.desktop.getGitDiff(filePath, staged);
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
    } finally {
      project.gitDiffLoading = false;
    }
  };

  closeDiff = (): void => { project.gitDiff = null; };

  initialize = (): Promise<void> => this.mutate(() => this.desktop.initializeGit());
  stage = (paths: string[]): Promise<void> => this.mutate(() => this.desktop.stageGit(paths));
  unstage = (paths: string[]): Promise<void> => this.mutate(() => this.desktop.unstageGit(paths));
  discard = (paths: string[]): Promise<void> => this.mutate(() => this.desktop.discardGit(paths));
  remote = (action: GitRemoteAction): Promise<void> =>
    this.mutate(() => this.desktop.runGitRemote(action));

  commit = async (message: string): Promise<void> => {
    await this.mutate(() => this.desktop.commitGit(message));
    if (!project.error) project.commitMessage = '';
  };

  clear = (): void => {
    project.git = null;
    project.gitDiff = null;
    project.commitMessage = '';
  };

  private async mutate(action: () => Promise<GitSnapshot>): Promise<void> {
    if (project.gitBusy) return;
    project.gitBusy = true;
    await this.perform(action);
    project.gitBusy = false;
  }

  private async perform(action: () => Promise<GitSnapshot>, clear = true): Promise<void> {
    if (clear) project.error = '';
    try {
      project.git = await action();
      project.gitDiff = null;
      project.error = '';
    } catch (error) {
      project.error = error instanceof Error ? error.message : String(error);
    }
  }
}
