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
  let groups = $derived(gitChangeGroups(project.git?.changes));
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

{#if !project.folder}
  <div class="side-view-welcome"><p>Open a folder to use source control.</p>
    <button type="button" onclick={actions.chooseProjectFolder}>Open Folder</button></div>
{:else if project.gitLoading && !project.git}
  <p class="side-view-message">Reading repository…</p>
{:else if project.gitError && !project.git}
  <p class="side-view-message" role="alert">Could not read repository status. {project.gitError}</p>
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
    <label class="git-branch">Repository <select aria-label="Git repository" value={project.git.root} disabled={project.gitBusy} onchange={event => actions.selectGitRepository(event.currentTarget.value)}>
      {#each project.git.roots ?? [] as root}<option value={root}>{root}</option>{/each}
    </select></label>
  {/if}
  {#if project.git.discoveryLimited}<p class="side-view-message">Repository discovery reached its folder limit. Open a more specific folder to discover additional repositories.</p>{/if}
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
    {#if project.git.changes.length === 0}<p class="side-view-message">No changes.</p>{/if}
  </div>
  </div>
  {#key project.git.root ?? project.folder.path}<GitHistoryPane {actions} root={project.git.root ?? project.folder.path} />{/key}
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
  .scm-split { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
  .scm-changes-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto; }
</style>
