<script lang="ts">
  import { onMount } from 'svelte';
  import { documentSupport, type DocumentSupportTarget } from './document-support';
  import type { LanguageCatalogEntry } from '../../protocol/language';
  import LanguageConnectionSettings from './LanguageConnectionSettings.svelte';
  let { target, server, mode }: { target: DocumentSupportTarget; server: string; mode: 'settings' | 'output' } = $props();
  let entry = $state<LanguageCatalogEntry>(), error = $state(''), loading = $state(false);
  let live = true;
  onMount(() => { void load(); return () => { live = false; }; });
  async function load() {
    if (loading) return; loading = true; error = '';
    try { const value = await documentSupport.current(target)?.inspectProvider(server); if (live && documentSupport.current(target)) entry = value; }
    catch (reason) { if (live) error = String(reason); }
    finally { if (live) loading = false; }
  }
  const sessions = $derived(entry?.sessions.filter(session => session.root === entry?.projectRoot) ?? []);
</script>

{#if mode === 'settings'}
  {#if entry?.options && entry.projectRoot}
    <LanguageConnectionSettings initial={entry.options} languages={entry.languages} {server} scope={entry.projectRoot} apply={async options => {
      const support = documentSupport.current(target); if (!support) throw Error('This document is no longer open.');
      await support.configureProvider(server, options);
    }} />
  {/if}
{:else}
  {#if entry}<p>{entry.bundled ? 'Included with Setdown' : 'Installed tool'} · {entry.name}</p><p>Executable: {entry.executable}</p>{/if}
  {#each sessions as session}
    <p>{session.root}</p><p>{session.rootReason}</p>
    {#each session.context ?? [] as item}<p>{item}</p>{/each}
    <pre>{session.logs?.join('\n') || 'No server output.'}</pre>
  {/each}
  <button disabled={loading} onclick={load}>Refresh output</button>
{/if}
{#if loading}<p role="status">Loading tool details…</p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  button:focus-visible { outline: 1px solid var(--app-focus-ring); }
  p, pre { overflow-wrap: anywhere; white-space: pre-wrap; font: inherit; font-size: 11px; }
  button { color: inherit; background: transparent; border: 1px solid var(--app-border); border-radius: 4px; padding: 5px 8px; cursor: pointer; font: inherit; }
  button:hover { background: var(--app-hover); } .error { color: var(--app-warning-text); }
</style>
