<script lang="ts">
  import { view } from '../workspace/workspace-view.svelte';
import type { AppActions } from '../ports/ui-actions';
  let { actions }: { actions: AppActions } = $props();
  const sessions = $derived(view.terminalSessions.map(session => ({ ...session,
    active: view.tabs.some(tab => tab.kind === 'terminal' && tab.sessionId === session.id && tab.active) })));
</script>
<section class="terminal-list" aria-label="Terminal sessions">
  <header class="side-view-title">
    <span>TERMINALS</span>
    <button aria-label="New terminal session" title="New terminal" onclick={actions.newTerminal}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
    </button>
  </header>
  {#if !sessions.length}
    <p class="empty">No open terminals.</p>
    <button class="create" onclick={actions.newTerminal}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      <span>New terminal</span>
    </button>
  {/if}
  <div class="sessions">
  {#each sessions as tab (tab.id)}
    <div class="session" class:active={tab.active}>
      <button class="select" title={`terminal://${tab.id}`} aria-pressed={tab.active} onclick={() => actions.openTerminalSession(tab.id)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 6 6 6-6 6M13 18h6"/></svg>
        <span class="name">{tab.title}{tab.exited ? ' (exited)' : ''}</span><small>{tab.cwd || 'Starting…'}</small>
      </button>
      <button class="kill" title="End terminal process" aria-label={`Close terminal ${tab.title}`} onclick={() => actions.closeTerminalSession(tab.id)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
    </div>
  {/each}
  </div>
</section>
<style>
  .terminal-list { display: flex; flex: 1; flex-direction: column; min-height: 0; font-size: 11px; }
  button { border: 0; background: transparent; color: var(--app-text); font: inherit; cursor: pointer; }
  button:hover { background: var(--app-hover); }
  button:focus-visible { outline: 1px solid var(--app-focus-ring); outline-offset: -1px; }
  svg { flex-shrink: 0; width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }
  .sessions { flex: 1; min-height: 0; overflow: auto; padding: 3px 0 12px; }
  .session { display: flex; align-items: center; height: 23px; }
  .session:hover { background: var(--app-hover); }
  .session.active { background: color-mix(in srgb, var(--app-focus-ring) 14%, var(--app-hover)); }
  .select { display: flex; align-items: center; text-align: left; gap: 4px; flex: 1; min-width: 0; height: 23px; padding: 0 4px 0 14px; }
  .name, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name { flex: 0 1 auto; min-width: 0; max-width: 50%; }
  small { flex: 1; min-width: 0; margin-left: 4px; color: var(--app-muted-text); font: inherit; }
  .kill { display: grid; place-items: center; flex-shrink: 0; width: 20px; height: 20px; padding: 4px; margin-right: 4px; opacity: 0; }
  .kill svg { width: 12px; height: 12px; }
  .session:hover .kill, .session:focus-within .kill, .session.active .kill { opacity: 1; }
  .empty { margin: 10px 14px 6px; color: var(--app-muted-text); line-height: 23px; }
  .create { display: flex; align-items: center; gap: 4px; flex-shrink: 0; height: 23px; padding: 0 14px; text-align: left; }
</style>
