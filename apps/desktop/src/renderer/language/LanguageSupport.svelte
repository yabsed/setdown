<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { isComposingInput } from '../editor/composition-guard';
  import LanguageLogo from './LanguageLogo.svelte';
  import LanguageConnectionSettings from './LanguageConnectionSettings.svelte';
  import { languageCatalogRequest } from './document-support';
  import type { LanguageApi, LanguageCatalog, LanguageCatalogEntry, LanguageServerOptions } from '../../protocol/language';
  let { api, onclose }: { api: LanguageApi; onclose(): void } = $props();
  import { connectionSource, serverGroups, serverStatus } from './language-presentation';
  let searchInput = $state<HTMLInputElement>();
  let backButton = $state<HTMLButtonElement>();
  let loaded = $state(false);
  let mode = $state<'home' | 'languages' | 'language' | 'connections' | 'list' | 'details' | 'add'>('home');
  let detailParent = $state<'list' | 'connections' | 'language'>('list');
  let catalog = $state<LanguageCatalog>({ release: '', entries: [] });
  let query = $state('');
  let selectedId = $state('');
  let settingsTarget = $state<LanguageCatalogEntry>();
  async function inspect() {
    const request = languageCatalogRequest.get();
    detailParent = 'list';
    query = request.language ?? ''; mode = request.server ? 'details' : request.language ? 'languages' : 'home';
    const result = await api.catalog(undefined, !!request.server);
    if (!live || languageCatalogRequest.get() !== request) return;
    catalog = result; loaded = true;
    const entry = result.entries.find(e => e.id === request.server); if (entry) choose(entry);
    else await tick().then(() => (searchInput ?? document.querySelector<HTMLButtonElement>('.language-support .settings-row'))?.focus());
  }
  let busy = $state(false);
  let selectedLanguage = $state('');
  const language = $derived(catalog.languages?.find(item => item.id === selectedLanguage));
  const languageDefaults = $derived((catalog.languages ?? []).filter(item => `${item.name} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b) => a.name.localeCompare(b.name)));
  let error = $state('');
  const adding = $derived(mode === 'add');
  let connectionId = $state('');
  let connectionName = $state('');
  let languageId = $state('');
  let extensions = $state('');
  let markers = $state('');
  let optionsText = $state('');
  let live = true, refreshVersion = 0;
  const selected = $derived(catalog.entries.find(entry => entry.id === selectedId));
  const groups = $derived(serverGroups(catalog.entries, query));
  const templates = $derived([...catalog.entries].sort((a, b) => a.name.localeCompare(b.name)));
  const defaults: LanguageServerOptions = { args: [], settings: {}, initializationOptions: {} };
  function choose(entry: LanguageCatalogEntry) {
    if (mode === 'list' || mode === 'connections' || mode === 'language') detailParent = mode;
    selectedId = entry.id; settingsTarget = structuredClone($state.snapshot(entry)); mode = 'details'; error = '';
    void tick().then(() => backButton?.focus());

  }
  async function refresh() {
    const version = ++refreshVersion;
    const result = await api.catalog(undefined, mode === 'list' || mode === 'details' || mode === 'add');
    if (!live || version !== refreshVersion) return;
    catalog = result; loaded = true;
  }
  async function perform(action: () => Promise<unknown>) {
    if (busy) return;
    busy = true; error = '';
    try { await action(); await refresh(); }
    catch (reason) { error = String(reason); }
    finally { busy = false; }
  }
  const status = (entry: LanguageCatalogEntry) => serverStatus(entry).label;
  function back() {
    mode = mode === 'language' ? 'languages' : mode === 'details' || mode === 'add' ? detailParent : 'home'; error = '';
    void tick().then(() => (mode === 'home' ? document.querySelector<HTMLButtonElement>('.language-support .settings-row') : searchInput ?? backButton)?.focus());
  }
  async function navigate(next: typeof mode) { mode = next; query = ''; error = ''; await refresh(); await tick(); (searchInput ?? backButton)?.focus(); }
  function beginConnection(entry?: LanguageCatalogEntry) {
    if (mode === 'list' || mode === 'connections' || mode === 'language') detailParent = mode;
    selectedId = entry?.id ?? '';
    mode = 'add'; error = ''; connectionId = entry?.id ?? ''; connectionName = entry?.name ?? '';
    languageId = ''; extensions = ''; markers = ''; optionsText = JSON.stringify(defaults, null, 2);
    void tick().then(() => backButton?.focus());
  }
  const words = (text: string) => text.split(/[\s,]+/).filter(Boolean);
  async function add() {
    const options = JSON.parse(optionsText);
    if (await api.addConnection({ ...options, id: connectionId.trim(), name: connectionName.trim(),
      languages: [{ languageId: languageId.trim(), extensions: words(extensions) }], rootMarkers: words(markers),
      candidateId: selected?.id === connectionId.trim() && selected.candidates?.length === 1 ? selected.candidates[0].id : undefined })) {
      await refresh(); const entry = catalog.entries.find(item => item.id === connectionId.trim());
      if (entry) choose(entry);
    }
  }
  onMount(() => {
    void inspect().catch(reason => error = String(reason));
    const stopInspection = languageCatalogRequest.subscribe(() => { void inspect().catch(reason => error = String(reason)); });
    if (mode === 'list') searchInput?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isComposingInput(event) || !(event.target instanceof Element)
        || !event.target.closest('.language-support')) return;
      event.preventDefault(); event.stopPropagation();
      if (query && (mode === 'list' || mode === 'languages')) query = '';
      else if (mode !== 'home') back();
      else { onclose(); void tick().then(() => document.querySelector<HTMLButtonElement>('.activity-bar [aria-label="Language Support"]')?.focus()); }
    };
    window.addEventListener('keydown', keydown);
    const unsubscribe = api.onEvent(event => {
      if (event.type === 'configuration' || (mode === 'list' || mode === 'details') && (event.type === 'discovery' || event.type === 'status'))
        void refresh().catch(reason => { error = String(reason); });
    });
    return () => {
      live = false; unsubscribe(); stopInspection(); window.removeEventListener('keydown', keydown);
    };
  });
</script>

<section class="language-support" aria-label="Language Support" aria-busy={busy}>
  <header class="side-view-title">
    <span>LANGUAGE SUPPORT</span>
    {#if mode === 'list' || mode === 'details'}<button type="button" disabled={busy} aria-label="Rescan installed servers" title="Check external installations again" onclick={() => perform(() => api.rescan())}>
      <svg class:scanning={busy} viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.46-3.54L13 6M13 2v4H9"/></svg>
    </button>{/if}
    <button type="button" aria-label="Close language support" title="Hide Language Support" onclick={onclose}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>
    </button>
  </header>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if mode === 'home'}
    <div class="settings-list">
      <h3>Language settings</h3>
      <p>All of Setdown. Project choices are preserved.</p>
      <label class="download-setting"><input type="checkbox" aria-label="Download analysis tools automatically" checked={catalog.automaticInstall !== false} disabled={busy || !loaded} onchange={event => perform(() => api.setAutomaticInstall(event.currentTarget.checked))} /><span>Download analysis tools when needed</span></label>
      <p>Uses existing executables and prepared project caches when downloads are off. Tool and project settings can override this default.</p>
      <button class="settings-row" onclick={() => navigate('languages')}><strong>Language defaults</strong><span>Choose the default analysis tool for each language.</span></button>
      <button class="settings-row" onclick={() => navigate('connections')}><strong>Custom connections</strong><span>Servers you have added yourself.</span></button>
      <button class="settings-row" onclick={() => navigate('list')}><strong>Installation management</strong><span>Managed tools, external executables and advanced settings.</span></button>
    </div>
  {:else if mode === 'languages' || mode === 'language'}
    <div class="navigation"><button bind:this={backButton} class="text-action" onclick={back} aria-label="Back to language settings">← {mode === 'language' ? 'Language defaults' : 'Language settings'}</button></div>
    {#if mode === 'languages'}
      <div class="search"><input bind:this={searchInput} type="search" aria-label="Search languages" placeholder="Search languages" bind:value={query} /></div>
      <div class="server-list">
        {#each languageDefaults as item (item.id)}
          <button class="server" data-language-id={item.id} onclick={() => { selectedLanguage = item.id; mode = 'language'; void tick().then(() => backButton?.focus()); }}>
            <LanguageLogo languages={[item.id]} /><span class="server-info"><strong>{item.name}</strong><small>{item.selection.mode === 'off' ? 'Analysis off by default' : item.selection.mode === 'server' ? catalog.entries.find(entry => entry.id === item.selection.server)?.name : item.servers.length ? 'Automatic' : 'Syntax and editing support'}</small></span>
          </button>
        {/each}
        {#if !languageDefaults.length}<p class="empty">No matching languages.</p>{/if}
      </div>
    {:else if language}
      <div class="details">
        <h3>{language.name}</h3><p>App default · applies where a project has no explicit selection.</p>
        {#if language.servers.length}
          <label>Default analysis tool<select aria-label="Default analysis tool" disabled={busy} value={language.selection.mode === 'server' ? language.selection.server : language.selection.mode} onchange={event => perform(() => api.setLanguageDefault(language!.id, event.currentTarget.value))}>
            <option value="automatic">Automatic</option><option value="off">No project analysis by default</option>
            {#each language.servers as id}<option value={id}>{catalog.entries.find(entry => entry.id === id)?.name ?? id}</option>{/each}
          </select></label>
          {#if language.defaultServer}<p>Default tool: {catalog.entries.find(entry => entry.id === language.defaultServer)?.name ?? language.defaultServer}.</p>{/if}
          {#if language.selection.mode === 'off'}<p>Syntax and local editing checks remain available. Projects can choose an analysis tool explicitly.</p>
          {:else}<p>Opening a matching file starts the default tool. Preparation follows the download policy.</p>{/if}
          {#if language.defaultServer}<button onclick={() => perform(async () => { selectedId = language!.defaultServer!; detailParent = 'language'; mode = 'details'; await refresh(); const entry = catalog.entries.find(item => item.id === selectedId); if (entry) choose(entry); })}>Tool settings…</button>{/if}
        {:else}<p>Syntax highlighting and editing support are available. The default support for this language does not include project analysis.</p>{/if}
      </div>
    {/if}
  {:else if mode === 'connections'}
    <div class="navigation"><button bind:this={backButton} class="text-action" onclick={back} aria-label="Back to language settings">← Language settings</button></div>
    <div class="details"><h3>Custom connections</h3><p>Connections you add apply across Setdown. Select them as a language default or in a project's Code support.</p>
      {#each catalog.entries.filter(entry => entry.custom) as entry}<button class="settings-row" data-server-id={entry.id} onclick={() => choose(entry)}>{entry.name}</button>{/each}
      {#if !catalog.entries.some(entry => entry.custom)}<p>No custom connections.</p>{/if}
      <button onclick={() => beginConnection()}>Add server manually…</button>
      <button onclick={() => perform(async () => { await api.importDefinition(); })}>Import JSON…</button>
    </div>
  {:else if mode === 'list'}
    <div class="navigation"><button bind:this={backButton} class="text-action" onclick={back} aria-label="Back to language settings">← Language settings</button></div>
    <div class="search">
      <input bind:this={searchInput} type="search" aria-label="Search language servers" placeholder="Search language servers" bind:value={query} />
    </div>
    {#if busy}<p class="progress" role="status">Checking installed servers…</p>{/if}
    <div class="server-list">
      {#each groups as group (group.id)}
        <details class="server-group" data-group={group.id} open={!!query.trim() || group.id !== 'available'}>
          <summary>{group.title}<span class="count">{group.entries.length}</span></summary>
          {#if group.id === 'available'}<p class="group-help">Supported tools can be prepared when a matching file needs them.</p>{/if}
          {#each group.entries as entry (entry.id)}
            {@const state = serverStatus(entry)}
            <button class="server" data-server-id={entry.id} onclick={() => choose(entry)} title={entry.description}>
              <LanguageLogo languages={entry.languages} />
              <span class="server-info"><strong>{entry.name}</strong><small>{entry.languages.join(', ')}</small>
                <span class="metadata"><span class="status" data-tone={state.tone}>{state.label}</span><small>{connectionSource(entry)}</small></span>
              </span>
            </button>
          {/each}
        </details>
      {/each}
      {#if !loaded}<p class="empty" role="status">Loading installations…</p>
      {:else if !groups.length}<div class="empty"><p>{query ? 'No matching servers.' : 'No installations to manage.'}</p></div>{/if}
    </div>
    <footer>
      <button class="text-action" disabled={busy} onclick={() => beginConnection()}>Add server manually…</button>
      <button class="text-action" disabled={busy} onclick={() => perform(async () => { if (await api.importDefinition()) { query = ''; await tick(); searchInput?.focus(); } })}>Import JSON…</button>
    </footer>
  {:else}
    <div class="navigation"><button bind:this={backButton} class="text-action" onclick={back} aria-label={detailParent === 'list' ? 'Back to language servers' : detailParent === 'connections' ? 'Back to custom connections' : 'Back to language default'}>← {detailParent === 'list' ? 'Language servers' : detailParent === 'connections' ? 'Custom connections' : 'Language default'}</button></div>
    <section class="details" aria-label="Server details">
      {#if adding}
        <h3>Add language server</h3>
        <p>Already installed, but not detected? Choose a profile to locate its executable.</p>
        <label>Existing server profile<select value="" onchange={event => { const entry = catalog.entries.find(entry => entry.id === event.currentTarget.value); if (entry) choose(entry); }}>
          <option value="">Choose a server…</option>
          {#each templates as entry}<option value={entry.id}>{entry.name} — {entry.languages.join(', ')}</option>{/each}
        </select></label>
        <h4>Custom connection</h4>
        <p>For other servers, enter the connection details below or import a JSON definition.</p>
        <button class="text-action" disabled={busy} onclick={() => perform(async () => { if (await api.importDefinition()) { query = ''; back(); } })}>Import JSON…</button>
        <label>Connection ID<input bind:value={connectionId} placeholder="my-language-server" /></label>
        <label>Name<input bind:value={connectionName} placeholder="My language server" /></label>
        <label>LSP language ID<input bind:value={languageId} placeholder="go" /></label>
        <label>File extensions<input bind:value={extensions} placeholder=".go" /></label>
        <label>Project root markers<input bind:value={markers} placeholder="go.mod .git" /></label>
        <label>Server options (JSON)<textarea rows="9" spellcheck="false" bind:value={optionsText}></textarea></label>
        <div class="buttons"><button disabled={busy} onclick={() => perform(add)}>Choose executable and connect…</button>
          <button disabled={busy} onclick={back}>Cancel</button></div>
      {:else if selected}
        <div class="server-heading"><LanguageLogo languages={selected.languages} /><h3>{selected.name}</h3></div>
        <p>{selected.description}</p>
        <div class="detail-status"><span class="state status" data-tone={serverStatus(selected).tone}>{status(selected)}</span><span class="source">{connectionSource(selected)}</span></div>
        {#if selected.setupNote}<p>{selected.setupNote}</p>{/if}
        {#if selected.notebook}
          <p>Choose Python in the notebook toolbar. Analysis and execution share that environment.</p>
        {:else if selected.configured}

          {#if selected.automatic && selected.enabled}<p>Starts when you open a matching file.</p>{/if}
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
            <button class:primary={!selected.enabled} disabled={busy} onclick={() => perform(() => api.setEnabled(selected!.id, !selected!.enabled))}>{selected.enabled ? 'Disable by default' : 'Enable by default'}</button>
            {#if selected.enabled && !selected.selected.length}<button disabled={busy} onclick={() => perform(() => api.setEnabled(selected!.id, true))}>Use for these languages</button>{/if}
            {#if !selected.available && !selected.bundled && !selected.preparation}<button disabled={busy} onclick={() => perform(() => api.chooseExecutable(selected!.id))}>Choose executable…</button>{/if}

          </div>
          <details><summary>Additional actions</summary>
            <p>Inspect results, environment and recovery from a document's Code support.</p>
            <p class="executable"><span class="field-label">Executable</span><code>{selected.preparation?.executable ?? selected.executable}</code></p>
          </details>
          <details>
            <summary>Connection settings</summary>
            <div class="buttons">
              {#if !selected.bundled}<button disabled={busy} onclick={() => perform(() => api.chooseExecutable(selected!.id))}>Choose executable…</button>{/if}
              {#if selected.canDetect}<button disabled={busy} onclick={() => perform(() => api.useAutomatic(selected!.id))}>Reset executable selection</button>{/if}
            </div>
            {#if selected.profileSource}<p>Profile: {selected.profileSource}</p>{/if}
            {#if selected.searched?.length}<p>Searched: {selected.searched.join(', ')}</p>{/if}
            {#if settingsTarget}{#key settingsTarget}
              <LanguageConnectionSettings initial={settingsTarget.globalOptions ?? defaults} languages={settingsTarget.languages} server={settingsTarget.id} apply={async options => { await api.configure(settingsTarget!.id, options); await refresh(); }} />
            {/key}{/if}
          </details>
          {#if selected.custom}<button disabled={busy} onclick={() => perform(async () => { await api.remove(selected!.id); selectedId = ''; back(); })}>Remove connection</button>{/if}
        {:else}
          <p>This server's connection profile is not included yet. Provide its language ID, file extensions and stdio arguments once.</p>
          {#if selected.candidates?.length}
            <p>Detected installation:</p>
            {#each selected.candidates as candidate}<p><code>{candidate.path}</code></p>{/each}
          {/if}
          <button disabled={busy} onclick={() => beginConnection(selected)}>Connect installed server…</button>
        {/if}
        {#if selected.homepage}<button class="text-action" disabled={busy} onclick={() => perform(() => api.openHomepage(selected!.id))}>Installation instructions ↗</button>{/if}
      {:else}<p>Choose a server or add a connection.</p>{/if}
    </section>
  {/if}
</section>

<style>
  .settings-list { overflow: auto; padding: 14px; }
  .settings-row { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 12px; margin: 10px 0; border: 1px solid var(--app-border); border-radius: 4px; background: transparent; text-align: left; }
  .settings-row:hover { background: var(--app-hover); }
  .settings-row span { color: var(--app-muted-text); line-height: 1.5; }
  .download-setting { display: flex; align-items: flex-start; gap: 8px; margin-top: 22px; line-height: 1.5; }
  .download-setting input { width: auto; margin-top: 2px; accent-color: var(--app-accent); }
  .language-support { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; color: var(--app-text); font-size: 12px; }
  .search { padding: 4px 12px 10px; }
  input, select, textarea { width: 100%; min-width: 0; box-sizing: border-box; padding: 5px 7px; color: var(--app-text); background: var(--app-raised-surface); border: 1px solid var(--app-border); border-radius: 2px; font: inherit; }
  input[type='search'] { height: 28px; }
  input:focus, select:focus, textarea:focus { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  button { color: inherit; font: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible, summary:focus-visible { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  .server-list { flex: 1; min-height: 0; overflow: auto; }
  .server-group > summary { display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 12px; font-size: 10px; font-weight: 600; text-transform: uppercase; cursor: pointer; user-select: none; }
  .server-group > summary::before { content: '›'; font-size: 16px; transform: rotate(0deg); }
  .server-group[open] > summary::before { transform: rotate(90deg); }
  .count { margin-left: auto; padding: 0 6px; border-radius: 9px; background: var(--app-hover); color: var(--app-muted-text); font-size: 10px; line-height: 16px; }
  .server { display: flex; gap: 10px; width: 100%; padding: 10px 12px; text-align: left; border: 0; background: transparent; }
  .server:hover { background: var(--app-hover); }
  .server:focus-visible { background: var(--app-hover); }
  .group-help { margin: 2px 12px 8px; font-size: 11px; }
  .server-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .server-heading h3 { margin: 0; }
  .server-info { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; }
  strong, .server-info > small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  strong { font-size: 12px; font-weight: 600; }
  small, .source { color: var(--app-muted-text); font-size: 10px; }
  .metadata, .detail-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .status { font-size: 10px; color: var(--app-muted-text); }
  .status::before { content: ''; display: inline-block; width: 5px; height: 5px; margin: 0 5px 1px 0; border-radius: 50%; background: currentColor; }
  .status[data-tone='success'] { color: var(--app-accent); }
  .status[data-tone='warning'] { color: var(--app-warning-text); }
  .status[data-tone='error'] { color: var(--app-danger-text); }
  footer { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; padding: 10px 12px; border-top: 1px solid var(--app-border); }
  .text-action { padding: 2px 0; color: var(--app-accent); background: transparent; border: 0; text-align: left; font-size: 11px; }
  .text-action:hover { text-decoration: underline; }
  .navigation { padding: 5px 12px 10px; border-bottom: 1px solid var(--app-border); }
  .details { flex: 1; min-height: 0; overflow: auto; padding: 14px 14px 20px; overflow-wrap: anywhere; }
  h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
  h4 { margin: 22px 0 6px; font-size: 12px; }
  p { line-height: 1.55; color: var(--app-muted-text); margin: 10px 0; }
  .detail-status { margin: 12px 0; }
  .detail-status .status { font-size: 11px; }
  .field-label { display: block; margin-bottom: 4px; font-size: 10px; }
  code, textarea { font-family: inherit; font-size: 11px; }
  code { color: var(--app-text); }
  label { display: grid; gap: 6px; margin: 14px 0; font-size: 11px; }
  textarea { resize: vertical; }
  .buttons { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0; }
  .details button:not(.text-action) { padding: 5px 8px; border: 1px solid var(--app-border); border-radius: 2px; background: var(--app-hover); font-size: 11px; }
  .details button:not(.text-action):hover { border-color: var(--app-focus-ring); }
  .details button.primary { color: #fff; background: var(--app-accent); border-color: var(--app-accent); }
  .details details { padding: 10px 0; border-top: 1px solid var(--app-border); margin-top: 14px; }
  .details summary { font-size: 11px; cursor: pointer; }
  .empty { padding: 8px 14px; color: var(--app-muted-text); line-height: 1.6; }
  .error { margin: 8px 12px; color: var(--app-danger-text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .progress { margin: 0 12px 6px; font-size: 11px; }
  .scanning { animation: spin 1.2s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .scanning { animation: none; } }
</style>
