<script lang="ts">
  // Before | after for a file Setdown has a reader for (PDF, Office), as images are compared.
  // Both readers share the tab's zoom. A file that exists on one side only takes the full width.
  import type { GitDiff } from '../../../protocol/desktop-api';
  import { sizeChange } from './compared-file';
  import GitDocumentVersion from './GitDocumentVersion.svelte';

  let { diff, tabId, active, focused, onfocus }: { diff: GitDiff; tabId: string; active: boolean; focused: boolean; onfocus(): void } = $props();
  const documents = $derived(diff.documents!);
  const both = $derived(!!documents.original && !!documents.modified);
  let side = $state<'Original' | 'Modified'>('Modified');
  let together = $state(true);
  let original = $state<{ showPage(page: number): void }>(), modified = $state<{ showPage(page: number): void }>();
  const pages = { Original: 0, Modified: 0 };
  // Turning a page on one side turns the other to the same number. The follower reports that
  // page back, finds the first side already there, and the exchange ends.
  function turned(from: 'Original' | 'Modified', page: number) {
    if (pages[from] === page) return;
    pages[from] = page;
    const to = from === 'Original' ? 'Modified' : 'Original';
    if (together && both && pages[to] !== page) (to === 'Original' ? original : modified)?.showPage(page);
  }
  const focus = (target: 'Original' | 'Modified') => { side = target; onfocus(); };
</script>

<section class="git-document-diff" aria-label="Document comparison" data-document-kind={documents.kind}>
  <div class="document-toolbar">
    <span class="change">{sizeChange(diff) ?? ''}</span>
    {#if documents.kind === 'pdf' && both}
      <label><input type="checkbox" bind:checked={together} /> Turn pages together</label>
    {/if}
  </div>
  <div class="document-pair" class:single={!both}>
    {#if documents.original || both || !documents.modified}
      <GitDocumentVersion bind:reader={original} version={documents.original} kind={documents.kind} label={diff.originalLabel} side="Original"
        filePath={diff.filePath} {tabId} {active} focused={focused && side === 'Original'} onfocus={() => focus('Original')} onpage={page => turned('Original', page)} />
    {/if}
    {#if documents.modified || both}
      <GitDocumentVersion bind:reader={modified} version={documents.modified} kind={documents.kind} label={diff.modifiedLabel} side="Modified"
        filePath={diff.filePath} {tabId} {active} focused={focused && side === 'Modified'} onfocus={() => focus('Modified')} onpage={page => turned('Modified', page)} />
    {/if}
  </div>
</section>

<style>
  .git-document-diff { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--app-editor-background); }
  .document-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 14px; min-height: 26px; padding: 3px 10px; border-bottom: 1px solid var(--app-border); font-size: 12px; color: var(--app-muted-text); }
  .change { margin-right: auto; }
  label { display: flex; align-items: center; gap: 5px; }
  .document-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); flex: 1; min-width: 0; min-height: 0; }
  .document-pair.single { grid-template-columns: minmax(0, 1fr); }
  .document-pair.single :global(.document-version) { border-left: 0; }
</style>
