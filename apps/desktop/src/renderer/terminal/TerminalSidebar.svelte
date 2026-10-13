<script lang="ts">
  import { view, type AppActions } from '../view-state.svelte';
  let { actions }: { actions: AppActions } = $props();
  const sessions = $derived(view.tabs.filter(tab => tab.kind === 'terminal'));
</script>
<section class="terminal-list" aria-label="Terminal sessions">
  <header><h2>TERMINALS</h2><button aria-label="New terminal session" title="New terminal" onclick={actions.newTerminal}>+</button></header>
  {#if !sessions.length}
    <p>No open terminals.</p>
    <button class="create" onclick={actions.newTerminal}>New terminal</button>
  {/if}
  {#each sessions as tab (tab.id)}
    <div class="session" class:active={tab.active}>
      <button class="select" title={tab.path} aria-pressed={tab.active} onclick={() => actions.activateTab(tab.id)}>
        <span>{tab.name}</span><small>{tab.path || 'Starting…'}</small>
      </button>
      <button class="kill" title="Close terminal and end its process" aria-label={`Close terminal ${tab.name}`} onclick={() => actions.closeTab(tab.id)}>×</button>
    </div>
  {/each}
</section>
<style>
  .terminal-list { padding: 0 8px; }
  header { height: 40px; display: flex; align-items: center; justify-content: space-between; }
  h2 { font-size: 11px; font-weight: 400; color: var(--app-muted-text); margin: 0 8px; }
  button { border: 0; background: transparent; color: var(--app-text); cursor: pointer; }
  header button, .kill { flex-shrink: 0; width: 28px; height: 28px; font-size: 20px; }
  button:hover { background: var(--app-hover); }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  .session { display: flex; align-items: center; border-radius: 3px; }
  .session.active { background: var(--app-selected); }
  .select { display: flex; flex-direction: column; text-align: left; gap: 4px; flex: 1; min-width: 0; padding: 8px; }
  span, small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small, p { color: var(--app-muted-text); font-size: 11px; }
  p { margin: 12px 8px; }
  .create { margin: 0 8px; padding: 6px 10px; border: 1px solid var(--app-border); border-radius: 3px; }
</style>
