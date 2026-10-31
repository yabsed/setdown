<script lang="ts">
  import type { AnalysisState } from './document-analysis-controller';
  import type { AnalysisSelection } from '../../core/document/analysis-context';
  import { projectLabel, selectionSource } from './document-presentation';
  let { state, select, refresh, prepare, cancel }: {
    state: AnalysisState; select(value: AnalysisSelection): void; refresh(): void; prepare(): void; cancel(): void;
  } = $props();
  const context = $derived(state.context);
</script>

{#if context}
  <section aria-label="Project analysis environment" aria-busy={state.busy}>
    <p class="scope">Project · {projectLabel(context.root)}</p>
    <p class="scope">Applies to files using this analysis root, including other tabs and windows.</p>
    {#each context.issues as issue}<p class="issue">{issue.message}</p>{/each}
    {#if context.kind}
      <label>{context.label}
        <select aria-label={context.label} disabled={state.busy} value={context.selected ?? ''}
          onchange={event => context?.kind && select({ kind: context.kind, value: event.currentTarget.value })}>
          {#if !context.selected}<option value="" disabled>Choose an environment…</option>{/if}
          {#each context.choices as choice}<option value={choice.id} disabled={!choice.available}>{choice.name} · {choice.source}{choice.available ? '' : ' · missing'}</option>{/each}
        </select>
      </label>
      {@const selected = context.choices.find(choice => choice.id === context?.selected)}
      <p class="scope">{selectionSource(context)}</p>
      {#if selected}<p class="path">{selected.path}</p>{/if}
      <div class="actions">
        <button disabled={state.busy} onclick={() => context?.kind && select({ kind: context.kind, value: 'browse' })}>{context.kind === 'compilation' ? 'Choose build folder…' : context.kind === 'python' ? 'Choose Python…' : 'Choose SDK…'}</button>
        <button disabled={state.busy} onclick={refresh} aria-label="Refresh project environment">Refresh</button>
      </div>
      {#if context.selectionSource === 'project'}
        <button disabled={state.busy} onclick={() => context?.kind && select({ kind: context.kind, value: 'automatic' })}>Remove project override</button>
        <p class="scope">Falls back to {context.inherited ? `${context.inherited.name} · ${context.inherited.source}${context.inherited.available ? '' : ' · missing'}` : 'automatic discovery; an environment may still need to be chosen'}.</p>
        {#if context.inherited}<p class="path">{context.inherited.path}</p>{/if}
      {/if}
    {/if}
    {#if context.preparation}
      <details><summary>Configure {context.preparation === 'cmake' ? 'CMake' : 'Meson'} analysis</summary>
        <p>Run the project’s configure step to generate a compilation database in Setdown’s build cache. This runs project configuration code; generated headers may still require a build.</p>
        {#if state.preparing}<p role="status">Configuring project…</p><button onclick={cancel}>Cancel configuration</button>
        {:else}<button disabled={state.busy} onclick={prepare}>Configure project</button>{/if}
      </details>
    {/if}
    {#if state.output}<details open><summary>Configuration output</summary><pre>{state.output}</pre></details>{/if}
  </section>
{/if}

<style>
  .scope { color: var(--app-muted-text); font-size: 11px; }
  .path { overflow-wrap: anywhere; font-size: 11px; }
  .issue { color: var(--app-warning-text); }
  label { display: grid; gap: 6px; margin: 12px 0; }
  select { width: 100%; min-width: 0; padding: 6px; color: inherit; background: var(--app-canvas); border: 1px solid var(--app-border); font: inherit; }
  button { color: inherit; font: inherit; padding: 5px 8px; border: 1px solid var(--app-border); border-radius: 4px; background: transparent; cursor: pointer; }
  button:hover { background: var(--app-hover); } button:disabled, select:disabled { opacity: .6; cursor: default; }
  button:focus-visible, select:focus-visible, summary:focus-visible { outline: 1px solid var(--app-focus-ring); }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
  p { overflow-wrap: anywhere; margin: 8px 0; }
  details { margin: 12px 0; } summary { cursor: pointer; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
