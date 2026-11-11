<script lang="ts" module>
  // Thumbnails outlive a scrolled-away cell; keyed by path and modification time.
  const cache = new Map<string, string | null>();
  const remember = (key: string, value: string | null) => {
    cache.set(key, value);
    if (cache.size > 800) cache.delete(cache.keys().next().value!);
  };
</script>

<script lang="ts">
  import type { FolderEntry } from '../../protocol/files';
  import FileIcon from '../project/FileIcon.svelte';
  let { entry, load }: { entry: FolderEntry; load(path: string): Promise<string | null> } = $props();
  let url = $state<string | null>(null);
  $effect(() => {
    const key = `${entry.path}\0${entry.modified}`;
    url = cache.get(key) ?? null;
    if (entry.kind === 'directory' || cache.has(key)) return;
    let current = true;
    // Requested only for mounted (visible) cells; the list is virtualized.
    void load(entry.path).then(value => { remember(key, value); if (current) url = value; }, () => remember(key, null));
    return () => { current = false; };
  });
</script>

<span class="folder-thumb" aria-hidden="true">
  {#if entry.kind === 'directory'}
    <svg viewBox="0 0 48 48"><path d="M5 12.5a3 3 0 0 1 3-3h10.5l4 4.5H40a3 3 0 0 1 3 3V36a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/></svg>
  {:else if url}
    <img src={url} alt="" draggable="false" />
  {:else}
    <span class="folder-thumb-icon"><FileIcon path={entry.path} /></span>
  {/if}
</span>

<style>
  .folder-thumb { display: grid; place-items: center; width: 100%; height: 100%; min-height: 0; }
  .folder-thumb svg { width: 72%; height: 72%; fill: color-mix(in srgb, var(--app-accent) 26%, transparent); stroke: var(--app-muted-text); stroke-width: 1.2; stroke-linejoin: round; }
  .folder-thumb img { max-width: 100%; max-height: 100%; border-radius: 4px; object-fit: contain; box-shadow: 0 0 0 1px var(--app-border); }
  .folder-thumb-icon { font-size: 2.6em; line-height: 1; }
</style>
