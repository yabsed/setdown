<script lang="ts">
  import type { AnalysisContext } from '../../core/document/analysis-context';
  import { automaticChecking, checkingLevels } from './python-checking';
  let { checking, busy, select }: {
    checking: NonNullable<AnalysisContext['checking']>; busy: boolean; select(value: string): void;
  } = $props();
  const selected = $derived(checking.override ?? 'automatic');
  const group = `python-checking-${Math.random().toString(36).slice(2)}`;
</script>

<fieldset class="python-checking" aria-label="Python type checking" disabled={busy || !!checking.projectConfiguration}>
  <legend>Python type checking</legend>
  {#if checking.projectConfiguration}<p class="decided" role="note">This project’s own configuration decides the checking level, so the choice here has no effect: {checking.projectConfiguration}</p>{/if}
  <label class:selected={selected === 'automatic'}>
    <input type="radio" name={group} value="automatic" checked={selected === 'automatic'} onchange={() => select('automatic')} />
    <span><strong>Project settings / default</strong><small>{automaticChecking(checking)}</small></span>
  </label>
  {#each checkingLevels as level (level.value)}
    <label class:selected={selected === level.value}>
      <input type="radio" name={group} value={level.value} checked={selected === level.value} onchange={() => select(level.value)} />
      <span><strong>{level.name}</strong><small>{level.reports}</small></span>
    </label>
  {/each}
  <p>Takes effect right away for this project’s open Python files and notebooks: analysis restarts by itself. Cells are not run and the kernel keeps running.</p>
</fieldset>

<style>
  .python-checking { display: grid; gap: 2px; min-width: 0; margin: 12px 0; padding: 0; border: 0; font: inherit; color: inherit; }
  legend { padding: 0; margin-bottom: 6px; font-weight: 600; }
  label { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 6px; border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
  label:hover { background: var(--app-hover); }
  label.selected { border-color: var(--app-border); background: var(--app-canvas); }
  label:focus-within { outline: 1px solid var(--app-focus-ring); }
  input { margin: 3px 0 0; flex: none; accent-color: var(--app-accent); }
  span { display: grid; gap: 1px; min-width: 0; }
  strong { font-weight: 600; }
  small, p { color: var(--app-muted-text); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
  p { margin: 6px 0 0; }
  .decided { margin: 0 0 6px; color: var(--app-text); }
  .python-checking:disabled label { cursor: default; opacity: .6; }
</style>
