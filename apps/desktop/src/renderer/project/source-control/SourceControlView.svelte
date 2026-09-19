<script lang="ts">
  import type { AppActions } from '../../view-state.svelte';
  import { project } from '../project-state.svelte';
  import SideViewMenu from '../SideViewMenu.svelte';
  import ChangeGroup from './ChangeGroup.svelte';

  let { actions }: { actions: AppActions } = $props();
  let discardPaths = $state<string[]>([]);
  let conflicts = $derived(project.git?.changes.filter((change) => change.conflict) ?? []);
  let staged = $derived(project.git?.changes.filter((change) => change.staged && !change.conflict) ?? []);
  let changed = $derived(project.git?.changes.filter((change) => change.unstaged && !change.conflict) ?? []);

  function requestDiscard(paths: string[]) {
    discardPaths = paths;
  }

  function confirmDiscard() {
    // `$state` arrays are proxies; copy them before crossing contextBridge/IPC.
    const paths = [...discardPaths];
    discardPaths = [];
    actions.discardProjectGit(paths);
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
    disabled={!project.folder || project.gitLoading || project.gitBusy} onclick={actions.refreshProjectGit}>
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
{:else if !project.git?.repository}
  <div class="scm-empty"><p>The open folder is not a Git repository.</p>
    <button type="button" disabled={project.gitBusy} onclick={actions.initializeProjectGit}>Initialize Repository</button></div>
{:else}
  <div class="git-branch">
    <svg viewBox="0 0 16 16"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="5" r="1.5"/><path d="M4 4.5v7M5.5 4c3 0 2 3 5 2.5"/></svg>
    <strong>{project.git.branch}</strong>
    {#if project.git.upstream}<span title={project.git.upstream}>⇣{project.git.behind} ⇡{project.git.ahead}</span>{/if}
    {#if project.gitBusy}<small>Running…</small>{/if}
  </div>
  <div class="scm-commit">
    <textarea rows="2" placeholder="Message (Ctrl+Enter to commit)" aria-label="Commit message"
      bind:value={project.commitMessage} onkeydown={commit}></textarea>
    <button type="button" disabled={project.gitBusy || !project.commitMessage.trim() || !staged.length}
      title={staged.length ? 'Commit staged changes' : 'Stage changes before committing'}
      onclick={() => commit()}>Commit</button>
  </div>
  <div class="scm-groups">
    <ChangeGroup title="MERGE CHANGES" changes={conflicts} primaryLabel="Stage"
      primary={actions.stageProjectGit} review={(path) => actions.reviewProjectGitChange(path, false)}
      open={actions.openProjectFile} />
    <ChangeGroup title="STAGED CHANGES" changes={staged} primaryLabel="Unstage"
      primary={actions.unstageProjectGit} review={(path) => actions.reviewProjectGitChange(path, true)}
      open={actions.openProjectFile} />
    <ChangeGroup title="CHANGES" changes={changed} primaryLabel="Stage"
      primary={actions.stageProjectGit} discard={requestDiscard}
      review={(path) => actions.reviewProjectGitChange(path, false)} open={actions.openProjectFile} />
    {#if project.git.changes.length === 0}<p class="side-view-message">No changes.</p>{/if}
  </div>
{/if}

{#if discardPaths.length}
  <div class="project-confirm" role="alertdialog" aria-modal="true" aria-labelledby="discard-title">
    <strong id="discard-title">Discard {discardPaths.length === 1 ? 'this change' : `${discardPaths.length} changes`}?</strong>
    <span>Tracked edits cannot be recovered. Untracked files go to the system Trash.</span>
    <div><button type="button" class="ghost" onclick={() => discardPaths = []}>Cancel</button>
      <button type="button" class="danger" onclick={confirmDiscard}>Discard Changes</button></div>
  </div>
{/if}
