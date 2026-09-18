<script lang="ts">
  import type { AppActions } from '../../view-state.svelte';
  import { project } from '../project-state.svelte';

  let { actions }: { actions: AppActions } = $props();
  let lines = $derived(project.gitDiff?.patch.split(/\r?\n/) ?? []);
  const markdown = (filePath: string) => /\.(?:md|markdown|mdown|mkdn|mkd|rmd|qmd|mdx)$/i.test(filePath);
  const kind = (line: string) => line.startsWith('+++') || line.startsWith('---') ? 'file'
    : line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed'
      : line.startsWith('@@') ? 'hunk' : 'context';
</script>

<section class="scm-diff" aria-label="Git diff">
  <header>
    <button type="button" title="Back to Changes" aria-label="Back to Changes"
      onclick={actions.closeProjectGitDiff}>←</button>
    <strong>{project.gitDiff?.path}</strong>
    <span>{project.gitDiff?.staged ? 'INDEX' : 'WORKTREE'}</span>
    {#if project.gitDiff && markdown(project.gitDiff.filePath)}<button type="button" title="Open File" aria-label="Open File"
      onclick={() => actions.openProjectFile(project.gitDiff!.filePath)}>↗</button>{/if}
  </header>
  {#if project.gitDiffLoading}
    <p class="side-view-message">Reading changes…</p>
  {:else if !lines.length || !project.gitDiff?.patch}
    <p class="side-view-message">No textual differences.</p>
  {:else}
    <pre>{#each lines as line, index}<code class={kind(line)}><i>{index + 1}</i>{line || ' '}</code>{/each}</pre>
  {/if}
</section>
