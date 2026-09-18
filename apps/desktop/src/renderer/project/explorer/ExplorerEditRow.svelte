<script lang="ts">
  import type { ProjectEntryKind } from '../../../protocol/desktop-api';

  let {
    kind,
    depth,
    initial,
    label,
    submit,
    cancel,
  }: {
    kind: ProjectEntryKind;
    depth: number;
    initial: string;
    label: string;
    submit(value: string): void;
    cancel(): void;
  } = $props();
  let input = $state<HTMLInputElement>();
  let value = $state('');
  let initialized = false;

  $effect(() => {
    if (!input || initialized) return;
    initialized = true;
    value = initial;
    input.focus();
    input.select();
  });
</script>

<div class="explorer-row explorer-edit" style:padding-left={`${8 + depth * 13}px`}>
  <span class="tree-chevron"></span>
  <svg class="tree-icon" viewBox="0 0 16 16"><path d={kind === 'directory'
    ? 'M1.5 4.5h5l1.5 2h6.5v7h-13v-9Z' : 'M3 1.5h6l4 4v9H3v-13Zm6 0v4h4'}/></svg>
  <input bind:this={input} bind:value aria-label={label} onclick={(event) => event.stopPropagation()}
    onkeydown={(event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); submit(value); }
      if (event.key === 'Escape') cancel();
    }} onblur={() => { if (!value.trim()) cancel(); }} />
</div>
