<script lang="ts">
  // A file whose versions are not compared as text: what it is, how large each version is,
  // and what can be done instead. VS Code shows a placeholder per side with "Open Anyway"
  // (`binaryDiffEditor.ts`); one card says the same for both sides here.
  import { isOpenableDocument } from '../../../core/document/document-profile';
  import type { GitDiff } from '../../../protocol/desktop-api';
  import { sideSummary, sizeChange, versionLabel, withheld } from './compared-file';

  let { diff, onopen }: { diff: GitDiff; onopen(path: string): void } = $props();
  const reason = $derived(withheld(diff));
  const name = $derived(diff.filePath.split(/[\\/]/).at(-1) ?? diff.filePath);
  // The file as it is now can be opened when Setdown has a surface for its type and it still exists.
  const openable = $derived(isOpenableDocument(diff.filePath) && !(diff.sides?.modified.missing && !diff.history));
</script>

{#if reason}
  <div class="git-file-notice" role="status" aria-label="Comparison not shown">
    <strong>{reason.title}</strong>
    <p>{name}: {reason.detail}</p>
    <dl>
      <div><dt>{versionLabel(diff.originalLabel)}</dt><dd>{sideSummary(diff.sides?.original) || 'size unknown'}</dd></div>
      <div><dt>{versionLabel(diff.modifiedLabel)}</dt><dd>{sideSummary(diff.sides?.modified) || 'size unknown'}</dd></div>
    </dl>
    {#if sizeChange(diff)}<p class="change">{sizeChange(diff)}</p>{/if}
    {#if openable}<button type="button" onclick={() => onopen(diff.filePath)}>{diff.history ? 'Open the Current File' : 'Open File'}</button>{/if}
  </div>
{/if}

<style>
  .git-file-notice { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
    padding: 24px; color: var(--app-subtle-text); background: var(--app-editor-background); font-size: 12px; text-align: center; }
  strong { color: var(--app-text); font-size: 13px; }
  p { margin: 0; max-width: 60ch; overflow-wrap: anywhere; }
  dl { display: grid; gap: 3px; margin: 6px 0 0; min-width: 240px; }
  dl div { display: flex; justify-content: space-between; gap: 24px; padding: 3px 10px; border: 1px solid var(--app-border); border-radius: 4px; }
  dt { color: var(--app-text); }
  dd { margin: 0; font-variant-numeric: tabular-nums; }
  .change { color: var(--app-muted-text); }
  button { margin-top: 6px; padding: 5px 12px; color: var(--app-text); border: 1px solid var(--app-border); border-radius: 4px; background: var(--app-surface); font: inherit; cursor: pointer; }
  button:hover { background: var(--app-hover); }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); outline-offset: 1px; }
</style>
