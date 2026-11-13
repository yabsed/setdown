<script lang="ts">
  import type { AppActions } from '../ports/ui-actions';
  import type { BookmarkListing, BookmarkImportResult } from '../../core/browser/bookmarks';
  import { browser } from './browser-state.svelte';
  let { actions, query }: { actions: AppActions; query: string } = $props();
  let parent = $state(''), offset = $state(0), listing = $state<BookmarkListing>({ nodes: [], trail: [], total: 0 });
  let imported = $state<BookmarkImportResult | null>(null), exported = $state(''), error = $state(''), busy = $state(false);
  $effect(() => { void query; offset = 0; });
  $effect(() => {
    const id = parent, text = query, start = offset; void browser.revision;
    let current = true;
    void actions.browserBookmarks(id, text, start).then(value => { if (current) listing = value; }).catch(reason => { if (current) error = String(reason); });
    return () => { current = false; };
  });
  function open(id: string) { parent = id; offset = 0; }
  async function importFile() {
    busy = true; error = '';
    try { const result = await actions.browserImportBookmarks(); if (result) { imported = result; open(result.batch); browser.revision++; } }
    catch (reason) { error = String(reason); } finally { busy = false; }
  }
  async function exportFile() {
    busy = true; error = ''; exported = '';
    try { const result = await actions.browserExportBookmarks(); if (result) exported = `Exported ${result.bookmarks} bookmarks to ${result.path}`; }
    catch (reason) { error = String(reason).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/, ''); } finally { busy = false; }
  }
  async function undo() {
    if (!imported) return;
    busy = true; error = '';
    try { await actions.browserUndoBookmarkImport(imported.batch); imported = null; open(''); browser.revision++; }
    catch (reason) { error = String(reason); } finally { busy = false; }
  }
</script>
<div class="bookmarks">
  <div class="transfer"><button class="import" disabled={busy} onclick={() => void importFile()}>Import bookmarks…</button><button class="import" disabled={busy} onclick={() => void exportFile()}>Export bookmarks…</button></div>
  {#if exported}<p role="status">{exported}</p>{/if}
  {#if imported}<p role="status">Imported {imported.added}; skipped {imported.skipped}. <button disabled={busy} onclick={() => void undo()}>Undo this import</button></p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <nav aria-label="Bookmark folders"><button onclick={() => open('')}>All bookmarks</button>{#each listing.trail as folder (folder.id)}<span>/</span><button onclick={() => open(folder.id)}>{folder.title}</button>{/each}</nav>
  <div class="items">
    {#each listing.nodes as node (node.id)}
      <div class="item place">
        {#if node.kind === 'folder'}<button class="open open-place" onclick={() => open(node.id)}>▸ {node.title}</button>
        {:else}
          <button class="open open-place" title={node.url} onclick={() => actions.newWebTab(node.url!)} onauxclick={event => { if (event.button === 1) { event.preventDefault(); actions.newWebTab(node.url!, true); } }}><span class="place-title">{node.title}</span><small>{node.url}</small></button>
          <button aria-label={`Remove bookmark: ${node.title}`} title="Remove this URL from bookmarks" onclick={() => void actions.browserBookmark(node.url!, node.title, false)}>★</button>
        {/if}
      </div>
    {/each}
    {#if !listing.total}<p>No bookmarks here yet.</p>{/if}
  </div>
  {#if listing.total > 100}<div class="pagination"><button disabled={offset === 0} onclick={() => { offset -= 100; }}>Previous</button><span>{offset + 1}–{Math.min(offset + 100, listing.total)} / {listing.total}</span><button disabled={offset + 100 >= listing.total} onclick={() => { offset += 100; }}>Next</button></div>{/if}
</div>
<style>
  .bookmarks { display: flex; flex-direction: column; min-height: 0; gap: 6px; padding: 0 8px 10px; }
  button { border: 0; border-radius: 4px; padding: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; } button:hover { background: var(--app-hover); } button:disabled { opacity: .5; cursor: default; }
  .transfer { display: flex; flex-wrap: wrap; gap: 3px; } nav, .pagination { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; } nav button { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .items { overflow: auto; min-height: 0; } .item { display: flex; align-items: center; } .open { flex: 1; display: flex; flex-direction: column; min-width: 0; text-align: left; gap: 5px; padding: 9px 7px; }
  .open span, small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { opacity: .6; } p { padding: 4px; line-height: 1.6; overflow-wrap: anywhere; } .pagination { justify-content: space-between; }
</style>
