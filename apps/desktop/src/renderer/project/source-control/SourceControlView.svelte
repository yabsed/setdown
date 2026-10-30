<script lang="ts">
  import type { AppActions } from '../../ports/ui-actions';
  import { project } from '../project-state.svelte';
  import NativeOverlay from '../../shell/NativeOverlay.svelte';
  import { confirmationFocus } from '../../shell/confirmation-focus';
  import SideViewMenu from '../SideViewMenu.svelte';
  import GitHistoryPane from './GitHistoryPane.svelte';
  import ChangeGroup from './ChangeGroup.svelte';
  import { gitChangeGroups } from './git-change-groups';

  let { actions }: { actions: AppActions } = $props();
  let groups = $derived(gitChangeGroups(project.git?.changes, project.git?.settings));
  let conflicts = $derived(groups.conflicts);
  let staged = $derived(groups.staged);
  let changed = $derived(groups.changed);
  const groupExpanded = (title: string) => !project.collapsedGitGroups.includes(title);

  let discardPaths = $state<string[] | null>(null);
  let discardRoot: string | undefined;
  function requestDiscard(paths: string[]) { discardRoot = project.git?.root; discardPaths = [...paths]; }
  function confirmDiscard() {
    // Svelte state arrays are proxies; IPC requires a plain, cloneable value.
    const paths = discardPaths && [...discardPaths]; discardPaths = null;
    if (paths && discardRoot === project.git?.root) actions.discardProjectGit(paths);
  }

  function commit(event?: KeyboardEvent) {
    if (event && !(event.key === 'Enter' && (event.ctrlKey || event.metaKey))) return;
    event?.preventDefault();
    if (project.commitMessage.trim() && staged.length) actions.commitProjectGit(project.commitMessage);
  }
</script>

<header class="side-view-title">
  <span>SOURCE CONTROL</span>
  <button type="button" title="Refresh Source Control" aria-label="Refresh Source Control"
    aria-busy={project.gitLoading} disabled={!project.folder || project.gitBusy}
    onclick={actions.refreshProjectGit}>
    <svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.46-3.54L13 6M13 2v4H9"/></svg>
  </button>
  <SideViewMenu items={[
    { label: 'Fetch', disabled: !project.git?.repository || project.gitBusy,
      run: () => actions.runProjectGitRemote('fetch') },
    { label: 'Pull', disabled: !project.git?.repository || project.gitBusy,
      run: () => actions.runProjectGitRemote('pull') },
    { label: 'Push', disabled: !project.git?.repository || project.gitBusy,
      run: () => actions.runProjectGitRemote('push') },
    { label: 'Synchronize Changes', disabled: !project.git?.repository || project.gitBusy,
      run: () => actions.runProjectGitRemote('sync') },
  ]} />
</header>

  {#if project.git?.errors?.length}<div class="scm-errors" role="status">
    {#each project.git.errors as error}<details><summary title={error.root}>Could not read {error.root.split(/[\\/]/).at(-1)}</summary>
      <p>{error.root}</p><code>{error.command}</code><p>{error.message}</p></details>{/each}
  </div>{/if}

{#if !project.folder}
  <div class="side-view-welcome"><p>Open a folder to use source control.</p>
    <button type="button" onclick={actions.chooseProjectFolder}>Open Folder</button></div>
{:else if project.gitLoading && !project.git}
  <p class="side-view-message">Reading repository…</p>
{:else if project.gitError && !project.git}
  <p class="side-view-message" role="alert">Could not read repository status. {project.gitError}</p>
{:else if !project.git?.repository && project.git?.parentRepository}
  <div class="side-view-welcome"><p>This folder belongs to a repository in a parent folder.</p>
    <button type="button" title={project.git.parentRepository} onclick={() => actions.selectGitRepository(project.git!.parentRepository!)}>Open Parent Repository</button></div>
{:else if !project.git?.repository && project.git?.errors?.length}
  <p class="side-view-message">Repository discovery could not finish. Resolve the reported error and refresh Source Control.</p>
{:else if !project.git?.repository}
  <div class="scm-empty"><p>The open folder is not a Git repository.</p>
    <button type="button" disabled={project.gitBusy} onclick={actions.initializeProjectGit}>Initialize Repository</button></div>
{:else}
  <div class="scm-split">
  <div class="scm-changes-pane">
  <div class="git-branch">
    <svg viewBox="0 0 16 16"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="5" r="1.5"/><path d="M4 4.5v7M5.5 4c3 0 2 3 5 2.5"/></svg>
    <strong title={project.git.root}>{project.git.branch}</strong>
    {#if project.git.upstream}<span title={project.git.upstream}>⇣{project.git.behind} ⇡{project.git.ahead}</span>{/if}
    {#if project.gitBusy}<small>Running…</small>{/if}
  </div>
  {#if (project.git.roots?.length ?? 0) > 1}
    <label class="git-branch scm-repository">Repository <select aria-label="Git repository" title={project.git.root} value={project.git.root} disabled={project.gitBusy} onchange={event => actions.selectGitRepository(event.currentTarget.value)}>
      {#each project.git.roots ?? [] as root}<option value={root}>{root}</option>{/each}
    </select></label>
  {/if}
  {#if project.git.discoveryLimited}<p class="side-view-message">Repository discovery reached a configured limit. Open a more specific folder or adjust Git discovery settings to include more repositories.</p>{/if}
  {#if project.git.statusLimited}<p class="side-view-message">Showing the first {project.git.settings?.statusLimit} changes. The count is incomplete.</p>{/if}
  {#if project.git.settings}<details class="scm-settings"><summary>Repositories and Count</summary>
    {#each project.git.roots ?? [] as root}<label title={root}><input type="checkbox" checked={project.git.visibleRoots?.includes(root) ?? true}
      onchange={event => actions.configureGit({ visibleRoots: event.currentTarget.checked ? [...(project.git?.visibleRoots ?? []), root] : project.git?.visibleRoots?.filter(value => value !== root) })}/><span>{root}</span></label>{/each}
    <label>Activity badge <select aria-label="Source Control badge scope" value={project.git.settings.scmCountBadge}
      onchange={event => actions.configureGit({ settings: { scmCountBadge: event.currentTarget.value as 'all' | 'focused' | 'off' } })}>
      <option value="all">Visible repositories</option><option value="focused">Focused repository</option><option value="off">Off</option></select></label>
    <label>Count <select aria-label="Git count badge" value={project.git.settings.countBadge}
      onchange={event => actions.configureGit({ settings: { countBadge: event.currentTarget.value as 'all' | 'tracked' | 'off' } })}>
      <option value="all">All changes</option><option value="tracked">Tracked changes</option><option value="off">Off</option></select></label>
    <label>Untracked files <select aria-label="Untracked changes" value={project.git.settings.untrackedChanges}
      onchange={event => actions.configureGit({ settings: { untrackedChanges: event.currentTarget.value as 'mixed' | 'separate' | 'hidden' } })}>
      <option value="mixed">Mixed</option><option value="separate">Separate group</option><option value="hidden">Hidden</option></select></label>
  </details>{/if}
  <div class="scm-commit">
    <textarea rows="2" placeholder="Message (Ctrl+Enter to commit)" aria-label="Commit message"
      bind:value={project.commitMessage} onkeydown={commit}></textarea>
    <button type="button" disabled={project.gitBusy || !project.commitMessage.trim() || !staged.length}
      title={staged.length ? 'Commit staged changes' : 'Stage changes before committing'}
      onclick={() => commit()}>Commit</button>
  </div>
  <div class="scm-groups">
    <ChangeGroup title="MERGE CHANGES" changes={conflicts} primaryLabel="Stage"
      expanded={groupExpanded('MERGE CHANGES')} toggle={() => actions.toggleProjectGitGroup('MERGE CHANGES')}
      primary={actions.stageProjectGit} review={(path, options) => actions.reviewProjectGitChange(path, false, options)}
      open={actions.openProjectFile} />
    <ChangeGroup title="STAGED CHANGES" changes={staged} primaryLabel="Unstage"
      expanded={groupExpanded('STAGED CHANGES')} toggle={() => actions.toggleProjectGitGroup('STAGED CHANGES')}
      primary={actions.unstageProjectGit} review={(path, options) => actions.reviewProjectGitChange(path, true, options)}
      open={actions.openProjectFile} />
    <ChangeGroup title="CHANGES" changes={changed} primaryLabel="Stage"
      expanded={groupExpanded('CHANGES')} toggle={() => actions.toggleProjectGitGroup('CHANGES')}
      primary={actions.stageProjectGit} discard={requestDiscard}
      review={(path, options) => actions.reviewProjectGitChange(path, false, options)} open={actions.openProjectFile} />
    <ChangeGroup title="UNTRACKED CHANGES" changes={groups.untracked} primaryLabel="Stage"
      expanded={groupExpanded('UNTRACKED CHANGES')} toggle={() => actions.toggleProjectGitGroup('UNTRACKED CHANGES')}
      primary={actions.stageProjectGit} discard={requestDiscard}
      review={(path, options) => actions.reviewProjectGitChange(path, false, options)} open={actions.openProjectFile} />
    {#if !project.git.selectedError && project.git.root && conflicts.length + staged.length + changed.length + groups.untracked.length === 0}<p class="side-view-message">No changes.</p>{/if}
  </div>
  </div>
  {#if project.git.root}{#key project.git.root}<GitHistoryPane {actions} root={project.git.root} />{/key}{/if}
  </div>
{/if}

{#if discardPaths}
  <NativeOverlay />
  <div class="project-confirm" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" use:confirmationFocus={() => discardPaths = null}>
    <strong id="discard-title">Discard changes in {discardPaths.length} file(s)?</strong>
    <span>Tracked files revert to the index. Untracked files move to Trash. Unsaved editor edits are kept.</span>
    <span>{discardPaths.map(path => path.split(/[\\/]/).at(-1)).join(', ')}</span>
    <div><button type="button" class="ghost" onclick={() => discardPaths = null}>Cancel</button>
      <button type="button" class="danger" onclick={confirmDiscard}>Discard Changes</button></div>
  </div>
{/if}

<style>
  .scm-settings, .scm-errors { padding: 6px 12px; font-size: 12px; overflow-wrap: anywhere; }
  .scm-settings summary, .scm-errors summary { cursor: pointer; }
  .scm-settings label { display: flex; align-items: center; gap: 6px; margin: 6px 0; min-width: 0; }
  .scm-settings label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .scm-settings select { min-width: 0; flex: 1; background: var(--app-surface); color: var(--app-text); border: 1px solid var(--app-border); }
  .scm-split { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
  .scm-changes-pane { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; }
  .scm-repository { min-width: 0; flex-shrink: 0; }
  .scm-repository select {
    flex: 1; width: 0; min-width: 0; padding: 3px 5px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    border: 1px solid var(--app-strong-border); border-radius: 3px;
    background: var(--app-surface); color: var(--app-text); font: inherit;
  }
  .scm-repository select:focus-visible { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
</style>
