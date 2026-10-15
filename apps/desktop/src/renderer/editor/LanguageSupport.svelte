<script lang="ts">
  import { onMount } from 'svelte';
  import type { LanguageApi, LanguageCatalog, LanguageCatalogEntry, LanguageServerOptions } from '../../protocol/language';
  let { api, onclose }: { api: LanguageApi; onclose(): void } = $props();
  let dialog: HTMLDialogElement;
  let catalog = $state<LanguageCatalog>({ release: '', entries: [] });
  let query = $state('');
  let selectedId = $state('');
  let busy = $state(false);
  let error = $state('');
  let adding = $state(false);
  let connectionId = $state('');
  let connectionName = $state('');
  let languageId = $state('');
  let extensions = $state('');
  let markers = $state('');
  let optionsText = $state('');
  let live = true, refreshVersion = 0;
  const selected = $derived(catalog.entries.find(entry => entry.id === selectedId));
  const entries = $derived(catalog.entries.filter(entry => `${entry.name} ${entry.id} ${entry.languages.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.sessions.some(s => s.state === 'ready')) - Number(a.sessions.some(s => s.state === 'ready'))
      || Number(b.available || !!b.candidates?.length) - Number(a.available || !!a.candidates?.length)
      || Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name)));
  const defaults: LanguageServerOptions = { args: [], settings: {}, initializationOptions: {} };
  function choose(entry: LanguageCatalogEntry) {
    selectedId = entry.id; adding = false; error = '';
    optionsText = JSON.stringify(entry.options ?? defaults, null, 2);
  }
  async function refresh() {
    const version = ++refreshVersion;
    const result = await api.catalog();
    if (!live || version !== refreshVersion) return;
    catalog = result;
    if (!selectedId && !adding) { const first = entries[0]; if (first) choose(first); }
  }
  async function perform(action: () => Promise<unknown>) {
    if (busy) return;
    busy = true; error = '';
    try { await action(); await refresh(); }
    catch (reason) { error = String(reason); }
    finally { busy = false; }
  }
  function status(entry: LanguageCatalogEntry) {
    if (!entry.configured) return entry.candidates?.length ? 'Found · Connection details needed' : 'Connection details needed';
    if (!entry.enabled) return 'Disabled';
    if (entry.sessions.some(session => session.state === 'failed')) return 'Failed';
    if (entry.sessions.some(session => session.state === 'starting')) return 'Starting';
    if (entry.sessions.some(session => session.state === 'ready')) return 'Running';
    if (entry.selectionNeeded) return 'Choose an installation';
    if (!entry.available) return 'Executable missing';
    return entry.selected.length ? 'Found · Starts when needed' : 'Found · Choose a primary server';
  }
  function beginConnection(entry?: LanguageCatalogEntry) {
    selectedId = entry?.id ?? '';
    adding = true; error = ''; connectionId = entry?.id ?? ''; connectionName = entry?.name ?? '';
    languageId = ''; extensions = ''; markers = ''; optionsText = JSON.stringify(defaults, null, 2);
  }
  const words = (text: string) => text.split(/[\s,]+/).filter(Boolean);
  async function add() {
    const options = JSON.parse(optionsText);
    if (await api.addConnection({ ...options, id: connectionId.trim(), name: connectionName.trim(),
      languages: [{ languageId: languageId.trim(), extensions: words(extensions) }], rootMarkers: words(markers),
      candidateId: selected?.id === connectionId.trim() && selected.candidates?.length === 1 ? selected.candidates[0].id : undefined })) {
      selectedId = connectionId.trim(); adding = false;
    }
  }
  onMount(() => {
    window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: true }));
    dialog.showModal();
    void refresh().catch(reason => { error = String(reason); });
    const unsubscribe = api.onEvent(event => {
      if (event.type !== 'diagnostics') void refresh().catch(reason => { error = String(reason); });
    });
    return () => {
      live = false; unsubscribe(); dialog.close();
      window.dispatchEvent(new CustomEvent('setdown:native-overlay-visibility', { detail: false }));
    };
  });
</script>

<dialog bind:this={dialog} class="language-support" aria-labelledby="language-support-title"
  oncancel={event => { event.preventDefault(); onclose(); }}>
  <header>
    <h2 id="language-support-title">Language Support</h2>
    <button disabled={busy} onclick={() => perform(() => api.rescan())}>{busy ? 'Checking…' : 'Rescan installed servers'}</button>
    <button aria-label="Close language support" onclick={onclose}>×</button>
  </header>
  <div class="body">
    <aside aria-label="Language server catalog">
      <input type="search" aria-label="Search language servers" placeholder="Search language or server…" bind:value={query} />
      <div class="server-list">
        {#each entries as entry (entry.id)}
          <button class:selected={entry.id === selectedId && !adding} aria-pressed={entry.id === selectedId && !adding}
            onclick={() => choose(entry)}>
            <strong>{entry.name}</strong><small>{entry.languages.join(', ')}</small><small>{status(entry)}</small>
          </button>
        {/each}
        {#if !entries.length}<p>No matching servers.</p>{/if}
      </div>
      <div class="catalog-actions">
        <button disabled={busy} onclick={() => beginConnection()}>New connection</button>
        <button disabled={busy} onclick={() => perform(() => api.importDefinition())}>Import JSON…</button>
      </div>
    </aside>
    <section class="details" aria-label="Server details" aria-busy={busy}>
      {#if error}<p role="alert">{error}</p>{/if}
      {#if adding}
        <h3>Connect an installed server</h3>
        <p>Choose a language server that communicates over standard input/output. The next step selects its executable.</p>
        <label>Connection ID<input bind:value={connectionId} placeholder="my-language-server" /></label>
        <label>Name<input bind:value={connectionName} placeholder="My language server" /></label>
        <label>LSP language ID<input bind:value={languageId} placeholder="go" /></label>
        <label>File extensions<input bind:value={extensions} placeholder=".go" /></label>
        <label>Project root markers<input bind:value={markers} placeholder="go.mod .git" /></label>
        <label>Server options (JSON)<textarea rows="9" spellcheck="false" bind:value={optionsText}></textarea></label>
        <div class="buttons"><button disabled={busy} onclick={() => perform(add)}>Choose executable and connect…</button>
          <button disabled={busy} onclick={() => { adding = false; if (selected) choose(selected); }}>Cancel</button></div>
      {:else if selected}
        <h3>{selected.name}</h3>
        <p>{selected.description}</p>
        <p class="state">{status(selected)}{selected.bundled ? ' · Included with Setdown' : ''}</p>
        {#if selected.setupNote}<p>{selected.setupNote}</p>{/if}
        {#if selected.configured}
          <p>Executable<br /><code>{selected.executable}</code></p>
          {#if selected.automatic && selected.enabled}<p>Connects when a matching file is opened. If several servers are installed, choose one below.</p>{/if}
          {#if selected.discoveryMessage}<p>{selected.discoveryMessage}</p>{/if}
          {#if selected.candidates && selected.candidates.length > 1}
            <details open={selected.selectionNeeded}>
              <summary>Installed executables</summary>
              {#each selected.candidates as candidate (candidate.id)}
                <p><code>{candidate.path}</code> · {candidate.source}<br />
                  <button disabled={busy} onclick={() => perform(() => api.selectCandidate(selected!.id, candidate.id))}>Use this executable</button></p>
              {/each}
            </details>
          {/if}
          {#if selected.selected.length}<p>Selected for {selected.selected.join(', ')}.</p>{/if}
          <div class="buttons">
            <button disabled={busy} onclick={() => perform(() => api.setEnabled(selected!.id, !selected!.enabled))}>{selected.enabled ? 'Disable' : 'Enable'}</button>
            {#if selected.enabled && !selected.selected.length}<button disabled={busy} onclick={() => perform(() => api.setEnabled(selected!.id, true))}>Use for these languages</button>{/if}
            {#if !selected.bundled}<button disabled={busy} onclick={() => perform(() => api.chooseExecutable(selected!.id))}>Choose executable…</button>{/if}
            {#if selected.canDetect}<button disabled={busy} onclick={() => perform(() => api.useAutomatic(selected!.id))}>Use automatic detection</button>{/if}
            <button disabled={busy} onclick={() => window.dispatchEvent(new Event('setdown:restart-language'))}>Restart servers in this window</button>
          </div>
          {#each selected.sessions as session}
            <p class="session"><code>{session.root}</code><br />{session.state}{session.message ? ` · ${session.message}` : ''}
              {#if session.features?.length}<br />{session.features.join(', ')}{/if}</p>
          {/each}
          <details>
            <summary>Connection settings</summary>
            {#if selected.profileSource}<p>Profile: {selected.profileSource}</p>{/if}
            {#if selected.searched?.length}<p>Searched: {selected.searched.join(', ')}</p>{/if}
            <label>Server options (JSON)<textarea rows="12" spellcheck="false" bind:value={optionsText}></textarea></label>
            <button disabled={busy} onclick={() => perform(() => api.configure(selected!.id, JSON.parse(optionsText)))}>Apply settings</button>
          </details>
          {#if selected.custom}<button disabled={busy} onclick={() => perform(async () => { await api.remove(selected!.id); selectedId = ''; })}>Remove connection</button>{/if}
        {:else}
          <p>This server's connection profile is not included yet. Provide its language ID, file extensions and stdio arguments once.</p>
          {#if selected.candidates?.length}
            <p>Detected installation:</p>
            {#each selected.candidates as candidate}<p><code>{candidate.path}</code></p>{/each}
          {/if}
          <button disabled={busy} onclick={() => beginConnection(selected)}>Connect installed server…</button>
        {/if}
        {#if selected.homepage}<button disabled={busy} onclick={() => perform(() => api.openHomepage(selected!.id))}>Installation instructions ↗</button>{/if}
      {:else}<p>Choose a server or add a connection.</p>{/if}
    </section>
  </div>
  <footer>Catalog: Mason {catalog.release} · {catalog.entries.length} servers · {catalog.profiles ?? 0} connection profiles · Installation is manual.</footer>
</dialog>

<style>
  .language-support { width: min(900px, 90vw); max-height: 88vh; padding: 0; color: var(--app-text); background: var(--app-raised-surface); border: 1px solid var(--app-border); border-radius: 8px; }
  .language-support::backdrop { background: var(--app-overlay); }
  header, footer { padding: 14px 20px; border-bottom: 1px solid var(--app-border); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2, h3 { margin: 0; font-size: 17px; } h3 { margin-bottom: 12px; }
  button, input, textarea { font: inherit; color: inherit; background: transparent; border: 1px solid var(--app-border); border-radius: 4px; padding: 7px 10px; }
  button { cursor: pointer; } button:hover, button.selected { background: var(--app-hover); }
  button:disabled { opacity: .5; cursor: default; }
  .body { display: grid; grid-template-columns: 280px minmax(0, 1fr); height: min(610px, 67vh); }
  aside { display: flex; flex-direction: column; min-height: 0; padding: 14px; gap: 10px; border-right: 1px solid var(--app-border); }
  .server-list { overflow: auto; flex: 1; }
  .server-list button { display: flex; flex-direction: column; gap: 4px; text-align: left; width: 100%; margin-bottom: 4px; border-color: transparent; }
  small, footer { opacity: .7; font-size: 11px; } strong { font-weight: 500; }
  .details { padding: 20px; overflow: auto; min-width: 0; }
  p { font-size: 13px; line-height: 1.6; } .state { font-weight: 600; }
  label { display: grid; gap: 6px; margin: 14px 0; font-size: 12px; }
  code, textarea { font-family: inherit; font-size: 12px; overflow-wrap: anywhere; }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; }
  .buttons, .catalog-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .catalog-actions { margin-bottom: 0; } .catalog-actions button { flex: 1; padding: 6px; font-size: 11px; }
  details { margin: 18px 0; } summary { cursor: pointer; } .session { opacity: .8; }
  [role='alert'] { color: var(--app-danger-text); white-space: pre-wrap; }
  footer { border-top: 1px solid var(--app-border); border-bottom: 0; }
  @media (max-width: 700px) { .body { grid-template-columns: 190px minmax(0, 1fr); } }
</style>
