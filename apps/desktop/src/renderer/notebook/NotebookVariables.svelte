<script lang="ts">
  import type { NotebookExecution } from './notebook-execution';
  import type { NotebookInspection } from '../../protocol/notebook';
  let { execution, revision, close }: { execution: NotebookExecution; revision: number; close(): void } = $props();
  let result = $state<NotebookInspection>({}), name = $state<string>(), offset = $state(0), error = $state(''), loading = $state(false);
  let request = 0;
  async function refresh(next: string | undefined = name, start = offset) {
    const current = ++request; name = next; offset = start; loading = true; error = '';
    try { const value = await execution.inspect(next, start); if (current === request) result = value; }
    catch (e) { if (current === request) { error = String(e); result = {}; } }
    finally { if (current === request) loading = false; }
  }
  const kernelState = $derived.by(() => { void revision; return execution.state; });
  $effect(() => { if (kernelState === 'idle') void refresh(); else { request++; result = {}; loading = false; } });
</script>
<section class="variables" aria-label="Notebook variables">
  <div class="actions"><strong>{name ?? 'Variables'}</strong>
    {#if name}<button onclick={() => { name = undefined; void refresh(undefined, 0); }}>All variables</button>{/if}
    <button onclick={() => refresh()} disabled={kernelState !== 'idle' || loading}>Refresh</button><button onclick={close} aria-label="Close variables">×</button>
  </div>
  {#if error}<p role="alert">{error}</p>{:else if kernelState !== 'idle'}<p>Variables are available when the local kernel is idle.</p>{:else if loading}<p>Loading…</p>{/if}
  <div class="table-scroll">
    {#if result.variables}<table><thead><tr><th>Name</th><th>Type</th><th>Shape / length</th><th>Preview</th></tr></thead><tbody>
      {#each result.variables as variable}<tr><td><button onclick={() => refresh(variable.name, 0)}>{variable.name}</button></td><td>{variable.type}</td><td>{variable.shape}</td><td>{variable.preview}</td></tr>{/each}
    </tbody></table>
    {:else if result.rows}<table><thead><tr>{#each result.columns ?? [] as column}<th>{column}</th>{/each}</tr></thead><tbody>
      {#each result.rows as row}<tr>{#each row as value}<td>{value}</td>{/each}</tr>{/each}
    </tbody></table>{/if}
  </div>
  {#if name && result.total !== undefined}<div class="actions"><button disabled={!offset || loading} onclick={() => refresh(name, Math.max(0, offset - 100))}>Previous 100</button>
    <span>{result.total ? offset + 1 : 0}–{Math.min(offset + 100, result.total)} of {result.total} · up to 100 columns</span>
    <button disabled={offset + 100 >= result.total || loading} onclick={() => refresh(name, offset + 100)}>Next 100</button></div>{/if}
</section>
<style>
  .variables { border-top: 1px solid var(--app-border); padding: 8px 14px; max-height: 35%; overflow: auto; flex-shrink: 0; font-size: 12px; }
  .actions { display: flex; align-items: center; gap: 12px; } .table-scroll { overflow: auto; max-height: 220px; }
  table { border-collapse: collapse; text-align: left; } td, th { padding: 3px 12px; border-bottom: 1px solid var(--app-border); max-width: 400px; overflow-wrap: anywhere; }
  button { font: inherit; background: var(--app-surface); color: var(--app-text); border: 1px solid var(--app-border); cursor: pointer; } button:disabled { opacity: .5; }
</style>
