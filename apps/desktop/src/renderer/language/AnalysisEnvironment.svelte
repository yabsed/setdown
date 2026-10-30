<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { DocumentAnalysis, AnalysisSelection } from '../../core/document/analysis-context';
  import type { DocumentSupport } from './document-support';
  let { support }: { support: DocumentSupport } = $props();
  let context = $state<DocumentAnalysis>(), loading = $state(false), busy = $state(false), preparing = $state(false);
  let error = $state(''), output = $state('');
  let epoch = 0;
  const resource = $derived(support.path + '\0' + support.language);
  $effect(() => { resource; untrack(() => { busy = false; preparing = false; output = ''; void refresh(); }); });
  onDestroy(() => { epoch++; });
  async function refresh() {
    const request = ++epoch, current = support; loading = true; error = '';
    try { const value = await current.environment(); if (request === epoch) context = value; }
    catch (failure) { if (request === epoch) error = String(failure); }
    finally { if (request === epoch) loading = false; }
  }
  async function select(selection: AnalysisSelection) {
    const request = ++epoch, current = support; busy = true; error = '';
    try { const value = await current.selectEnvironment(selection); if (request === epoch) context = value; }
    catch (failure) { if (request === epoch) error = String(failure); }
    finally { if (request === epoch) busy = false; }
  }
  async function prepare() {
    const request = ++epoch, current = support; preparing = true; error = ''; output = '';
    try {
      const result = await current.prepareEnvironment();
      if (request === epoch) { output = result.output || 'Project configured.'; context = await current.environment(); }
    } catch (failure) { if (request === epoch) error = String(failure); }
    finally { if (request === epoch) preparing = false; }
  }
</script>

{#if loading}<p class="hint" role="status">Finding project environment…</p>{/if}
{#if context && (context.kind || context.servers.length)}
  <section aria-label="Project analysis environment" aria-busy={busy || preparing}>
    <div class="heading"><strong>Project environment</strong><button disabled={busy || preparing} onclick={() => refresh()} aria-label="Refresh project environment">Refresh</button></div>
    <p class="root" title={context.root}>{context.root}</p>
    {#if context.servers.some(server => server.role === 'primary')}
      <label>Analysis provider
        <select aria-label="Analysis provider" disabled={busy || preparing} value={context.servers.some(server => server.enabled && server.role === 'primary') ? context.servers.find(server => server.selected)?.id ?? '' : 'off'}
          onchange={event => select({ kind: 'server', value: event.currentTarget.value })}>
          <option value="off">Basic editing · no project analysis</option>
          {#each context.servers.filter(server => server.role === 'primary') as server}<option value={server.id}>{server.name}{server.enabled ? '' : ' · disabled'}</option>{/each}
        </select>
      </label>
    {/if}
    {#if context.kind}
      <label>{context.label}
        <select aria-label={context.label} disabled={busy || preparing} value={context.selected ?? ''}
          onchange={event => context?.kind && select({ kind: context.kind, value: event.currentTarget.value })}>
          {#if !context.selected}<option value="" disabled>Choose an environment…</option>{/if}
          {#each context.choices as choice}<option value={choice.id} disabled={!choice.available}>{choice.name} · {choice.source}{choice.available ? '' : ' · missing'}</option>{/each}
        </select>
      </label>
      {@const selected = context.choices.find(choice => choice.id === context?.selected)}
      {#if selected}<p class="hint path">{selected.path}</p>{/if}
      <div class="actions">
        <button disabled={busy || preparing} onclick={() => context?.kind && select({ kind: context.kind, value: 'browse' })}>{context.kind === 'compilation' ? 'Choose build folder…' : context.kind === 'python' ? 'Choose Python…' : 'Choose SDK…'}</button>
        <button disabled={busy || preparing} onclick={() => context?.kind && select({ kind: context.kind, value: 'automatic' })}>Use automatic selection</button>
      </div>
      <p class="hint">Applies to this project. Open buffers and Undo history are preserved.</p>
    {/if}
    {#each context.issues as issue}<p class="issue" role="status">{issue.message}</p>{/each}
    {#if context.preparation}
      <details class="prepare"><summary>Configure {context.preparation === 'cmake' ? 'CMake' : 'Meson'} analysis</summary>
        <p>Run the project’s configure step to generate a compilation database in Setdown’s build cache. This runs project configuration code; generated headers may still require a build.</p>
        {#if preparing}<p role="status">Configuring project…</p><button onclick={() => support.cancelPreparation().catch(failure => error = String(failure))}>Cancel configuration</button>
        {:else}<button disabled={busy} onclick={prepare}>Configure project</button>{/if}
      </details>
    {/if}
    <details><summary>Environment details</summary><p>{context.rootReason}</p>{#each context.evidence as evidence}<p>{evidence}</p>{/each}</details>
    {#if output}<details><summary>Configuration output</summary><pre>{output}</pre></details>{/if}
  </section>
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  section { padding: 12px 0; border-top: 1px solid var(--app-border); }
  .heading, .actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .heading { justify-content: space-between; }
  label { display: grid; gap: 5px; margin: 10px 0 4px; }
  select { min-width: 0; width: 100%; box-sizing: border-box; padding: 6px; color: var(--app-text); background: var(--app-canvas); border: 1px solid var(--app-border); font: inherit; }
  button { color: inherit; background: transparent; border: 1px solid var(--app-border); border-radius: 4px; padding: 4px 7px; font: inherit; font-size: 11px; cursor: pointer; }
  button:hover { background: var(--app-hover); } button:disabled, select:disabled { opacity: .6; cursor: default; }
  button:focus-visible, select:focus-visible, summary:focus-visible { outline: 1px solid var(--app-focus-ring); }
  p { margin: 6px 0; overflow-wrap: anywhere; }
  .hint, .root, details { color: var(--app-muted-text); font-size: 11px; }
  .path { margin-bottom: 8px; }
  .issue, .error { color: var(--app-warning-text); }
  .error { white-space: pre-wrap; max-height: 180px; overflow: auto; }
  details { margin-top: 10px; } summary { cursor: pointer; }
  pre { white-space: pre-wrap; max-height: 180px; overflow: auto; }
</style>
